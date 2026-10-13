mod commands;
mod dialog;
mod error;
mod ffmpeg;
mod jobs;
mod logging;
mod media;
mod project;
mod proxy;
mod render;
mod settings;
mod tts;
mod waveform;

use std::sync::Arc;

use serde::Serialize;
use tauri::{DragDropEvent, Emitter, Manager, WindowEvent};

use crate::commands::AppState;
use crate::tts::EdgeTtsProvider;

/// Emitted after files are dropped on the window; the UI then calls a `*_dropped` command.
const FILES_DROPPED_EVENT: &str = "app://files-dropped";

#[derive(Clone, Serialize)]
struct DropSummary {
    count: usize,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        // Must be registered first: a second launch only focuses the running window, so two
        // processes never edit the same project folder.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let log_guard = logging::init(&app.path().app_log_dir()?)?;
            app.manage(log_guard);
            let settings = settings::SettingsStore::load(&app.path().app_config_dir()?);
            ffmpeg::set_configured_custom(settings.get().custom_ffmpeg_path);
            app.manage(AppState::new(Arc::new(EdgeTtsProvider::new()?), settings));
            tracing::info!(version = env!("CARGO_PKG_VERSION"), "app started");
            Ok(())
        })
        .on_window_event(|window, event| {
            // Drops are captured here so file paths never travel from the webview into commands.
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                let summary = DropSummary { count: paths.len() };
                window.state::<AppState>().set_dropped(paths.clone());
                if let Err(err) = window.emit(FILES_DROPPED_EVENT, summary) {
                    tracing::warn!(error = %err, "drop event not delivered");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::engine::check_dependencies,
            commands::engine::detect_encoder,
            commands::engine::tts_synthesize,
            commands::engine::tts_list_voices,
            commands::engine::tts_word_boundaries,
            commands::project::recent_projects,
            commands::project::recent_projects_forget,
            commands::project::project_open_recent,
            commands::project::project_open_dropped,
            commands::project::project_create,
            commands::project::project_open,
            commands::project::project_save,
            commands::project::project_autosave,
            commands::project::project_discard_recovery,
            commands::project::project_close,
            commands::media::media_import,
            commands::media::media_check_paths,
            commands::media::media_relink_file,
            commands::media::media_relink_folder,
            commands::media::media_build_proxy,
            commands::media::media_import_dropped,
            commands::media::audio_peaks,
            commands::export::export_start,
            commands::export::export_cancel,
            commands::settings::settings_get,
            commands::settings::settings_set_edge_consent,
            commands::settings::settings_set_azure,
            commands::settings::settings_clear_azure,
            commands::settings::settings_pick_ffmpeg,
            commands::settings::settings_clear_ffmpeg,
        ])
        .run(tauri::generate_context!());

    if let Err(err) = result {
        // Logging may not be initialised if setup itself failed.
        eprintln!("script-studio failed to start: {err}");
        std::process::exit(1);
    }
}
