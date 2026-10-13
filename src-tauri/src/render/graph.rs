//! Filtergraph generator (05 §3). Pure: manifest + options in, FFmpeg inputs and graph text out.
//!
//! Per scene: an input-seeked segment (`-ss/-t`, so a long recording is not decoded once per
//! scene) → rate → freeze/gap hold (`tpad`) → privacy blur → animated zoom → fit to the output.
//! Zoom uses `zoompan` (d=1, constant output size) with per-frame z/x/y on the input time `it`.
//! Verified against FFmpeg 9.0: `crop` cannot animate w/h, and `scale eval=frame` changes the
//! frame size mid-graph, which downstream filters (crop) do not follow — the viewport was wrong.
//! Audio: narration placed with `adelay`, BGM with sidechain ducking, `amix normalize=0`,
//! padded/trimmed to the timeline, optional 2-pass `loudnorm`. Every label is consumed once.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use thiserror::Error;

use super::model::{scene_duration_ms, video_span_ms, Alignment, Effect, Fit, Manifest};

#[derive(Debug, Error, PartialEq)]
pub enum GraphError {
    #[error("Proyek belum punya scene.")]
    Empty,
    #[error("Scene {0} memakai klip yang tidak ada di media pool.")]
    MissingClip(usize),
    #[error("Ukuran video klip scene {0} tidak diketahui; impor ulang medianya.")]
    UnknownSize(usize),
    #[error("Path audio narasi scene {0} tidak valid.")]
    BadAudioPath(usize),
}

/// Measured values from loudnorm pass 1 (05 §2.2 two-pass).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Measured {
    pub input_i: f64,
    pub input_tp: f64,
    pub input_lra: f64,
    pub input_thresh: f64,
    pub target_offset: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Loudnorm {
    Off,
    Measure { target: f64 },
    Apply { target: f64, measured: Measured },
}

#[derive(Debug, Clone, Copy)]
pub struct PlanOptions {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub include_video: bool,
    pub loudnorm: Loudnorm,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    /// One argument group per input, e.g. `["-ss", "1.000", "-t", "3.000", "-i", path]`.
    pub inputs: Vec<Vec<String>>,
    pub graph: String,
    pub video_out: Option<&'static str>,
    pub audio_out: &'static str,
    pub total_ms: u64,
}

fn secs(ms: f64) -> String {
    format!("{:.3}", ms / 1000.0)
}

/// Quoted filter-option value (05 §3.1 rule 4): forward slashes first (so no backslash is left
/// to escape), then `:` → `\:` and `'` → `'\\''`.
pub fn escape_filter_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").replace(':', "\\:").replace('\'', "'\\\\''")
}

/// `x` → smoothstep on [0,1] as an FFmpeg expression.
fn smoothstep(x: &str) -> String {
    let c = format!("clip({x},0,1)");
    format!("({c}*{c}*(3-2*{c}))")
}

/// Ease envelope (04 §4.1): ramps of min(300 ms, d/3), held peak, 0 outside the window.
/// Uses zoompan's input-time variable `it` (seconds, scene-local).
fn envelope(start_s: f64, dur_s: f64) -> String {
    let end = start_s + dur_s;
    let ramp = (0.3_f64).min(dur_s / 3.0).max(0.001);
    format!(
        "if(between(it,{start_s:.3},{end:.3}),min({},{}),0)",
        smoothstep(&format!("(it-{start_s:.3})/{ramp:.3}")),
        smoothstep(&format!("({end:.3}-it)/{ramp:.3}"))
    )
}

fn even(v: f64) -> i64 {
    ((v / 2.0).floor() as i64) * 2
}

fn hex_color(css: &str) -> String {
    format!("0x{}", css.trim_start_matches('#').get(0..6).unwrap_or("000000"))
}

/// Narration cache path must be `cache/tts/<sha256>.mp3` inside the project.
fn narration_path(root: &Path, relative: &str) -> Option<PathBuf> {
    let name = relative.strip_prefix("cache/tts/")?.strip_suffix(".mp3")?;
    (name.len() == 64 && name.bytes().all(|b| b.is_ascii_hexdigit())).then(|| root.join("cache").join("tts").join(format!("{name}.mp3")))
}

pub fn build_plan(manifest: &Manifest, project_root: &Path, options: &PlanOptions, overlay_ass: Option<&Path>) -> Result<Plan, GraphError> {
    if manifest.scenes.is_empty() {
        return Err(GraphError::Empty);
    }
    let gap = manifest.scene_gap_ms;
    let mut inputs: Vec<Vec<String>> = Vec::new();
    let mut graph = String::new();
    let mut starts = Vec::with_capacity(manifest.scenes.len());
    let mut cursor = 0_u64;
    for scene in &manifest.scenes {
        starts.push(cursor);
        cursor += scene_duration_ms(scene, gap);
    }
    let total_ms = cursor;

    // ---------------- video ----------------
    if options.include_video {
        let (ow, oh) = (options.width, options.height);
        for (i, scene) in manifest.scenes.iter().enumerate() {
            let asset = manifest.assets.iter().find(|a| a.id == scene.video_clip_id && a.kind == "video").ok_or(GraphError::MissingClip(i))?;
            let (sw, sh) = match (asset.width, asset.height) {
                (Some(w), Some(h)) if w > 0 && h > 0 => (f64::from(w), f64::from(h)),
                _ => return Err(GraphError::UnknownSize(i)),
            };
            let span = video_span_ms(scene);
            let source_len = span as f64 * scene.playback_rate;
            let hold = scene_duration_ms(scene, gap) - span;
            let k = inputs.len();
            inputs.push(vec![
                "-ss".into(),
                secs(scene.video_trim_start_ms as f64),
                "-t".into(),
                secs(source_len),
                "-i".into(),
                asset.file_path.clone(),
            ]);

            let mut chain = format!(
                "[{k}:v]setpts=(PTS-STARTPTS)/{rate},trim=duration={dur},setpts=PTS-STARTPTS,fps={fps},format=yuv420p",
                rate = scene.playback_rate,
                dur = secs(span as f64),
                fps = options.fps
            );
            if hold > 0 {
                let _ = write!(chain, ",tpad=stop_mode=clone:stop_duration={}", secs(hold as f64));
            }
            let mut current = format!("s{i}");
            let _ = writeln!(graph, "{chain}[{current}];");

            // Privacy blur in source pixels (04 §4.3): crop → gblur → overlay back while active.
            // gblur, not boxblur: boxblur is GPL-only and absent from the bundled LGPL build.
            // sigma = blurStrength matches the preview, whose CSS blur() is also a Gaussian σ.
            for (j, effect) in scene.effects.iter().enumerate() {
                let Effect::Blur { start_offset_ms, duration_ms, rect, blur_strength } = effect else { continue };
                let x = even(rect.x.clamp(0.0, sw - 16.0));
                let y = even(rect.y.clamp(0.0, sh - 16.0));
                let w = even(rect.width.clamp(16.0, sw - x as f64));
                let h = even(rect.height.clamp(16.0, sh - y as f64));
                let sigma = blur_strength.clamp(0.5, 100.0);
                let (a, b) = (*start_offset_ms as f64, (*start_offset_ms + *duration_ms) as f64);
                let base = format!("s{i}b{j}");
                let _ = writeln!(
                    graph,
                    "[{current}]split=2[{base}m][{base}c];[{base}c]crop={w}:{h}:{x}:{y},gblur=sigma={sigma:.1}:steps=3[{base}r];[{base}m][{base}r]overlay={x}:{y}:enable='between(t,{},{})'[{base}];",
                    secs(a),
                    secs(b)
                );
                current = base;
            }

            // Animated zoom; spotlight-mode zooms are drawn by the ASS overlay instead.
            let zooms: Vec<(f64, f64, f64, f64, f64)> = scene
                .effects
                .iter()
                .filter_map(|e| match e {
                    Effect::Zoom { start_offset_ms, duration_ms, scale, target, spotlight_mask: false } => {
                        Some((*start_offset_ms as f64 / 1000.0, *duration_ms as f64 / 1000.0, scale.clamp(1.0, 8.0), target.x.clamp(0.0, 1.0), target.y.clamp(0.0, 1.0)))
                    }
                    _ => None,
                })
                .collect();
            if !zooms.is_empty() {
                let z = zooms.iter().fold(String::from("1"), |acc, (a, d, s, _, _)| format!("{acc}+{:.4}*{}", s - 1.0, envelope(*a, *d)));
                let target = |pick: fn(&(f64, f64, f64, f64, f64)) -> f64| {
                    zooms.iter().rev().fold(String::from("0.5"), |acc, zoom| {
                        format!("if(between(it,{:.3},{:.3}),{:.4},{acc})", zoom.0, zoom.0 + zoom.1, pick(zoom))
                    })
                };
                let (tx, ty) = (target(|z| z.3), target(|z| z.4));
                let next = format!("s{i}z");
                let _ = writeln!(
                    graph,
                    "[{current}]zoompan=z='{z}':x='clip(({tx})*iw-iw/zoom/2,0,iw-iw/zoom)':y='clip(({ty})*ih-ih/zoom/2,0,ih-ih/zoom)':d=1:s={zw}x{zh}:fps={fps}[{next}];",
                    zw = even(sw),
                    zh = even(sh),
                    fps = options.fps
                );
                current = next;
            }

            // Fit into the output frame (canvas background for contain).
            let bg = hex_color(&manifest.canvas.background);
            let fit = match manifest.canvas.fit {
                Fit::Contain => format!(
                    "scale={ow}:{oh}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad={ow}:{oh}:(ow-iw)/2:(oh-ih)/2:color={bg}"
                ),
                Fit::Cover => format!("scale={ow}:{oh}:force_original_aspect_ratio=increase:flags=lanczos,crop={ow}:{oh}"),
                Fit::Fill => format!("scale={ow}:{oh}:flags=lanczos"),
            };
            let _ = writeln!(graph, "[{current}]{fit},setsar=1,format=yuv420p[v{i}];");
        }
        let labels: String = (0..manifest.scenes.len()).map(|i| format!("[v{i}]")).collect();
        let _ = writeln!(graph, "{labels}concat=n={}:v=1:a=0[vcat];", manifest.scenes.len());
        match overlay_ass {
            Some(path) => {
                let _ = writeln!(graph, "[vcat]ass=filename='{}'[vout];", escape_filter_path(path));
            }
            None => {
                let _ = writeln!(graph, "[vcat]null[vout];");
            }
        }
    }

    // ---------------- audio ----------------
    let mut narrations = Vec::new();
    if manifest.audible("narration") {
        for (i, scene) in manifest.scenes.iter().enumerate() {
            let Some(relative) = &scene.audio_cache_path else { continue };
            let path = narration_path(project_root, relative).ok_or(GraphError::BadAudioPath(i))?;
            let k = inputs.len();
            inputs.push(vec!["-i".into(), path.to_string_lossy().into_owned()]);
            // natural-pause never pads the video, so narration stops at the scene boundary (04 §1.1).
            let cut = if scene.alignment_mode == Alignment::NaturalPause {
                format!(",atrim=end={}", secs(scene_duration_ms(scene, gap) as f64))
            } else {
                String::new()
            };
            let label = format!("n{i}");
            let _ = writeln!(graph, "[{k}:a]aresample=48000,asetpts=PTS-STARTPTS{cut},adelay=delays={}:all=1[{label}];", starts[i]);
            narrations.push(label);
        }
    }

    let mut bgm = Vec::new();
    if manifest.audible("bgm") {
        for (j, track) in manifest.bgm_tracks.iter().enumerate() {
            let k = inputs.len();
            inputs.push(vec!["-i".into(), track.file_path.clone()]);
            let label = format!("g{j}");
            let _ = writeln!(
                graph,
                "[{k}:a]aresample=48000,atrim=end={},asetpts=PTS-STARTPTS,volume={:.3},adelay=delays={}:all=1[{label}];",
                secs(track.duration_ms as f64),
                track.volume.clamp(0.0, 1.0),
                track.start_offset_ms
            );
            bgm.push((label, track.auto_duck, track.volume, track.duck_volume));
        }
    }

    // Narration bus, split once per ducked BGM track (a label may be consumed only once).
    let ducked: Vec<usize> = bgm.iter().enumerate().filter(|(_, b)| b.1).map(|(j, _)| j).collect();
    let mut mix_inputs: Vec<String> = Vec::new();
    let mut keys: Vec<String> = Vec::new();
    if !narrations.is_empty() {
        let bus = if narrations.len() == 1 {
            narrations[0].clone()
        } else {
            let joined: String = narrations.iter().map(|l| format!("[{l}]")).collect();
            let _ = writeln!(graph, "{joined}amix=inputs={}:normalize=0:dropout_transition=0[narr];", narrations.len());
            "narr".to_owned()
        };
        if ducked.is_empty() {
            mix_inputs.push(bus);
        } else {
            keys = ducked.iter().map(|j| format!("key{j}")).collect();
            let outs: String = std::iter::once("[narrmix]".to_owned()).chain(keys.iter().map(|k| format!("[{k}]"))).collect();
            let _ = writeln!(graph, "[{bus}]asplit={}{outs};", keys.len() + 1);
            mix_inputs.push("narrmix".to_owned());
        }
    }
    for (j, (label, auto_duck, volume, duck)) in bgm.iter().enumerate() {
        if *auto_duck && !keys.is_empty() {
            // Approximate target level: compression ratio from volume / duck volume (calibrate by ear).
            let ratio = (volume / duck.max(0.01)).clamp(2.0, 20.0);
            let out = format!("gd{j}");
            let _ = writeln!(graph, "[{label}][key{j}]sidechaincompress=threshold=0.05:ratio={ratio:.2}:attack=50:release=300[{out}];");
            mix_inputs.push(out);
        } else {
            mix_inputs.push(label.clone());
        }
    }

    let total = secs(total_ms as f64);
    let mix = match mix_inputs.len() {
        0 => {
            let _ = writeln!(graph, "anullsrc=r=48000:cl=stereo[mixraw];");
            "mixraw".to_owned()
        }
        1 => mix_inputs[0].clone(),
        n => {
            let joined: String = mix_inputs.iter().map(|l| format!("[{l}]")).collect();
            let _ = writeln!(graph, "{joined}amix=inputs={n}:normalize=0:duration=longest:dropout_transition=0[mixraw];");
            "mixraw".to_owned()
        }
    };
    let loudnorm = match options.loudnorm {
        Loudnorm::Off => String::new(),
        Loudnorm::Measure { target } => format!(",loudnorm=I={target:.1}:TP=-1.5:LRA=11:print_format=json"),
        Loudnorm::Apply { target, measured: m } => format!(
            ",loudnorm=I={target:.1}:TP=-1.5:LRA=11:measured_I={:.2}:measured_TP={:.2}:measured_LRA={:.2}:measured_thresh={:.2}:offset={:.2}:linear=true:print_format=summary",
            m.input_i, m.input_tp, m.input_lra, m.input_thresh, m.target_offset
        ),
    };
    let _ = write!(graph, "[{mix}]apad,atrim=end={total}{loudnorm},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]");

    Ok(Plan {
        inputs,
        graph,
        video_out: options.include_video.then_some("vout"),
        audio_out: "aout",
        total_ms,
    })
}

/// Total timeline length without building a graph (for progress percentages).
pub fn timeline_ms(manifest: &Manifest) -> u64 {
    manifest.scenes.iter().map(|s| scene_duration_ms(s, manifest.scene_gap_ms)).sum()
}

#[cfg(test)]
pub(crate) mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::render::model::{clip_ms, Asset, BgmTrack, Canvas, Loudness, Point, Rect, Scene, Track};

    pub(crate) fn sample_manifest() -> Manifest {
        Manifest {
            canvas: Canvas { width: 1920, height: 1080, fps: 30, background: "#1F2933".into(), fit: Fit::Contain },
            assets: vec![Asset { id: "v".into(), kind: "video".into(), file_path: "C:/rec/login.mp4".into(), width: Some(1920), height: Some(1080) }],
            scenes: vec![
                Scene {
                    video_clip_id: "v".into(),
                    video_trim_start_ms: 0,
                    video_trim_end_ms: 3000,
                    playback_rate: 1.0,
                    alignment_mode: Alignment::FreezeFrame,
                    effects: vec![
                        Effect::Zoom { start_offset_ms: 500, duration_ms: 2000, scale: 2.0, target: Point { x: 0.25, y: 0.75 }, spotlight_mask: false },
                        Effect::Blur { start_offset_ms: 0, duration_ms: 1000, rect: Rect { x: 101.0, y: 51.0, width: 301.0, height: 101.0 }, blur_strength: 20.0 },
                        Effect::Callout {},
                    ],
                    audio_duration_ms: Some(3420),
                    audio_cache_path: Some(format!("cache/tts/{}.mp3", "a".repeat(64))),
                },
                Scene {
                    video_clip_id: "v".into(),
                    video_trim_start_ms: 3000,
                    video_trim_end_ms: 7000,
                    playback_rate: 2.0,
                    alignment_mode: Alignment::RippleCut,
                    effects: Vec::new(),
                    audio_duration_ms: Some(1500),
                    audio_cache_path: Some(format!("cache/tts/{}.mp3", "b".repeat(64))),
                },
            ],
            bgm_tracks: vec![BgmTrack { file_path: "C:/music/bgm.mp3".into(), start_offset_ms: 0, duration_ms: 60_000, volume: 0.4, auto_duck: true, duck_volume: 0.1 }],
            tracks: vec![Track { kind: "bgm".into(), muted: false, solo: false }],
            scene_gap_ms: 300,
            loudness: Loudness { enabled: true, target_lufs: -14.0 },
        }
    }

    fn options(loudnorm: Loudnorm) -> PlanOptions {
        PlanOptions { width: 1920, height: 1080, fps: 30, include_video: true, loudnorm }
    }

    /// ADR D4 rule 3: every `[label]` produced is consumed exactly once.
    pub(crate) fn assert_labels_single_use(graph: &str) {
        let mut produced: HashMap<String, usize> = HashMap::new();
        let mut consumed: HashMap<String, usize> = HashMap::new();
        for statement in graph.split(';').map(str::trim).filter(|s| !s.is_empty()) {
            let mut rest = statement;
            let mut leading = Vec::new();
            while let Some(stripped) = rest.strip_prefix('[') {
                let Some(end) = stripped.find(']') else { break };
                leading.push(stripped[..end].to_owned());
                rest = &stripped[end + 1..];
            }
            for label in leading.into_iter().filter(|l| !l.contains(':')) {
                *consumed.entry(label).or_default() += 1;
            }
            // Outputs are the trailing [labels] of each chain (after the last filter).
            let mut tail = statement;
            let mut trailing = Vec::new();
            while let Some(stripped) = tail.strip_suffix(']') {
                let Some(start) = stripped.rfind('[') else { break };
                trailing.push(stripped[start + 1..].to_owned());
                tail = &stripped[..start];
            }
            for label in trailing {
                *produced.entry(label).or_default() += 1;
            }
        }
        for (label, count) in &produced {
            assert_eq!(*count, 1, "label {label} produced {count} times");
            let used = consumed.get(label).copied().unwrap_or(0);
            if label != "vout" && label != "aout" {
                assert_eq!(used, 1, "label {label} consumed {used} times");
            }
        }
        for label in consumed.keys() {
            assert!(produced.contains_key(label), "label {label} consumed but never produced");
        }
    }

    #[test]
    fn plans_inputs_with_input_seeking() {
        let plan = build_plan(&sample_manifest(), Path::new("C:/p"), &options(Loudnorm::Off), None).expect("plan");
        // Scene 2: ripple-cut at 2× → 1.5 s on the timeline = 3.0 s of source from 3.000 s.
        assert_eq!(plan.inputs[1], ["-ss", "3.000", "-t", "3.000", "-i", "C:/rec/login.mp4"]);
        assert_eq!(plan.inputs[2][1], format!("C:/p\\cache\\tts\\{}.mp3", "a".repeat(64)).replace('\\', std::path::MAIN_SEPARATOR_STR));
        assert_eq!(plan.inputs.len(), 5);
        // 3420+300 + 1500+300
        assert_eq!(plan.total_ms, 5520);
    }

    #[test]
    fn graph_structure_is_valid() {
        let plan = build_plan(&sample_manifest(), Path::new("C:/p"), &options(Loudnorm::Off), Some(Path::new("C:/p/cache/render/x/overlay.ass"))).expect("plan");
        assert_labels_single_use(&plan.graph);
        let g = &plan.graph;
        // Freeze: 3.42 s narration over a 3 s clip, plus the 0.3 s gap.
        assert!(g.contains("[0:v]setpts=(PTS-STARTPTS)/1,trim=duration=3.000,setpts=PTS-STARTPTS,fps=30,format=yuv420p,tpad=stop_mode=clone:stop_duration=0.720[s0];"));
        // Blur rect snapped to even values inside the frame.
        assert!(g.contains("crop=300:100:100:50,gblur=sigma=20.0:steps=3[s0b1r];"));
        assert!(!g.contains("boxblur"), "boxblur is GPL-only");
        assert!(g.contains("overlay=100:50:enable='between(t,0.000,1.000)'"));
        // Zoom: zoompan keeps a constant frame size; target (0.25, 0.75) while active.
        assert!(g.contains("x='clip((if(between(it,0.500,2.500),0.2500,0.5))*iw-iw/zoom/2,0,iw-iw/zoom)'"));
        assert!(g.contains("y='clip((if(between(it,0.500,2.500),0.7500,0.5))*ih-ih/zoom/2,0,ih-ih/zoom)':d=1:s=1920x1080:fps=30[s0z];"));
        assert!(g.contains("[v0][v1]concat=n=2:v=1:a=0[vcat];"));
        assert!(g.contains("[vcat]ass=filename='C\\:/p/cache/render/x/overlay.ass'[vout];"));
        // Narration delayed to scene starts; scene 2 starts at 3720 ms.
        assert!(g.contains("adelay=delays=0:all=1[n0];"));
        assert!(g.contains("adelay=delays=3720:all=1[n1];"));
        // Ducking keyed by a split narration bus; ratio = 0.4/0.1.
        assert!(g.contains("[narr]asplit=2[narrmix][key0];"));
        assert!(g.contains("[g0][key0]sidechaincompress=threshold=0.05:ratio=4.00"));
        assert!(g.ends_with("[mixraw]apad,atrim=end=5.520,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]"));
    }

    #[test]
    fn loudnorm_passes() {
        let measure = build_plan(&sample_manifest(), Path::new("C:/p"), &PlanOptions { include_video: false, ..options(Loudnorm::Measure { target: -14.0 }) }, None).expect("plan");
        assert!(measure.video_out.is_none());
        assert_eq!(measure.inputs.len(), 3, "audio-only pass opens no video inputs");
        assert!(measure.graph.contains("loudnorm=I=-14.0:TP=-1.5:LRA=11:print_format=json"));
        assert_labels_single_use(&measure.graph);

        let measured = Measured { input_i: -20.5, input_tp: -3.1, input_lra: 4.0, input_thresh: -31.0, target_offset: 0.4 };
        let apply = build_plan(&sample_manifest(), Path::new("C:/p"), &options(Loudnorm::Apply { target: -14.0, measured }), None).expect("plan");
        assert!(apply.graph.contains("measured_I=-20.50:measured_TP=-3.10:measured_LRA=4.00:measured_thresh=-31.00:offset=0.40:linear=true"));
    }

    #[test]
    fn mute_solo_and_silence() {
        let mut manifest = sample_manifest();
        manifest.tracks = vec![Track { kind: "narration".into(), muted: true, solo: false }, Track { kind: "bgm".into(), muted: true, solo: false }];
        let plan = build_plan(&manifest, Path::new("C:/p"), &options(Loudnorm::Off), None).expect("plan");
        assert!(plan.graph.contains("anullsrc=r=48000:cl=stereo[mixraw];"));
        assert_eq!(plan.inputs.len(), 2);
        assert_labels_single_use(&plan.graph);
    }

    #[test]
    fn rejects_bad_input() {
        let mut manifest = sample_manifest();
        manifest.scenes[0].audio_cache_path = Some("../../etc/passwd".into());
        assert_eq!(build_plan(&manifest, Path::new("C:/p"), &options(Loudnorm::Off), None), Err(GraphError::BadAudioPath(0)));
        let mut manifest = sample_manifest();
        manifest.assets[0].width = None;
        assert_eq!(build_plan(&manifest, Path::new("C:/p"), &options(Loudnorm::Off), None), Err(GraphError::UnknownSize(0)));
        manifest.scenes.clear();
        assert_eq!(build_plan(&manifest, Path::new("C:/p"), &options(Loudnorm::Off), None), Err(GraphError::Empty));
    }

    #[test]
    fn escapes_windows_paths_for_filters() {
        assert_eq!(escape_filter_path(Path::new(r"C:\Users\a b\it's.ass")), r"C\:/Users/a b/it'\\''s.ass");
    }

    #[test]
    fn clip_math_is_shared_with_the_model() {
        let manifest = sample_manifest();
        assert_eq!(clip_ms(&manifest.scenes[1]), 2000);
        assert_eq!(timeline_ms(&manifest), 5520);
    }
}
