//! Native file dialogs opened from Rust. Paths the app writes to or reads media from always
//! originate here (or from the open project), never from webview input (01 §7).

use std::path::PathBuf;

use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::oneshot;

pub struct Filter {
    pub name: &'static str,
    pub extensions: &'static [&'static str],
}

fn to_path(file: FilePath) -> Option<PathBuf> {
    file.simplified().into_path().ok()
}

pub async fn pick_folder<R: Runtime>(app: &AppHandle<R>, title: &str) -> Option<PathBuf> {
    let (tx, rx) = oneshot::channel();
    app.dialog().file().set_title(title).pick_folder(move |folder| {
        let _ = tx.send(folder.and_then(to_path));
    });
    rx.await.ok().flatten()
}

pub async fn pick_file<R: Runtime>(app: &AppHandle<R>, title: &str, filters: &[Filter]) -> Option<PathBuf> {
    let (tx, rx) = oneshot::channel();
    let mut builder = app.dialog().file().set_title(title);
    for filter in filters {
        builder = builder.add_filter(filter.name, filter.extensions);
    }
    builder.pick_file(move |file| {
        let _ = tx.send(file.and_then(to_path));
    });
    rx.await.ok().flatten()
}

pub async fn pick_files<R: Runtime>(app: &AppHandle<R>, title: &str, filters: &[Filter]) -> Vec<PathBuf> {
    let (tx, rx) = oneshot::channel();
    let mut builder = app.dialog().file().set_title(title);
    for filter in filters {
        builder = builder.add_filter(filter.name, filter.extensions);
    }
    builder.pick_files(move |files| {
        let paths = files.unwrap_or_default().into_iter().filter_map(to_path).collect::<Vec<_>>();
        let _ = tx.send(paths);
    });
    rx.await.unwrap_or_default()
}

/// Save dialog; the chosen path is the only place an export may write.
pub async fn save_file<R: Runtime>(app: &AppHandle<R>, title: &str, default_name: &str, filter: &Filter) -> Option<PathBuf> {
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .set_title(title)
        .set_file_name(default_name)
        .add_filter(filter.name, filter.extensions)
        .save_file(move |file| {
            let _ = tx.send(file.and_then(to_path));
        });
    rx.await.ok().flatten()
}
