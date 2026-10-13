//! Settings commands. The Azure key goes into the OS credential store and is never returned.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::error::AppError;
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
}

async fn view(state: &AppState) -> Result<SettingsView, AppError> {
    let current = state.settings.get();
    Ok(SettingsView {
        edge_tts_consent: current.edge_tts_consent,
        azure_region: current.azure_region,
        azure_key_stored: settings::read_azure_key().await?.is_some(),
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
