//! Media pool commands: import via native dialog, missing-file detection, relink.

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::dialog::{self, Filter};
use crate::error::{AppError, ErrorKind};
use crate::jobs::{validate_job_id, Job, JobKind};
use crate::proxy;
use crate::media::{self, MissingAsset, ProbedMedia, RelinkCandidate, AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS};

use super::{validate_asset_id, AppState};

const MAX_CHECK_PATHS: usize = 10_000;

const MEDIA_FILTERS: [Filter; 4] = [
    Filter { name: "Semua media", extensions: &["mp4", "mov", "mkv", "webm", "avi", "m4v", "mp3", "wav", "m4a", "aac", "ogg", "flac", "opus", "png", "jpg", "jpeg", "webp", "bmp"] },
    Filter { name: "Video", extensions: VIDEO_EXTENSIONS },
    Filter { name: "Audio", extensions: AUDIO_EXTENSIONS },
    Filter { name: "Gambar", extensions: IMAGE_EXTENSIONS },
];

#[derive(Debug, Serialize)]
// rename_all renames variants; rename_all_fields renames fields inside them (file_name -> fileName).
#[serde(tag = "status", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ImportOutcome {
    Imported { media: ProbedMedia },
    Failed { file_name: String, message: String },
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// One bad file never aborts the batch: each file reports its own outcome.
#[tauri::command]
pub async fn media_import(app: AppHandle, state: State<'_, AppState>, job_id: String) -> Result<Vec<ImportOutcome>, AppError> {
    let job_id = validate_job_id(&job_id)?;
    let root = state.session.require_root()?;
    let paths = dialog::pick_files(&app, "Impor media", &MEDIA_FILTERS).await;
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let job = Job::start(&app, &job_id, JobKind::MediaImport);
    let total = paths.len();
    let mut outcomes = Vec::with_capacity(total);
    for (index, path) in paths.iter().enumerate() {
        job.progress(format!("Menganalisis {} ({}/{total})", file_name(path), index + 1));
        let id = uuid::Uuid::new_v4().to_string();
        outcomes.push(match media::import_file(&root, path, id).await {
            Ok(media) => ImportOutcome::Imported { media },
            Err(err) => ImportOutcome::Failed { file_name: file_name(path), message: AppError::from(err).message },
        });
    }
    job.finish(Ok(outcomes))
}

/// `true` per path that still exists. Only booleans leave Rust, never file contents.
#[tauri::command]
pub fn media_check_paths(paths: Vec<String>) -> Result<Vec<bool>, AppError> {
    if paths.len() > MAX_CHECK_PATHS {
        return Err(AppError::new(ErrorKind::InvalidRequest, "terlalu banyak path"));
    }
    Ok(paths.iter().map(|p| Path::new(p).is_file()).collect())
}

#[tauri::command]
pub async fn media_relink_file(
    app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
    expected_duration_ms: Option<u64>,
) -> Result<Option<RelinkCandidate>, AppError> {
    validate_asset_id(&asset_id)?;
    // Relink only makes sense inside an open project.
    state.session.require_root()?;
    let Some(path) = dialog::pick_file(&app, "Pilih file pengganti", &MEDIA_FILTERS).await else {
        return Ok(None);
    };
    Ok(Some(media::relink_candidate(&path, asset_id, expected_duration_ms).await?))
}

/// Searches a chosen folder (and subfolders) for every missing asset by file name.
#[tauri::command]
pub async fn media_relink_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    missing: Vec<MissingAsset>,
) -> Result<Vec<RelinkCandidate>, AppError> {
    let job_id = validate_job_id(&job_id)?;
    for asset in &missing {
        validate_asset_id(&asset.id)?;
    }
    state.session.require_root()?;
    let Some(folder) = dialog::pick_folder(&app, "Pilih folder tempat media dipindahkan").await else {
        return Ok(Vec::new());
    };

    let job = Job::start(&app, &job_id, JobKind::MediaRelink);
    job.progress("Mencari file…");
    let search_folder = folder.clone();
    let search_missing = missing.clone();
    let found = tokio::task::spawn_blocking(move || media::find_by_name(&search_folder, &search_missing))
        .await
        .map_err(|e| AppError::new(ErrorKind::Process, format!("pencarian file: {e}")));
    let found = match found {
        Ok(found) => found,
        Err(err) => return job.finish(Err(err)),
    };

    let mut candidates = Vec::with_capacity(found.len());
    for (index, path) in found {
        let asset = &missing[index];
        job.progress(format!("Memeriksa {}", asset.file_name));
        match media::relink_candidate(&path, asset.id.clone(), asset.duration_ms).await {
            Ok(candidate) => candidates.push(candidate),
            Err(err) => tracing::warn!(asset_id = asset.id, error = %err, "relink candidate rejected"),
        }
    }
    job.finish(Ok(candidates))
}

/// Builds the preview proxy for one asset (video or BGM audio); returns its project-relative path.
#[tauri::command]
pub async fn media_build_proxy(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    asset_id: String,
    file_path: String,
    duration_ms: Option<u64>,
    kind: proxy::ProxyKind,
) -> Result<String, AppError> {
    let job_id = validate_job_id(&job_id)?;
    validate_asset_id(&asset_id)?;
    let root = state.session.require_root()?;
    let source = std::path::PathBuf::from(&file_path);
    if !source.is_file() {
        return Err(AppError::new(ErrorKind::InvalidRequest, "file sumber tidak ditemukan"));
    }
    let encoder = match kind {
        proxy::ProxyKind::Video => Some(state.encoder().await?),
        proxy::ProxyKind::Audio => None,
    };

    let job = Job::start(&app, &job_id, JobKind::MediaProxy);
    let result = proxy::build_proxy(&root, &asset_id, &source, duration_ms, kind, encoder, |percent| {
        job.progress(format!("{percent}"));
    })
    .await
    .map_err(AppError::from);
    job.finish(result)
}
