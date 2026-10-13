//! Manifest subset the renderer needs, plus the timeline math ported from
//! `src/project/sync.ts` / `timeline.ts`. Parity is locked by tests using the same numbers.
//! Unknown fields are ignored: the UI validated the full manifest with Zod; here we only
//! re-check what affects file access and FFmpeg arguments.

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Fit {
    Contain,
    Cover,
    Fill,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Canvas {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub background: String,
    pub fit: Fit,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub kind: String,
    pub file_path: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Alignment {
    FreezeFrame,
    RippleCut,
    NaturalPause,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Effect {
    Zoom { start_offset_ms: u64, duration_ms: u64, scale: f64, target: Point, spotlight_mask: bool },
    Blur { start_offset_ms: u64, duration_ms: u64, rect: Rect, blur_strength: f64 },
    /// Rendered by the UI-generated ASS overlay, not by filters.
    Callout {},
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub video_clip_id: String,
    pub video_trim_start_ms: u64,
    pub video_trim_end_ms: u64,
    pub playback_rate: f64,
    pub alignment_mode: Alignment,
    pub effects: Vec<Effect>,
    pub audio_duration_ms: Option<u64>,
    pub audio_cache_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BgmTrack {
    pub file_path: String,
    pub start_offset_ms: u64,
    pub duration_ms: u64,
    pub volume: f64,
    pub auto_duck: bool,
    pub duck_volume: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Track {
    pub kind: String,
    pub muted: bool,
    pub solo: bool,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Loudness {
    pub enabled: bool,
    pub target_lufs: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub canvas: Canvas,
    pub assets: Vec<Asset>,
    pub scenes: Vec<Scene>,
    pub bgm_tracks: Vec<BgmTrack>,
    pub tracks: Vec<Track>,
    pub scene_gap_ms: u64,
    pub loudness: Loudness,
}

impl Manifest {
    /// Mute/solo (03 §5.3): solo wins, otherwise everything not muted.
    pub fn audible(&self, kind: &str) -> bool {
        let any_solo = self.tracks.iter().any(|t| t.solo);
        let track = self.tracks.iter().find(|t| t.kind == kind);
        match track {
            Some(t) if any_solo => t.solo,
            Some(t) => !t.muted,
            None => !any_solo,
        }
    }
}

// ---------------------------------------------------------------------------
// Timeline math (mirror of sync.ts / timeline.ts)
// ---------------------------------------------------------------------------

pub fn clip_ms(scene: &Scene) -> u64 {
    let span = scene.video_trim_end_ms.saturating_sub(scene.video_trim_start_ms) as f64;
    (span / scene.playback_rate).round() as u64
}

/// Moving-video length on the timeline (ripple-cut trims the clip to the narration).
pub fn video_span_ms(scene: &Scene) -> u64 {
    let clip = clip_ms(scene);
    let audio = scene.audio_duration_ms.unwrap_or(0);
    if scene.alignment_mode == Alignment::RippleCut && audio > 0 && clip > audio {
        audio
    } else {
        clip
    }
}

pub fn scene_duration_ms(scene: &Scene, gap_ms: u64) -> u64 {
    let clip = clip_ms(scene);
    let audio = scene.audio_duration_ms.unwrap_or(0);
    let body = match scene.alignment_mode {
        Alignment::FreezeFrame | Alignment::NaturalPause => clip.max(audio),
        Alignment::RippleCut => {
            if audio > 0 {
                audio
            } else {
                clip
            }
        }
    };
    body + gap_ms
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn scene(trim: (u64, u64), audio: Option<u64>, mode: Alignment) -> Scene {
        Scene {
            video_clip_id: "v".into(),
            video_trim_start_ms: trim.0,
            video_trim_end_ms: trim.1,
            playback_rate: 1.0,
            alignment_mode: mode,
            effects: Vec::new(),
            audio_duration_ms: audio,
            audio_cache_path: None,
        }
    }

    /// Same cases as `timeline.test.ts` ("places scenes back to back with gaps").
    #[test]
    fn matches_typescript_layout() {
        let a = scene((0, 4000), Some(5000), Alignment::FreezeFrame);
        let b = scene((10_000, 14_000), Some(2000), Alignment::RippleCut);
        assert_eq!((video_span_ms(&a), scene_duration_ms(&a, 300)), (4000, 5300));
        assert_eq!((video_span_ms(&b), scene_duration_ms(&b, 300)), (2000, 2300));
    }

    #[test]
    fn playback_rate_shortens_the_clip() {
        let mut fast = scene((0, 4000), None, Alignment::FreezeFrame);
        fast.playback_rate = 2.0;
        assert_eq!(clip_ms(&fast), 2000);
    }

    #[test]
    fn parses_manifest_json_from_the_ui() {
        let json = r##"{
            "schemaVersion":"1.0.0","title":"x",
            "canvas":{"width":1920,"height":1080,"fps":30,"background":"#1F2933","padding":0,"fit":"contain","aspectRatio":"16:9"},
            "assets":[{"id":"v","kind":"video","filePath":"C:/v.mp4","durationMs":4000,"width":1920,"height":1080}],
            "scenes":[{"id":"s","order":0,"title":"t","narration":"n","videoClipId":"v","videoTrimStartMs":0,"videoTrimEndMs":4000,
                "playbackRate":1,"alignmentMode":"ripple-cut","effects":[
                    {"id":"e1","type":"zoom","startOffsetMs":0,"durationMs":1000,"scale":2,"target":{"x":0.5,"y":0.5},"spotlightMask":false},
                    {"id":"e2","type":"callout","startOffsetMs":0,"durationMs":1000,"label":"Langkah 1","position":"top-left"}]}],
            "bgmTracks":[],"tracks":[{"kind":"bgm","muted":true,"solo":false,"locked":false}],"sceneGapMs":300,
            "loudness":{"enabled":true,"targetLufs":-14}
        }"##;
        let manifest: Manifest = serde_json::from_str(json).expect("manifest");
        assert_eq!(manifest.scenes[0].alignment_mode, Alignment::RippleCut);
        assert!(matches!(manifest.scenes[0].effects[1], Effect::Callout {}));
        assert!(!manifest.audible("bgm"));
        assert!(manifest.audible("narration"));
    }
}
