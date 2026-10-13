mod commands;
mod dialog;
mod error;
mod ffmpeg;
mod jobs;
mod logging;
mod media;
mod project;
mod proxy;
mod tts;

use std::sync::Arc;

use tauri::Manager;

use crate::commands::AppState;
use crate::tts::EdgeTtsProvider;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let log_guard = logging::init(&app.path().app_log_dir()?)?;
            app.manage(log_guard);
            app.manage(AppState::new(Arc::new(EdgeTtsProvider::new()?)));
            tracing::info!(version = env!("CARGO_PKG_VERSION"), "app started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::engine::check_dependencies,
            commands::engine::detect_encoder,
            commands::engine::tts_synthesize,
            commands::engine::tts_list_voices,
            commands::engine::tts_word_boundaries,
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
        ])
        .run(tauri::generate_context!());

    if let Err(err) = result {
        // Logging may not be initialised if setup itself failed.
        eprintln!("script-studio failed to start: {err}");
        std::process::exit(1);
    }
}
