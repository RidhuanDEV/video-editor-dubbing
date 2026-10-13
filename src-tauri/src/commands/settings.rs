//! Settings commands. The Azure key goes into the OS credential store and is never returned.
//! The custom FFmpeg comes from a native file dialog, never from webview text: it gets executed.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::dialog::{self, Filter};
use crate::error::{AppError, ErrorKind};
use crate::ffmpeg::{self, ToolStatus};
use crate::settings::{self, validate_azure_key, validate_azure_region};
use crate::tts::{AzureSpeechProvider, TtsProvider};

use super::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub edge_tts_consent: bool,
    pub azure_region: Option<String>,
    /// Whether a key is stored; the key itself never leaves Rust.
    pub azure_key_stored: bool,
    pub custom_ffmpeg_path: Option<String>,
}

async fn view(state: &AppState) -> Result<SettingsView, AppError> {
    let current = state.settings.get();
    Ok(SettingsView {
        edge_tts_consent: current.edge_tts_consent,
        azure_region: current.azure_region,
        azure_key_stored: settings::read_azure_key().await?.is_some(),
        custom_ffmpeg_path: current.custom_ffmpeg_path.map(|p| p.display().to_string()),
    })
}

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<SettingsView, AppError> {
    view(&state).await
}

#[tauri::command]
pub async fn settings_set_edge_consent(state: State<'_, AppState>, consent: bool) -> Result<SettingsView, AppError> {
    state.settings.update(|s| s.edge_tts_consent = consent)?;
    tracing::info!(consent, "edge-tts consent changed");
    view(&state).await
}

/// Verifies the key against the service (lists voices) before storing anything.
/// Returns the number of voices available to that key.
#[tauri::command]
pub async fn settings_set_azure(state: State<'_, AppState>, region: String, key: String) -> Result<usize, AppError> {
    let (region, key) = (region.trim().to_owned(), key.trim().to_owned());
    validate_azure_region(&region)?;
    validate_azure_key(&key)?;
    let provider = Arc::new(AzureSpeechProvider::new(region.clone(), key.clone())?);
    let voices = provider.list_voices().await?.len();
    settings::store_azure_key(key).await?;
    state.settings.update(|s| s.azure_region = Some(region))?;
    *state.azure.lock().await = Some(provider);
    tracing::info!(voices, "azure speech configured");
    Ok(voices)
}

#[tauri::command]
pub async fn settings_clear_azure(state: State<'_, AppState>) -> Result<SettingsView, AppError> {
    settings::delete_azure_key().await?;
    state.settings.update(|s| s.azure_region = None)?;
    *state.azure.lock().await = None;
    view(&state).await
}

#[cfg(windows)]
const FFMPEG_FILTERS: &[Filter] = &[Filter { name: "ffmpeg.exe", extensions: &["exe"] }];
#[cfg(not(windows))]
const FFMPEG_FILTERS: &[Filter] = &[];

/// Picks a custom ffmpeg, checks that it and its ffprobe run, then makes every job use it.
/// Returns `None` when the dialog is cancelled.
#[tauri::command]
pub async fn settings_pick_ffmpeg(app: AppHandle, state: State<'_, AppState>) -> Result<Option<SettingsView>, AppError> {
    let Some(path) = dialog::pick_file(&app, "Pilih ffmpeg kustom (ffprobe harus berada di folder yang sama)", FFMPEG_FILTERS).await else {
        return Ok(None);
    };
    let report = ffmpeg::check_dependencies(Some(&path)).await;
    for status in [&report.ffmpeg, &report.ffprobe] {
        if let ToolStatus::Missing { reason } = status {
            return Err(AppError::new(ErrorKind::BinaryNotFound, reason.clone()));
        }
    }
    state.settings.update(|s| s.custom_ffmpeg_path = Some(path.clone()))?;
    ffmpeg::set_configured_custom(Some(path));
    // Encoders detected on the previous binary may not exist in this one.
    state.encoders.lock().await.clear();
    tracing::info!("custom ffmpeg configured");
    Ok(Some(view(&state).await?))
}

#[tauri::command]
pub async fn settings_clear_ffmpeg(state: State<'_, AppState>) -> Result<SettingsView, AppError> {
    state.settings.update(|s| s.custom_ffmpeg_path = None)?;
    ffmpeg::set_configured_custom(None);
    state.encoders.lock().await.clear();
    view(&state).await
}
