//! Export commands (Phase 5). One export at a time; the output path comes from a save dialog
//! opened here, never from the webview.

use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::watch;

use crate::dialog::{self, Filter};
use crate::error::{AppError, ErrorKind};
use crate::jobs::{validate_job_id, Job, JobKind};
use crate::project::safe_file_stem;
use crate::render::export::{run_export, ExportError, ExportJob, PresetId};
use crate::render::model::Manifest;

use super::AppState;

pub const RENDER_PROGRESS_EVENT: &str = "render://progress";
const MAX_REQUEST_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportRequest {
    /// Current in-memory manifest (may be unsaved), already validated by the UI's Zod schema.
    pub manifest_json: String,
    pub title: String,
    pub preset: PresetId,
    /// Subtitles/badges/spotlight overlay, burned in when present.
    pub overlay_ass: Option<String>,
    /// Sidecar `.srt` written next to the output when present.
    pub srt: Option<String>,
}

impl From<ExportError> for AppError {
    fn from(err: ExportError) -> Self {
        match err {
            ExportError::Ffmpeg(inner) => inner.into(),
            ExportError::Io(_) => AppError::new(ErrorKind::Io, err.to_string()),
            ExportError::Graph(_) | ExportError::BadManifest(_) | ExportError::MissingMedia(_) | ExportError::AspectMismatch(..) => {
                AppError::new(ErrorKind::InvalidRequest, err.to_string())
            }
        }
    }
}

/// Removes the cancel handle however the export ends (success, error, panic unwinding).
struct Registration<'a> {
    state: &'a AppState,
    job_id: String,
}

impl Drop for Registration<'_> {
    fn drop(&mut self) {
        self.state.exports.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(&self.job_id);
    }
}

/// Returns the written file, or `None` when the user cancelled the save dialog.
#[tauri::command]
pub async fn export_start(app: AppHandle, state: State<'_, AppState>, job_id: String, request: ExportRequest) -> Result<Option<String>, AppError> {
    let job_id = validate_job_id(&job_id)?;
    let root = state.session.require_root()?;
    let size = request.manifest_json.len() + request.overlay_ass.as_ref().map_or(0, String::len) + request.srt.as_ref().map_or(0, String::len);
    if size > MAX_REQUEST_BYTES {
        return Err(AppError::new(ErrorKind::InvalidRequest, "permintaan ekspor terlalu besar"));
    }
    let manifest: Manifest =
        serde_json::from_str(&request.manifest_json).map_err(|e| AppError::from(ExportError::BadManifest(e.to_string())))?;
    if !state.exports.lock().unwrap_or_else(std::sync::PoisonError::into_inner).is_empty() {
        return Err(AppError::new(ErrorKind::InvalidRequest, "Ekspor lain sedang berjalan."));
    }

    let extension = request.preset.extension();
    let default_name = format!("{}.{extension}", safe_file_stem(&request.title));
    let filter = if extension == "m4a" {
        Filter { name: "Audio M4A", extensions: &["m4a"] }
    } else {
        Filter { name: "Video MP4", extensions: &["mp4"] }
    };
    let Some(output) = dialog::save_file(&app, "Simpan hasil ekspor", &default_name, &filter).await else {
        return Ok(None);
    };
    let encoder = match request.preset.preset() {
        Some(_) => Some(state.encoder().await?),
        None => None,
    };

    let (cancel_tx, cancel_rx) = watch::channel(false);
    {
        let mut exports = state.exports.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if !exports.is_empty() {
            return Err(AppError::new(ErrorKind::InvalidRequest, "Ekspor lain sedang berjalan."));
        }
        exports.insert(job_id.clone(), cancel_tx);
    }
    let _registration = Registration { state: &state, job_id: job_id.clone() };

    let job = Job::start(&app, &job_id, JobKind::Export);
    let export = ExportJob {
        job_id: &job_id,
        project_root: &root,
        manifest,
        preset: request.preset,
        output,
        encoder,
        overlay_ass: request.overlay_ass,
        srt: request.srt,
    };
    let result = run_export(export, cancel_rx, |progress| {
        if let Err(err) = app.emit(RENDER_PROGRESS_EVENT, &progress) {
            tracing::warn!(error = %err, "failed to emit render progress");
        }
    })
    .await
    .map(|path| Some(path.to_string_lossy().into_owned()))
    .map_err(AppError::from);
    job.finish(result)
}

/// Asks a running export to stop; it kills FFmpeg and removes partial output.
#[tauri::command]
pub fn export_cancel(state: State<'_, AppState>, job_id: String) -> bool {
    let exports = state.exports.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    exports.get(&job_id).is_some_and(|tx| tx.send(true).is_ok())
}
