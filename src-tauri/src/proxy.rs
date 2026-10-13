//! Preview proxies (ADR D1 baseline, 01 §5), always written inside the project folder so the
//! webview's asset scope never has to reach source media elsewhere on disk.
//! - Video: H.264, ≤540p, short GOP without B-frames for fast seeking. No audio: the timeline
//!   has no source-audio track (narration and BGM are separate tracks).
//! - Audio (BGM): AAC in M4A.

use std::path::Path;
use std::time::Duration;

use crate::ffmpeg::{error_summary, progress_out_ms, resolve, run_with_progress, FfmpegError, Tool, VideoEncoder};

pub const PROXY_DIR: &str = "proxy";
/// Encodes at roughly real time or faster; a stuck encoder is killed after this multiple.
const TIMEOUT_FACTOR: u64 = 4;
const MIN_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProxyKind {
    Video,
    Audio,
}

impl ProxyKind {
    const fn extension(self) -> &'static str {
        match self {
            ProxyKind::Video => "mp4",
            ProxyKind::Audio => "m4a",
        }
    }
}

pub fn proxy_relative_path(asset_id: &str, kind: ProxyKind) -> String {
    format!("{PROXY_DIR}/{asset_id}.{}", kind.extension())
}

pub(crate) fn audio_proxy_args(source: &str, target: &str) -> Vec<String> {
    [
        "-hide_banner", "-loglevel", "error", "-nostats", "-y", "-i", source,
        "-map", "0:a:0", "-vn", "-sn", "-dn",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
        "-movflags", "+faststart",
        "-progress", "pipe:1",
        target,
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect()
}

/// Arguments for one proxy encode. Pure, so the exact command line is unit tested.
pub(crate) fn proxy_args(source: &str, target: &str, encoder: VideoEncoder) -> Vec<String> {
    [
        "-hide_banner", "-loglevel", "error", "-nostats", "-y", "-i", source,
        "-map", "0:v:0", "-an", "-sn", "-dn",
        // Never upscale; -2 keeps the width even (required by 4:2:0 H.264).
        "-vf", "scale=-2:'min(540,ih)'",
        "-c:v", encoder.ffmpeg_name(), "-b:v", "2M", "-g", "15", "-bf", "0",
        "-pix_fmt", encoder.pixel_format(),
        "-movflags", "+faststart",
        "-progress", "pipe:1",
        target,
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect()
}

/// Builds `proxy/<assetId>.<ext>` atomically; `on_progress` receives 0–100.
/// `encoder` is only used for video proxies.
pub async fn build_proxy(
    project_root: &Path,
    asset_id: &str,
    source: &Path,
    duration_ms: Option<u64>,
    kind: ProxyKind,
    encoder: Option<VideoEncoder>,
    mut on_progress: impl FnMut(u8) + Send,
) -> Result<String, FfmpegError> {
    let ffmpeg = resolve(Tool::Ffmpeg, None)?;
    let relative = proxy_relative_path(asset_id, kind);
    let target = project_root.join(&relative);
    let partial = project_root.join(format!("{PROXY_DIR}/{asset_id}.part.{}", kind.extension()));
    std::fs::create_dir_all(project_root.join(PROXY_DIR)).map_err(|e| FfmpegError::Failed(e.to_string()))?;

    let (source_arg, partial_arg) = (source.to_string_lossy(), partial.to_string_lossy());
    let args = match (kind, encoder) {
        (ProxyKind::Video, Some(encoder)) => proxy_args(&source_arg, &partial_arg, encoder),
        (ProxyKind::Video, None) => return Err(FfmpegError::NotFound("encoder H.264 belum dipilih".into())),
        (ProxyKind::Audio, _) => audio_proxy_args(&source_arg, &partial_arg),
    };
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let timeout = duration_ms.map_or(MIN_TIMEOUT, |ms| Duration::from_millis(ms.saturating_mul(TIMEOUT_FACTOR)).max(MIN_TIMEOUT));
    let mut last_percent = 0_u8;

    let output = run_with_progress(&ffmpeg.path, &arg_refs, timeout, |line| {
        if let (Some(done), Some(total)) = (progress_out_ms(line), duration_ms.filter(|d| *d > 0)) {
            let percent = u8::try_from((done.saturating_mul(100) / total).min(99)).unwrap_or(99);
            // Only report meaningful steps to keep IPC traffic low.
            if percent >= last_percent.saturating_add(5) {
                last_percent = percent;
                on_progress(percent);
            }
        }
    })
    .await;

    let failure = match output {
        Ok(output) if output.success => None,
        Ok(output) => Some(FfmpegError::Failed(error_summary(&output.stderr))),
        Err(err) => Some(err),
    };
    if let Some(err) = failure {
        let _ = std::fs::remove_file(&partial);
        return Err(err);
    }
    std::fs::rename(&partial, &target).map_err(|e| {
        let _ = std::fs::remove_file(&partial);
        FfmpegError::Failed(format!("proxy: {e}"))
    })?;
    on_progress(100);
    Ok(relative)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hardware_proxy_uses_nv12_and_short_gop() {
        let args = proxy_args("C:/in put.mp4", "C:/p/proxy/a.part.mp4", VideoEncoder::Qsv);
        let joined = args.join(" ");
        assert!(joined.contains("-c:v h264_qsv"));
        assert!(joined.contains("-pix_fmt nv12"));
        assert!(joined.contains("-g 15 -bf 0"));
        assert!(joined.contains("-an"));
        // Paths stay single arguments even with spaces: no shell, no quoting.
        assert!(args.iter().any(|a| a == "C:/in put.mp4"));
        assert_eq!(args.last().map(String::as_str), Some("C:/p/proxy/a.part.mp4"));
    }

    #[test]
    fn audio_proxy_is_aac_without_video() {
        let args = audio_proxy_args("bgm.mp3", "proxy/a.part.m4a");
        assert!(args.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
        assert!(args.iter().any(|a| a == "-vn"));
        assert_eq!(proxy_relative_path("a", ProxyKind::Audio), "proxy/a.m4a");
    }

    #[test]
    fn software_proxy_uses_yuv420p() {
        let args = proxy_args("in.mp4", "out.mp4", VideoEncoder::OpenH264);
        assert!(args.windows(2).any(|w| w[0] == "-pix_fmt" && w[1] == "yuv420p"));
    }

    /// Live: `cargo test -- --ignored live_` (needs ffmpeg with a working H.264 encoder).
    #[tokio::test]
    #[ignore = "machine-specific: real encode"]
    async fn live_build_proxy() {
        let detection = crate::ffmpeg::detect_encoder(None, |_| {}).await.expect("detect");
        let encoder = detection.selected.expect("an H.264 encoder");
        let root = std::env::temp_dir().join(format!("script-studio-proxy-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&root).expect("dir");
        let source = root.join("src.mp4");
        let ffmpeg = resolve(Tool::Ffmpeg, None).expect("ffmpeg");
        let src = source.to_string_lossy();
        let gen = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=3", "-pix_fmt", "yuv420p", src.as_ref()];
        assert!(crate::ffmpeg::run(&ffmpeg.path, &gen, Duration::from_secs(120)).await.expect("gen").success);

        let mut steps = Vec::new();
        let relative = build_proxy(&root, "asset-1", &source, Some(3000), ProxyKind::Video, Some(encoder), |p| steps.push(p)).await.expect("proxy");
        println!("encoder={} steps={steps:?}", encoder.ffmpeg_name());
        assert_eq!(relative, "proxy/asset-1.mp4");
        assert!(root.join(&relative).is_file());
        assert_eq!(steps.last().copied(), Some(100));
        let _ = std::fs::remove_dir_all(&root);
    }
}
