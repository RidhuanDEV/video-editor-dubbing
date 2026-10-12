mod commands;
mod error;
mod ffmpeg;
mod jobs;
mod logging;
mod tts;

use std::sync::Arc;

use tauri::Manager;

use crate::commands::AppState;
use crate::tts::EdgeTtsProvider;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .setup(|app| {
            let log_guard = logging::init(&app.path().app_log_dir()?)?;
            app.manage(log_guard);
            app.manage(AppState { tts: Arc::new(EdgeTtsProvider::new()?) });
            tracing::info!(version = env!("CARGO_PKG_VERSION"), "app started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::check_dependencies,
            commands::detect_encoder,
            commands::tts_synthesize,
            commands::tts_list_voices,
        ])
        .run(tauri::generate_context!());

    if let Err(err) = result {
        // Logging may not be initialised if setup itself failed.
        eprintln!("script-studio failed to start: {err}");
        std::process::exit(1);
    }
}
