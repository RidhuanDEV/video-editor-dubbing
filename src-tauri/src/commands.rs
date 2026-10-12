//! Tauri IPC commands. Inputs are untrusted and validated here or in the service they call;
//! every failure crosses the boundary as a typed `AppError`.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, ErrorKind};
use crate::ffmpeg::{self, DependencyReport, EncoderDetection};
use crate::jobs::{validate_job_id, Job, JobKind};
use crate::tts::{self, TtsProvider, TtsRequest, TtsResult, VoiceInfo};

pub struct AppState {
    pub tts: Arc<dyn TtsProvider>,
}

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
    job_id: String,
    custom_ffmpeg_path: Option<String>,
) -> Result<EncoderDetection, AppError> {
    let job_id = validate_job_id(&job_id)?;
    let job = Job::start(&app, &job_id, JobKind::EncoderDetection);
    let result = ffmpeg::detect_encoder(custom_path(custom_ffmpeg_path).as_deref(), |encoder| {
        job.progress(format!("Menguji {}…", encoder.ffmpeg_name()));
    })
    .await
    .map_err(AppError::from);
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
    // Until project folders exist (Phase 2) the cache lives in the app cache dir.
    let result = match app.path().app_cache_dir() {
        Ok(dir) => tts::synthesize_cached(state.tts.as_ref(), &request, &dir.join("tts"), job_id.clone())
            .await
            .map_err(AppError::from),
        Err(e) => Err(AppError::new(ErrorKind::Io, format!("folder cache aplikasi: {e}"))),
    };
    job.finish(result)
}

#[tauri::command]
pub async fn tts_list_voices(state: State<'_, AppState>) -> Result<Vec<VoiceInfo>, AppError> {
    Ok(state.tts.list_voices().await?)
}
