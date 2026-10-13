//! Project folder service (ADR D2, 01 §6):
//!
//! ```text
//! <Title>.smbproj/
//! ├── project.json          manifest (validated by Zod in the UI; Rust treats it as opaque text)
//! ├── cache/tts/            <sha256>.mp3 + .json
//! ├── cache/waveforms/
//! ├── proxy/thumbs/         <assetId>.jpg
//! └── autosave/project.autosave.json
//! ```
//!
//! Writes only ever target fixed file names inside the currently open project root, and are
//! atomic (temp + rename) so a crash never leaves a truncated manifest.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::Serialize;
use thiserror::Error;

pub const MANIFEST_FILE: &str = "project.json";
const AUTOSAVE_DIR: &str = "autosave";
const AUTOSAVE_FILE: &str = "project.autosave.json";
pub const PROJECT_EXTENSION: &str = "smbproj";
pub const TTS_CACHE_DIR: &str = "cache/tts";
pub const THUMBS_DIR: &str = "proxy/thumbs";
pub const WAVEFORMS_DIR: &str = "cache/waveforms";
const LAYOUT_DIRS: [&str; 4] = [TTS_CACHE_DIR, WAVEFORMS_DIR, THUMBS_DIR, AUTOSAVE_DIR];
/// Far above any realistic manifest; protects against loading a hostile multi-GB file.
const MAX_MANIFEST_BYTES: u64 = 32 * 1024 * 1024;
const MAX_TITLE_CHARS: usize = 80;

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error("Tidak ada proyek yang terbuka")]
    NotOpen,
    #[error("Folder proyek sudah ada: {0}")]
    AlreadyExists(String),
    #[error("Bukan folder proyek (project.json tidak ditemukan): {0}")]
    NotAProject(String),
    #[error("File proyek terlalu besar ({0} byte)")]
    TooLarge(u64),
    #[error("Gagal mengakses folder proyek: {0}")]
    Io(String),
}

impl From<std::io::Error> for ProjectError {
    fn from(err: std::io::Error) -> Self {
        ProjectError::Io(err.to_string())
    }
}

/// The open project root, shared by project, media and TTS commands.
#[derive(Default)]
pub struct ProjectSession {
    root: Mutex<Option<PathBuf>>,
}

impl ProjectSession {
    pub fn set(&self, root: Option<PathBuf>) {
        *self.root.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = root;
    }

    /// Cloned out so the lock is never held across an `.await`.
    pub fn root(&self) -> Option<PathBuf> {
        self.root.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }

    pub fn require_root(&self) -> Result<PathBuf, ProjectError> {
        self.root().ok_or(ProjectError::NotOpen)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProject {
    pub root: PathBuf,
    /// `None` for a freshly created project (the UI writes the initial manifest).
    pub manifest_json: Option<String>,
    /// Autosave newer than the manifest: the previous session ended without saving.
    pub recovery_json: Option<String>,
}

/// Project folder name: `<safe stem>.smbproj`.
pub fn folder_name_for(title: &str) -> String {
    format!("{}.{PROJECT_EXTENSION}", safe_file_stem(title))
}

/// File-name-safe stem: letters, digits, space, `-`, `_`; never a Windows reserved device name.
pub fn safe_file_stem(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_') { c } else { ' ' })
        .collect();
    let mut name = cleaned.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(MAX_TITLE_CHARS).collect::<String>();
    name = name.trim().to_owned();
    if name.is_empty() {
        name = "Proyek".to_owned();
    }
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
        "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.iter().any(|r| r.eq_ignore_ascii_case(&name)) {
        name = format!("Proyek {name}");
    }
    name
}

pub fn create(parent: &Path, title: &str) -> Result<PathBuf, ProjectError> {
    let root = parent.join(folder_name_for(title));
    if root.exists() {
        return Err(ProjectError::AlreadyExists(root.display().to_string()));
    }
    for dir in LAYOUT_DIRS {
        std::fs::create_dir_all(root.join(dir))?;
    }
    Ok(root)
}

pub fn open(root: &Path) -> Result<OpenedProject, ProjectError> {
    let manifest_path = root.join(MANIFEST_FILE);
    if !manifest_path.is_file() {
        return Err(ProjectError::NotAProject(root.display().to_string()));
    }
    // Older or hand-made projects may lack some cache folders; recreate them quietly.
    for dir in LAYOUT_DIRS {
        std::fs::create_dir_all(root.join(dir))?;
    }
    let manifest_json = read_limited(&manifest_path)?;

    let autosave_path = autosave_path(root);
    let recovery_json = if is_newer(&autosave_path, &manifest_path) { Some(read_limited(&autosave_path)?) } else { None };

    Ok(OpenedProject { root: root.to_path_buf(), manifest_json: Some(manifest_json), recovery_json })
}

pub fn save(root: &Path, manifest_json: &str) -> Result<(), ProjectError> {
    check_size(manifest_json)?;
    write_atomic(&root.join(MANIFEST_FILE), manifest_json.as_bytes())?;
    // A successful save supersedes the crash-recovery copy.
    match std::fs::remove_file(autosave_path(root)) {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.into()),
        _ => Ok(()),
    }
}

pub fn autosave(root: &Path, manifest_json: &str) -> Result<(), ProjectError> {
    check_size(manifest_json)?;
    std::fs::create_dir_all(root.join(AUTOSAVE_DIR))?;
    write_atomic(&autosave_path(root), manifest_json.as_bytes())
}

/// Recovery was declined: drop the autosave so the prompt does not reappear.
pub fn discard_autosave(root: &Path) -> Result<(), ProjectError> {
    match std::fs::remove_file(autosave_path(root)) {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.into()),
        _ => Ok(()),
    }
}

fn autosave_path(root: &Path) -> PathBuf {
    root.join(AUTOSAVE_DIR).join(AUTOSAVE_FILE)
}

fn check_size(json: &str) -> Result<(), ProjectError> {
    let len = json.len() as u64;
    if len > MAX_MANIFEST_BYTES {
        return Err(ProjectError::TooLarge(len));
    }
    Ok(())
}

fn read_limited(path: &Path) -> Result<String, ProjectError> {
    let len = std::fs::metadata(path)?.len();
    if len > MAX_MANIFEST_BYTES {
        return Err(ProjectError::TooLarge(len));
    }
    Ok(std::fs::read_to_string(path)?)
}

fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

fn is_newer(candidate: &Path, reference: &Path) -> bool {
    match (modified(candidate), modified(reference)) {
        (Some(c), Some(r)) => c > r,
        (Some(_), None) => true,
        _ => false,
    }
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), ProjectError> {
    let tmp = path.with_extension(format!("{}.part", uuid::Uuid::new_v4().simple()));
    let result = std::fs::write(&tmp, bytes).and_then(|()| std::fs::rename(&tmp, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(result?)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("script-studio-project-{}", uuid::Uuid::new_v4().simple()));
            std::fs::create_dir_all(&dir).expect("temp dir");
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn folder_names_are_safe() {
        assert_eq!(folder_name_for("Tutorial SUMBA: Login/Logout"), "Tutorial SUMBA Login Logout.smbproj");
        assert_eq!(folder_name_for("../../etc"), "etc.smbproj");
        assert_eq!(folder_name_for("   "), "Proyek.smbproj");
        assert_eq!(folder_name_for("con"), "Proyek con.smbproj");
        assert_eq!(folder_name_for(&"x".repeat(200)).len(), MAX_TITLE_CHARS + ".smbproj".len());
    }

    #[test]
    fn create_open_save_roundtrip() {
        let parent = TempDir::new();
        let root = create(&parent.0, "Demo").expect("create");
        assert!(root.join(TTS_CACHE_DIR).is_dir() && root.join(THUMBS_DIR).is_dir());
        assert!(matches!(open(&root), Err(ProjectError::NotAProject(_))), "no manifest yet");

        save(&root, r#"{"v":1}"#).expect("save");
        let opened = open(&root).expect("open");
        assert_eq!(opened.manifest_json.as_deref(), Some(r#"{"v":1}"#));
        assert!(opened.recovery_json.is_none());
        assert!(matches!(create(&parent.0, "Demo"), Err(ProjectError::AlreadyExists(_))));
    }

    #[test]
    fn newer_autosave_is_offered_and_cleared_by_save() {
        let parent = TempDir::new();
        let root = create(&parent.0, "Demo").expect("create");
        save(&root, r#"{"v":1}"#).expect("save");
        // Filesystem mtime granularity can be coarse; make the autosave unambiguously newer.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        autosave(&root, r#"{"v":2}"#).expect("autosave");

        assert_eq!(open(&root).expect("open").recovery_json.as_deref(), Some(r#"{"v":2}"#));
        save(&root, r#"{"v":2}"#).expect("save");
        assert!(open(&root).expect("open").recovery_json.is_none());
    }

    #[test]
    fn rejects_oversized_manifest() {
        let parent = TempDir::new();
        let root = create(&parent.0, "Demo").expect("create");
        let huge = "x".repeat(usize::try_from(MAX_MANIFEST_BYTES).expect("fits") + 1);
        assert!(matches!(save(&root, &huge), Err(ProjectError::TooLarge(_))));
    }
}
