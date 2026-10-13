//! FFmpeg sidecar integration (ADR D3/D4): binary resolution, process supervision with
//! timeouts, dependency report and hardware encoder detection by real test encode.

mod encoder;
mod probe;
mod process;
mod resolver;

pub use encoder::{detect_encoder, EncoderDetection, VideoEncoder};
pub use probe::{check_dependencies, DependencyReport};
pub(crate) use process::{error_summary, progress_out_ms, run, run_with_progress};
pub(crate) use resolver::resolve;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum FfmpegError {
    #[error("{0}")]
    NotFound(String),
    #[error("Path FFmpeg kustom tidak valid: {0}")]
    InvalidCustomPath(String),
    #[error("Gagal menjalankan proses: {0}")]
    Spawn(String),
    #[error("Proses melewati batas waktu: {0}")]
    Timeout(String),
    #[error("Proses gagal: {0}")]
    Failed(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    Ffmpeg,
    Ffprobe,
}

impl Tool {
    pub const fn name(self) -> &'static str {
        match self {
            Tool::Ffmpeg => "ffmpeg",
            Tool::Ffprobe => "ffprobe",
        }
    }
}
