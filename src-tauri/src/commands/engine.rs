//! Engine commands: FFmpeg diagnostics and TTS.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, ErrorKind};
use crate::ffmpeg::{self, DependencyReport, EncoderDetection};
use crate::jobs::{validate_job_id, Job, JobKind};
use crate::project::TTS_CACHE_DIR;
use crate::tts::{self, TtsRequest, TtsResult, VoiceInfo};

use super::AppState;

fn custom_path(value: Option<String>) -> Option<PathBuf> {
    value.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty()).map(PathBuf::from)
}

#[tauri::command]
pub async fn check_dependencies(custom_ffmpeg_path: Option<String>) -> Result<DependencyReport, AppError> {
    Ok(ffmpeg::check_dependencies(custom_path(custom_ffmpeg_path).as_deref()).await)
}

#[tauri::command]
pub async fn detect_encoder(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    custom_ffmpeg_path: Option<String>,
) -> Result<EncoderDetection, AppError> {
    let job_id = validate_job_id(&job_id)?;
    let custom = custom_path(custom_ffmpeg_path);
    let job = Job::start(&app, &job_id, JobKind::EncoderDetection);
    let result = ffmpeg::detect_encoder(custom.as_deref(), |encoder| {
        job.progress(format!("Menguji {}…", encoder.ffmpeg_name()));
    })
    .await
    .map_err(AppError::from);
    // Proxy jobs run the default-resolved ffmpeg, so only a detection on that binary is reusable.
    if let (Ok(detection), None) = (&result, &custom) {
        *state.encoder.lock().await = detection.selected;
    }
    job.finish(result)
}

#[tauri::command]
pub async fn tts_synthesize(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    request: TtsRequest,
) -> Result<TtsResult, AppError> {
    let job_id = validate_job_id(&job_id)?;
    let job = Job::start(&app, &job_id, JobKind::Tts);
    // Audio belongs to the open project (cache/tts); without a project, the app cache is used.
    let cache_dir = match state.session.root() {
        Some(root) => Ok(root.join(TTS_CACHE_DIR)),
        None => app
            .path()
            .app_cache_dir()
            .map(|dir| dir.join("tts"))
            .map_err(|e| AppError::new(ErrorKind::Io, format!("folder cache aplikasi: {e}"))),
    };
    let result = match cache_dir {
        Ok(dir) => tts::synthesize_cached(state.tts.as_ref(), &request, &dir, job_id.clone()).await.map_err(AppError::from),
        Err(err) => Err(err),
    };
    job.finish(result)
}

#[tauri::command]
pub async fn tts_list_voices(state: State<'_, AppState>) -> Result<Vec<VoiceInfo>, AppError> {
    Ok(state.tts.list_voices().await?)
}
