//! Project lifecycle commands. Folders come from native dialogs, the recent list (which only
//! holds dialog-chosen folders) or a drop on the window captured in Rust; never from webview
//! text. Manifest content is opaque here and validated by the UI's Zod schema (02 §3).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::dialog;
use crate::error::{AppError, ErrorKind};
use crate::project::{self, OpenedProject, MANIFEST_FILE, PROJECT_EXTENSION};

use super::AppState;

/// Only the title is read from the otherwise opaque manifest, for the recent-projects list.
#[derive(Deserialize)]
struct ManifestTitle {
    title: String,
}

fn title_of(manifest_json: &str, root: &Path) -> String {
    serde_json::from_str::<ManifestTitle>(manifest_json)
        .map(|m| m.title)
        .ok()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| root.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default())
}

fn remember(state: &AppState, root: &Path, title: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    // The list is a convenience: failing to persist it must not fail opening the project.
    if let Err(err) = state.settings.update(|s| s.remember_project(root, title, now)) {
        tracing::warn!(error = %err, "recent projects not saved");
    }
}

fn adopt<R: Runtime>(app: &AppHandle<R>, state: &AppState, root: &Path) -> Result<OpenedProject, AppError> {
    let opened = project::open(root)?;
    allow_assets(app, root)?;
    state.session.set(Some(root.to_path_buf()));
    if let Some(json) = &opened.manifest_json {
        remember(state, root, &title_of(json, root));
    }
    tracing::info!(recovery = opened.recovery_json.is_some(), "project opened");
    Ok(opened)
}

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
    remember(&state, &root, title);
    tracing::info!("project created");
    Ok(Some(OpenedProject { root, manifest_json: None, recovery_json: None }))
}

#[tauri::command]
pub async fn project_open(app: AppHandle, state: State<'_, AppState>) -> Result<Option<OpenedProject>, AppError> {
    let Some(root) = dialog::pick_folder(&app, "Buka folder proyek (.smbproj)").await else {
        return Ok(None);
    };
    Ok(Some(adopt(&app, &state, &root)?))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProjectView {
    pub path: String,
    pub title: String,
    pub opened_at: String,
    /// The folder still has a manifest (it may have been moved or deleted since).
    pub available: bool,
}

#[tauri::command]
pub fn recent_projects(state: State<'_, AppState>) -> Vec<RecentProjectView> {
    state
        .settings
        .get()
        .recent_projects
        .into_iter()
        .map(|p| RecentProjectView {
            available: p.path.join(MANIFEST_FILE).is_file(),
            path: p.path.display().to_string(),
            title: p.title,
            opened_at: p.opened_at,
        })
        .collect()
}

/// Reopens a folder from the recent list. Any other path is refused: the list only ever
/// contains folders the user picked in a native dialog.
#[tauri::command]
pub fn project_open_recent(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<OpenedProject, AppError> {
    let known = state.settings.get().recent_projects.into_iter().find(|p| p.path.display().to_string() == path);
    let Some(recent) = known else {
        return Err(AppError::new(ErrorKind::InvalidRequest, "Proyek tidak ada di daftar terbaru."));
    };
    adopt(&app, &state, &recent.path)
}

#[tauri::command]
pub fn recent_projects_forget(state: State<'_, AppState>, path: String) -> Result<(), AppError> {
    state.settings.update(|s| s.recent_projects.retain(|p| p.path.display().to_string() != path))?;
    Ok(())
}

/// A dropped `.smbproj` folder, or a dropped `project.json` inside one.
fn dropped_project(paths: &[PathBuf]) -> Option<PathBuf> {
    paths.iter().find_map(|path| {
        let root = if path.file_name().is_some_and(|n| n == MANIFEST_FILE) { path.parent()?.to_path_buf() } else { path.clone() };
        let is_project = root.extension().is_some_and(|e| e.eq_ignore_ascii_case(PROJECT_EXTENSION)) && root.join(MANIFEST_FILE).is_file();
        is_project.then_some(root)
    })
}

/// Opens a project folder dropped on the window. The paths were captured by the Rust window
/// event handler; the webview only says "open what was dropped". `None`: nothing usable.
#[tauri::command]
pub fn project_open_dropped(app: AppHandle, state: State<'_, AppState>) -> Result<Option<OpenedProject>, AppError> {
    let paths = state.take_dropped();
    match dropped_project(&paths) {
        Some(root) => Ok(Some(adopt(&app, &state, &root)?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn project_save(state: State<'_, AppState>, manifest_json: String) -> Result<(), AppError> {
    let root = state.session.require_root()?;
    project::save(&root, &manifest_json)?;
    // Keeps the recent list's title in step with renames.
    remember(&state, &root, &title_of(&manifest_json, &root));
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
