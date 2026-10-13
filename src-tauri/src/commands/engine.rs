//! Engine commands: FFmpeg diagnostics and TTS.

use std::collections::HashMap;

use serde::Serialize;

use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, ErrorKind};
use crate::ffmpeg::{self, Codec, DependencyReport, EncoderDetection, VideoEncoder};
use crate::jobs::{validate_job_id, Job, JobKind};
use crate::project::TTS_CACHE_DIR;
use crate::tts::{self, TtsRequest, TtsResult, VoiceInfo, WordBoundary};

use super::AppState;

/// Diagnostics for the binaries every job uses (configured custom → bundled → PATH).
#[tauri::command]
pub async fn check_dependencies() -> Result<DependencyReport, AppError> {
    Ok(ffmpeg::check_dependencies(None).await)
}

#[tauri::command]
pub async fn detect_encoder(app: AppHandle, state: State<'_, AppState>, job_id: String) -> Result<EncoderReport, AppError> {
    let job_id = validate_job_id(&job_id)?;
    let job = Job::start(&app, &job_id, JobKind::EncoderDetection);
    let progress = |encoder: VideoEncoder| job.progress(format!("Menguji {}…", encoder.ffmpeg_name()));
    let result = async {
        let av1 = ffmpeg::detect_encoder(None, Codec::Av1, progress).await?;
        let h264 = ffmpeg::detect_encoder(None, Codec::H264, progress).await?;
        Ok::<_, AppError>(EncoderReport { av1, h264 })
    }
    .await;
    // Same binary as proxy/export jobs, so the result is reused by them.
    if let Ok(report) = &result {
        let mut cache = state.encoders.lock().await;
        cache.clear();
        for (codec, selected) in [(Codec::Av1, report.av1.selected), (Codec::H264, report.h264.selected)] {
            if let Some(encoder) = selected {
                cache.insert(codec, encoder);
            }
        }
    }
    job.finish(result)
}

/// Both families: AV1 is the default export (ADR D6), H.264 the compatibility option and proxies.
#[derive(Debug, Serialize)]
pub struct EncoderReport {
    pub av1: EncoderDetection,
    pub h264: EncoderDetection,
}

#[tauri::command]
pub async fn tts_synthesize(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    engine: String,
    request: TtsRequest,
) -> Result<TtsResult, AppError> {
    let job_id = validate_job_id(&job_id)?;
    let provider = state.provider(&engine).await?;
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
        Ok(dir) => tts::synthesize_cached(provider.as_ref(), &request, &dir, job_id.clone()).await.map_err(AppError::from),
        Err(err) => Err(err),
    };
    job.finish(result)
}

#[tauri::command]
pub async fn tts_list_voices(state: State<'_, AppState>, engine: String) -> Result<Vec<VoiceInfo>, AppError> {
    Ok(state.provider(&engine).await?.list_voices().await?)
}

const MAX_BOUNDARY_LOOKUPS: usize = 5_000;

/// Word timings for subtitles, read from the open project's TTS cache.
#[tauri::command]
pub async fn tts_word_boundaries(state: State<'_, AppState>, sha256s: Vec<String>) -> Result<HashMap<String, Vec<WordBoundary>>, AppError> {
    if sha256s.len() > MAX_BOUNDARY_LOOKUPS {
        return Err(AppError::new(ErrorKind::InvalidRequest, "terlalu banyak entri"));
    }
    let root = state.session.require_root()?;
    Ok(tts::read_word_boundaries(&root.join(TTS_CACHE_DIR), &sha256s).await)
}
