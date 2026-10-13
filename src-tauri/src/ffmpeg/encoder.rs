//! Encoder detection (05 §2). Being listed in `ffmpeg -encoders` is not enough — the
//! driver/GPU may be absent — so every listed candidate gets a real one-frame test encode.
//! Two families (ADR D6): AV1 (default export, royalty-free) and H.264 (compatibility option,
//! preview proxies). Each chain tries hardware first and ends with an LGPL software encoder.

use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::process::{error_summary, run};
use super::resolver::resolve;
use super::{FfmpegError, Tool};

const LIST_TIMEOUT: Duration = Duration::from_secs(15);
/// First NVENC/AMF init can take several seconds on a cold driver.
const TEST_ENCODE_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Codec {
    H264,
    Av1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum VideoEncoder {
    #[serde(rename = "h264_nvenc")]
    Nvenc,
    #[serde(rename = "h264_qsv")]
    Qsv,
    #[serde(rename = "h264_amf")]
    Amf,
    #[serde(rename = "h264_videotoolbox")]
    VideoToolbox,
    #[serde(rename = "libopenh264")]
    OpenH264,
    #[serde(rename = "av1_nvenc")]
    Av1Nvenc,
    #[serde(rename = "av1_qsv")]
    Av1Qsv,
    #[serde(rename = "av1_amf")]
    Av1Amf,
    #[serde(rename = "libsvtav1")]
    SvtAv1,
}

impl VideoEncoder {
    /// Priority per family: hardware first, software fallback last.
    pub const fn chain(codec: Codec) -> &'static [VideoEncoder] {
        match codec {
            Codec::H264 => &[VideoEncoder::Nvenc, VideoEncoder::Qsv, VideoEncoder::Amf, VideoEncoder::VideoToolbox, VideoEncoder::OpenH264],
            Codec::Av1 => &[VideoEncoder::Av1Nvenc, VideoEncoder::Av1Qsv, VideoEncoder::Av1Amf, VideoEncoder::SvtAv1],
        }
    }

    pub const fn ffmpeg_name(self) -> &'static str {
        match self {
            VideoEncoder::Nvenc => "h264_nvenc",
            VideoEncoder::Qsv => "h264_qsv",
            VideoEncoder::Amf => "h264_amf",
            VideoEncoder::VideoToolbox => "h264_videotoolbox",
            VideoEncoder::OpenH264 => "libopenh264",
            VideoEncoder::Av1Nvenc => "av1_nvenc",
            VideoEncoder::Av1Qsv => "av1_qsv",
            VideoEncoder::Av1Amf => "av1_amf",
            VideoEncoder::SvtAv1 => "libsvtav1",
        }
    }

    pub const fn codec(self) -> Codec {
        match self {
            VideoEncoder::Nvenc | VideoEncoder::Qsv | VideoEncoder::Amf | VideoEncoder::VideoToolbox | VideoEncoder::OpenH264 => Codec::H264,
            VideoEncoder::Av1Nvenc | VideoEncoder::Av1Qsv | VideoEncoder::Av1Amf | VideoEncoder::SvtAv1 => Codec::Av1,
        }
    }

    pub const fn is_hardware(self) -> bool {
        !matches!(self, VideoEncoder::OpenH264 | VideoEncoder::SvtAv1)
    }

    /// Hardware encoders take NV12; the software encoders take planar YUV 4:2:0.
    pub const fn pixel_format(self) -> &'static str {
        match self {
            VideoEncoder::OpenH264 | VideoEncoder::SvtAv1 => "yuv420p",
            _ => "nv12",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderCandidate {
    pub encoder: VideoEncoder,
    pub hardware: bool,
    pub listed: bool,
    pub test_passed: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EncoderDetection {
    pub selected: Option<VideoEncoder>,
    pub candidates: Vec<EncoderCandidate>,
}

/// `on_probe` is called before each real test encode (UI progress; one probe can take seconds).
pub async fn detect_encoder(
    custom_ffmpeg: Option<&Path>,
    codec: Codec,
    on_probe: impl Fn(VideoEncoder) + Send,
) -> Result<EncoderDetection, FfmpegError> {
    let ffmpeg = resolve(Tool::Ffmpeg, custom_ffmpeg)?;
    let listing = run(&ffmpeg.path, &["-hide_banner", "-encoders"], LIST_TIMEOUT).await?;
    if !listing.success {
        return Err(FfmpegError::Failed(format!("ffmpeg -encoders: {}", error_summary(&listing.stderr))));
    }
    let available = listed_encoders(&listing.stdout);

    // Sequential on purpose: parallel GPU session inits can fail spuriously on consumer drivers.
    let chain = VideoEncoder::chain(codec);
    let mut candidates = Vec::with_capacity(chain.len());
    for &encoder in chain {
        let listed = available.iter().any(|name| name == encoder.ffmpeg_name());
        let (test_passed, error) = if listed {
            on_probe(encoder);
            match test_encode(&ffmpeg.path, encoder).await {
                Ok(()) => (true, None),
                Err(err) => (false, Some(err.to_string())),
            }
        } else {
            (false, None)
        };
        tracing::info!(encoder = encoder.ffmpeg_name(), listed, test_passed, "encoder probe");
        candidates.push(EncoderCandidate { encoder, hardware: encoder.is_hardware(), listed, test_passed, error });
    }

    let selected = candidates.iter().find(|c| c.test_passed).map(|c| c.encoder);
    Ok(EncoderDetection { selected, candidates })
}

async fn test_encode(ffmpeg: &Path, encoder: VideoEncoder) -> Result<(), FfmpegError> {
    let args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x256:r=30:d=1",
        "-frames:v",
        "1",
        "-pix_fmt",
        encoder.pixel_format(),
        "-c:v",
        encoder.ffmpeg_name(),
        "-f",
        "null",
        "-",
    ];
    let output = run(ffmpeg, &args, TEST_ENCODE_TIMEOUT).await?;
    if output.success {
        Ok(())
    } else {
        Err(FfmpegError::Failed(error_summary(&output.stderr)))
    }
}

/// Parses `ffmpeg -encoders`: after the ` ------` separator, each row is `<flags> <name> <description>`.
pub(crate) fn listed_encoders(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .skip_while(|line| !line.trim_start().starts_with("------"))
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let flags = parts.next()?;
            let name = parts.next()?;
            flags.starts_with('V').then(|| name.to_owned())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "Encoders:\n V..... = Video\n A..... = Audio\n ------\n V....D libopenh264          OpenH264 H.264 / AVC\n V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)\n A....D aac                  AAC (Advanced Audio Coding)\n";

    #[test]
    fn parses_only_video_encoders_after_separator() {
        assert_eq!(listed_encoders(SAMPLE), vec!["libopenh264".to_owned(), "h264_nvenc".to_owned()]);
    }

    #[test]
    fn legend_lines_are_not_encoders() {
        assert!(!listed_encoders(SAMPLE).iter().any(|n| n == "="));
    }

    /// Live check with the FFmpeg found on this machine: `cargo test -- --ignored live_`.
    #[tokio::test]
    #[ignore = "machine-specific: needs ffmpeg and runs real test encodes"]
    async fn live_detect_encoder() {
        for codec in [Codec::H264, Codec::Av1] {
            let detection = detect_encoder(None, codec, |e| println!("probing {}", e.ffmpeg_name())).await.expect("detection");
            for c in &detection.candidates {
                println!("{:<18} listed={} passed={} error={:?}", c.encoder.ffmpeg_name(), c.listed, c.test_passed, c.error);
            }
            println!("{codec:?} selected={:?}", detection.selected.map(VideoEncoder::ffmpeg_name));
        }
    }

    #[test]
    fn chains_end_with_software_fallback() {
        for codec in [Codec::H264, Codec::Av1] {
            let chain = VideoEncoder::chain(codec);
            let (last, hardware) = chain.split_last().expect("non-empty chain");
            assert!(!last.is_hardware(), "{codec:?} must end with a software encoder");
            assert!(hardware.iter().all(|e| e.is_hardware() && e.codec() == codec));
        }
        assert_eq!(VideoEncoder::chain(Codec::Av1).last().copied(), Some(VideoEncoder::SvtAv1));
    }
}
