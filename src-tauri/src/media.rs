//! Media service (F-CORE-2): probe imported files with ffprobe, render a thumbnail into the
//! project, detect missing sources and relink them. Source media is referenced, never copied.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::ffmpeg::{error_summary, resolve, run, FfmpegError, Tool};
use crate::project::THUMBS_DIR;

const PROBE_TIMEOUT: Duration = Duration::from_secs(30);
const THUMB_TIMEOUT: Duration = Duration::from_secs(30);
/// Relink accepts a replacement whose duration differs by at most this much (re-muxed copies
/// can gain or lose a few frames); anything larger is reported as a mismatch for the user to confirm.
const DURATION_TOLERANCE_MS: u64 = 500;
/// Folder relink walks at most this deep and this many entries, so picking `C:\` stays bounded.
const RELINK_MAX_DEPTH: usize = 3;
const RELINK_MAX_ENTRIES: usize = 20_000;

pub const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov", "mkv", "webm", "avi", "m4v"];
pub const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"];
pub const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp"];

#[derive(Debug, Error)]
pub enum MediaError {
    #[error(transparent)]
    Ffmpeg(#[from] FfmpegError),
    #[error("Format tidak didukung: {0}")]
    Unsupported(String),
    #[error("Metadata ffprobe tidak terbaca: {0}")]
    BadProbe(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    Video,
    Audio,
    Image,
}

/// Shape matches `MediaAsset` in `src/types/project.ts` (plus import-only fields).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbedMedia {
    pub id: String,
    pub kind: MediaKind,
    pub file_path: PathBuf,
    pub file_name: String,
    pub duration_ms: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    /// Relative to the project root; absent when thumbnail rendering failed (non-fatal).
    pub thumbnail_path: Option<String>,
}

// ---------------------------------------------------------------------------
// ffprobe
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ProbeOutput {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    format: Option<ProbeFormat>,
}

#[derive(Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    #[serde(default)]
    disposition: ProbeDisposition,
}

#[derive(Deserialize, Default)]
struct ProbeDisposition {
    #[serde(default)]
    attached_pic: u8,
}

#[derive(Deserialize)]
struct ProbeFormat {
    format_name: Option<String>,
    duration: Option<String>,
}

pub(crate) struct MediaInfo {
    kind: MediaKind,
    duration_ms: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<f64>,
}

/// Classifies ffprobe JSON. Cover art in audio files (`attached_pic`) is not video, and still
/// images report a video stream with an image demuxer (`image2`, `png_pipe`, ...).
pub(crate) fn parse_probe(json: &str) -> Result<MediaInfo, MediaError> {
    let probe: ProbeOutput = serde_json::from_str(json).map_err(|e| MediaError::BadProbe(e.to_string()))?;
    let format_name = probe.format.as_ref().and_then(|f| f.format_name.clone()).unwrap_or_default();
    let duration_ms = probe
        .format
        .as_ref()
        .and_then(|f| f.duration.as_deref())
        .and_then(|d| d.parse::<f64>().ok())
        .filter(|d| d.is_finite() && *d > 0.0)
        .map(|d| (d * 1000.0).round() as u64);

    let video = probe.streams.iter().find(|s| s.codec_type.as_deref() == Some("video") && s.disposition.attached_pic == 0);
    let has_audio = probe.streams.iter().any(|s| s.codec_type.as_deref() == Some("audio"));
    let is_image_demuxer = format_name.split(',').any(|f| f == "image2" || f.ends_with("_pipe"));

    match (video, has_audio) {
        (Some(v), _) if is_image_demuxer => {
            Ok(MediaInfo { kind: MediaKind::Image, duration_ms: None, width: v.width, height: v.height, fps: None })
        }
        (Some(v), _) => Ok(MediaInfo {
            kind: MediaKind::Video,
            duration_ms,
            width: v.width,
            height: v.height,
            fps: v.avg_frame_rate.as_deref().and_then(parse_rate).or_else(|| v.r_frame_rate.as_deref().and_then(parse_rate)),
        }),
        (None, true) => Ok(MediaInfo { kind: MediaKind::Audio, duration_ms, width: None, height: None, fps: None }),
        (None, false) => Err(MediaError::Unsupported(format_name)),
    }
}

/// `30000/1001` → 29.97. `0/0` (unknown) → None.
fn parse_rate(rate: &str) -> Option<f64> {
    let (num, den) = rate.split_once('/')?;
    let (num, den) = (num.parse::<f64>().ok()?, den.parse::<f64>().ok()?);
    (num > 0.0 && den > 0.0).then(|| (num / den * 1000.0).round() / 1000.0)
}

async fn probe_file(path: &Path) -> Result<MediaInfo, MediaError> {
    let ffprobe = resolve(Tool::Ffprobe, None)?;
    let path_arg = path.to_string_lossy();
    let output = run(
        &ffprobe.path,
        &["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path_arg.as_ref()],
        PROBE_TIMEOUT,
    )
    .await?;
    if !output.success {
        return Err(MediaError::Ffmpeg(FfmpegError::Failed(error_summary(&output.stderr))));
    }
    parse_probe(&output.stdout)
}

/// Renders a small JPEG for the media pool. Failure is logged and ignored: a missing thumbnail
/// must never block an import.
async fn render_thumbnail(project_root: &Path, id: &str, source: &Path, info: &MediaInfo) -> Option<String> {
    if info.kind == MediaKind::Audio {
        return None;
    }
    let ffmpeg = resolve(Tool::Ffmpeg, None).ok()?;
    let relative = format!("{THUMBS_DIR}/{id}.jpg");
    let target = project_root.join(&relative);
    let partial = project_root.join(format!("{THUMBS_DIR}/{id}.part.jpg"));
    // Seek a little into videos so the thumbnail is not a black first frame.
    let seek = info.duration_ms.map_or(0, |d| (d / 10).min(1000));
    let seek_arg = format!("{:.3}", seek as f64 / 1000.0);
    let source_arg = source.to_string_lossy();
    let partial_arg = partial.to_string_lossy();
    let mut args = vec!["-hide_banner", "-loglevel", "error", "-y"];
    if info.kind == MediaKind::Video {
        args.extend(["-ss", seek_arg.as_str()]);
    }
    args.extend(["-i", source_arg.as_ref(), "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "5", partial_arg.as_ref()]);

    let outcome = run(&ffmpeg.path, &args, THUMB_TIMEOUT).await;
    let ok = matches!(&outcome, Ok(o) if o.success) && std::fs::rename(&partial, &target).is_ok();
    if !ok {
        let _ = std::fs::remove_file(&partial);
        tracing::warn!(asset_id = id, "thumbnail rendering failed");
        return None;
    }
    Some(relative)
}

pub async fn import_file(project_root: &Path, path: &Path, id: String) -> Result<ProbedMedia, MediaError> {
    let info = probe_file(path).await?;
    let thumbnail_path = render_thumbnail(project_root, &id, path, &info).await;
    Ok(to_probed(path, id, &info, thumbnail_path))
}

fn to_probed(path: &Path, id: String, info: &MediaInfo, thumbnail_path: Option<String>) -> ProbedMedia {
    ProbedMedia {
        file_name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        id,
        kind: info.kind,
        file_path: path.to_path_buf(),
        duration_ms: info.duration_ms,
        width: info.width,
        height: info.height,
        fps: info.fps,
        thumbnail_path,
    }
}

// ---------------------------------------------------------------------------
// Relink
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissingAsset {
    pub id: String,
    pub file_name: String,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkCandidate {
    pub media: ProbedMedia,
    /// False when the replacement's duration differs from the original: the UI asks to confirm.
    pub duration_matches: bool,
}

pub fn duration_matches(expected: Option<u64>, actual: Option<u64>) -> bool {
    match (expected, actual) {
        (Some(e), Some(a)) => e.abs_diff(a) <= DURATION_TOLERANCE_MS,
        // Nothing to compare (e.g. images): the file name already matched.
        (None, _) => true,
        (Some(_), None) => false,
    }
}

/// Probe only: the existing thumbnail stays, since a moved file has the same content and the user
/// may still reject a candidate whose duration differs.
pub async fn relink_candidate(path: &Path, id: String, expected_ms: Option<u64>) -> Result<RelinkCandidate, MediaError> {
    let info = probe_file(path).await?;
    let media = to_probed(path, id, &info, None);
    let duration_matches = duration_matches(expected_ms, media.duration_ms);
    Ok(RelinkCandidate { media, duration_matches })
}

/// Breadth-first search for files whose name matches (case-insensitive) a missing asset.
pub fn find_by_name(folder: &Path, missing: &[MissingAsset]) -> Vec<(usize, PathBuf)> {
    let mut found: Vec<Option<PathBuf>> = vec![None; missing.len()];
    let mut queue = VecDeque::from([(folder.to_path_buf(), 0_usize)]);
    let mut visited = 0_usize;
    while let Some((dir, depth)) = queue.pop_front() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            visited += 1;
            if visited > RELINK_MAX_ENTRIES {
                break;
            }
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else { continue };
            if file_type.is_dir() {
                if depth < RELINK_MAX_DEPTH {
                    queue.push_back((path, depth + 1));
                }
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_lowercase();
            for (index, asset) in missing.iter().enumerate() {
                if found[index].is_none() && asset.file_name.to_lowercase() == name {
                    found[index] = Some(path.clone());
                }
            }
        }
        if visited > RELINK_MAX_ENTRIES || found.iter().all(Option::is_some) {
            break;
        }
    }
    found.into_iter().enumerate().filter_map(|(i, p)| p.map(|p| (i, p))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_video_audio_and_image() {
        let video = r#"{"streams":[{"codec_type":"video","width":1920,"height":1080,"avg_frame_rate":"30000/1001","disposition":{"attached_pic":0}},{"codec_type":"audio"}],"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"12.345000"}}"#;
        let info = parse_probe(video).expect("video");
        assert_eq!(info.kind, MediaKind::Video);
        assert_eq!(info.duration_ms, Some(12345));
        assert_eq!((info.width, info.height, info.fps), (Some(1920), Some(1080), Some(29.97)));

        let mp3_with_cover = r#"{"streams":[{"codec_type":"audio"},{"codec_type":"video","width":500,"height":500,"disposition":{"attached_pic":1}}],"format":{"format_name":"mp3","duration":"7.632"}}"#;
        let info = parse_probe(mp3_with_cover).expect("audio");
        assert_eq!(info.kind, MediaKind::Audio);
        assert_eq!(info.duration_ms, Some(7632));

        let png = r#"{"streams":[{"codec_type":"video","width":800,"height":600,"r_frame_rate":"25/1"}],"format":{"format_name":"png_pipe"}}"#;
        let info = parse_probe(png).expect("image");
        assert_eq!(info.kind, MediaKind::Image);
        assert_eq!(info.duration_ms, None);
    }

    /// Live check with the machine's FFmpeg: `cargo test -- --ignored live_`.
    #[tokio::test]
    #[ignore = "machine-specific: needs ffmpeg/ffprobe on PATH"]
    async fn live_import_generated_video() {
        let root = std::env::temp_dir().join(format!("script-studio-media-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(root.join(THUMBS_DIR)).expect("dirs");
        let source = root.join("sample clip.mp4");
        let ffmpeg = resolve(Tool::Ffmpeg, None).expect("ffmpeg");
        let source_arg = source.to_string_lossy();
        let args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=2", "-pix_fmt", "yuv420p", source_arg.as_ref()];
        assert!(run(&ffmpeg.path, &args, Duration::from_secs(60)).await.expect("generate").success);

        let media = import_file(&root, &source, "asset-1".into()).await.expect("import");
        println!("{media:?}");
        assert_eq!(media.kind, MediaKind::Video);
        assert_eq!((media.width, media.height, media.fps), (Some(640), Some(360), Some(30.0)));
        assert!(media.duration_ms.is_some_and(|d| d.abs_diff(2000) <= 50));
        assert_eq!(media.thumbnail_path.as_deref(), Some("proxy/thumbs/asset-1.jpg"));
        assert!(root.join("proxy/thumbs/asset-1.jpg").is_file());
        assert!(!root.join("proxy/thumbs/asset-1.part.jpg").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_streamless_files() {
        assert!(matches!(parse_probe(r#"{"streams":[],"format":{"format_name":"tty"}}"#), Err(MediaError::Unsupported(_))));
        assert!(matches!(parse_probe("not json"), Err(MediaError::BadProbe(_))));
    }

    #[test]
    fn parses_frame_rates() {
        assert_eq!(parse_rate("25/1"), Some(25.0));
        assert_eq!(parse_rate("0/0"), None);
        assert_eq!(parse_rate("garbage"), None);
    }

    #[test]
    fn duration_tolerance() {
        assert!(duration_matches(Some(10_000), Some(10_400)));
        assert!(!duration_matches(Some(10_000), Some(11_000)));
        assert!(duration_matches(None, None));
        assert!(!duration_matches(Some(10_000), None));
    }

    #[test]
    fn finds_missing_files_by_name_in_subfolders() {
        let root = std::env::temp_dir().join(format!("script-studio-relink-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(root.join("a/b")).expect("dirs");
        std::fs::write(root.join("a/b/Login.MP4"), b"").expect("file");
        let missing = vec![
            MissingAsset { id: "1".into(), file_name: "login.mp4".into(), duration_ms: None },
            MissingAsset { id: "2".into(), file_name: "absent.mp4".into(), duration_ms: None },
        ];
        let found = find_by_name(&root, &missing);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].0, 0);
        assert!(found[0].1.ends_with("Login.MP4"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
