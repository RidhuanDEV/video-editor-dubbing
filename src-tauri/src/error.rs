//! Error type crossing the IPC boundary. Serialized as `{ kind, message }`, mirrored by
//! `AppErrorSchema` in `src/types/ipc.ts`.

use serde::Serialize;

use crate::ffmpeg::FfmpegError;
use crate::media::MediaError;
use crate::project::ProjectError;
use crate::tts::TtsError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    Network,
    Blocked,
    Timeout,
    Protocol,
    InvalidRequest,
    Io,
    BinaryNotFound,
    Process,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
}

impl From<TtsError> for AppError {
    fn from(err: TtsError) -> Self {
        let kind = match &err {
            TtsError::Network(_) => ErrorKind::Network,
            TtsError::Blocked(_) => ErrorKind::Blocked,
            TtsError::Timeout(_) => ErrorKind::Timeout,
            TtsError::Protocol(_) => ErrorKind::Protocol,
            TtsError::InvalidRequest(_) => ErrorKind::InvalidRequest,
            TtsError::Io(_) => ErrorKind::Io,
        };
        Self::new(kind, err.to_string())
    }
}

impl From<FfmpegError> for AppError {
    fn from(err: FfmpegError) -> Self {
        let kind = match &err {
            FfmpegError::NotFound(_) | FfmpegError::InvalidCustomPath(_) => ErrorKind::BinaryNotFound,
            FfmpegError::Timeout(_) => ErrorKind::Timeout,
            FfmpegError::Spawn(_) | FfmpegError::Failed(_) => ErrorKind::Process,
        };
        Self::new(kind, err.to_string())
    }
}

impl From<ProjectError> for AppError {
    fn from(err: ProjectError) -> Self {
        let kind = match &err {
            ProjectError::Io(_) => ErrorKind::Io,
            ProjectError::NotOpen | ProjectError::AlreadyExists(_) | ProjectError::NotAProject(_) | ProjectError::TooLarge(_) => {
                ErrorKind::InvalidRequest
            }
        };
        Self::new(kind, err.to_string())
    }
}

impl From<MediaError> for AppError {
    fn from(err: MediaError) -> Self {
        match err {
            MediaError::Ffmpeg(inner) => inner.into(),
            MediaError::Unsupported(_) => Self::new(ErrorKind::InvalidRequest, err.to_string()),
            MediaError::BadProbe(_) => Self::new(ErrorKind::Process, err.to_string()),
        }
    }
}
