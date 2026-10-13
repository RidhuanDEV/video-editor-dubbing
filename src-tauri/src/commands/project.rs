//! Project lifecycle commands. Folders come from native dialogs; manifest content is opaque
//! text here and validated by the UI's Zod schema (02 §3).

use tauri::{AppHandle, Manager, Runtime, State};

use crate::dialog;
use crate::error::{AppError, ErrorKind};
use crate::project::{self, OpenedProject};

use super::AppState;

const MAX_TITLE_CHARS: usize = 255;

/// Thumbnails inside the project are shown via the asset protocol; scope it to this folder only.
fn allow_assets<R: Runtime>(app: &AppHandle<R>, root: &std::path::Path) -> Result<(), AppError> {
    app.asset_protocol_scope()
        .allow_directory(root, true)
        .map_err(|e| AppError::new(ErrorKind::Io, format!("izin folder proyek: {e}")))
}

/// Returns `None` when the user cancels the dialog.
#[tauri::command]
pub async fn project_create(app: AppHandle, state: State<'_, AppState>, title: String) -> Result<Option<OpenedProject>, AppError> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        return Err(AppError::new(ErrorKind::InvalidRequest, "judul proyek wajib diisi (maks. 255 karakter)"));
    }
    let Some(parent) = dialog::pick_folder(&app, "Pilih lokasi untuk folder proyek baru").await else {
        return Ok(None);
    };
    let root = project::create(&parent, title)?;
    allow_assets(&app, &root)?;
    state.session.set(Some(root.clone()));
    tracing::info!("project created");
    Ok(Some(OpenedProject { root, manifest_json: None, recovery_json: None }))
}

#[tauri::command]
pub async fn project_open(app: AppHandle, state: State<'_, AppState>) -> Result<Option<OpenedProject>, AppError> {
    let Some(root) = dialog::pick_folder(&app, "Buka folder proyek (.smbproj)").await else {
        return Ok(None);
    };
    let opened = project::open(&root)?;
    allow_assets(&app, &root)?;
    state.session.set(Some(root));
    tracing::info!(recovery = opened.recovery_json.is_some(), "project opened");
    Ok(Some(opened))
}

#[tauri::command]
pub fn project_save(state: State<'_, AppState>, manifest_json: String) -> Result<(), AppError> {
    let root = state.session.require_root()?;
    project::save(&root, &manifest_json)?;
    Ok(())
}

#[tauri::command]
pub fn project_autosave(state: State<'_, AppState>, manifest_json: String) -> Result<(), AppError> {
    let root = state.session.require_root()?;
    project::autosave(&root, &manifest_json)?;
    Ok(())
}

#[tauri::command]
pub fn project_discard_recovery(state: State<'_, AppState>) -> Result<(), AppError> {
    let root = state.session.require_root()?;
    project::discard_autosave(&root)?;
    Ok(())
}

#[tauri::command]
pub fn project_close(state: State<'_, AppState>) {
    state.session.set(None);
    tracing::info!("project closed");
}
