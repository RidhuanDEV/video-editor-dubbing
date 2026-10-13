//! Binary resolution order (01 §4.4, 05 §1): user's custom path → bundled sidecar → system PATH.
//!
//! An explicitly configured custom path that is invalid is an error, not a silent fallback:
//! the user chose that binary (e.g. for libx264) and must know it is not being used.

use std::env;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::Serialize;

use super::{FfmpegError, Tool};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BinarySource {
    Custom,
    Bundled,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedBinary {
    pub path: PathBuf,
    pub source: BinarySource,
}

/// The custom FFmpeg chosen in Settings (persisted in settings.json). Every job resolves
/// through it, so proxies, detection and export all use the same binary.
static CONFIGURED_CUSTOM: RwLock<Option<PathBuf>> = RwLock::new(None);

pub fn set_configured_custom(path: Option<PathBuf>) {
    *CONFIGURED_CUSTOM.write().unwrap_or_else(std::sync::PoisonError::into_inner) = path;
}

/// Resolve against the real environment: sidecars live next to the app executable.
/// `custom_override` tests a candidate path; `None` means the configured custom path, if any.
pub fn resolve(tool: Tool, custom_override: Option<&Path>) -> Result<ResolvedBinary, FfmpegError> {
    let configured = CONFIGURED_CUSTOM.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
    let custom = custom_override.map(Path::to_path_buf).or(configured);
    let exe_dir = env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
    let path_var = env::var_os("PATH");
    resolve_with(tool, custom.as_deref(), exe_dir.as_deref(), path_var.as_deref())
}

pub(crate) fn resolve_with(
    tool: Tool,
    custom_ffmpeg: Option<&Path>,
    bundled_dir: Option<&Path>,
    path_var: Option<&OsStr>,
) -> Result<ResolvedBinary, FfmpegError> {
    if let Some(custom) = custom_ffmpeg {
        return resolve_custom(tool, custom).map(|path| ResolvedBinary { path, source: BinarySource::Custom });
    }

    let file_name = executable_name(tool.name());
    if let Some(dir) = bundled_dir {
        // Installed bundle strips the triple; `tauri dev` keeps `ffmpeg-<triple>`.
        let triple_name = executable_name(&format!("{}-{}", tool.name(), env!("TARGET_TRIPLE")));
        for name in [&file_name, &triple_name] {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(ResolvedBinary { path: candidate, source: BinarySource::Bundled });
            }
        }
    }

    if let Some(paths) = path_var {
        if let Some(found) = env::split_paths(paths).map(|dir| dir.join(&file_name)).find(|p| p.is_file()) {
            return Ok(ResolvedBinary { path: found, source: BinarySource::System });
        }
    }

    Err(FfmpegError::NotFound(format!(
        "{} tidak ditemukan (path kustom → biner dibundle → PATH sistem).",
        tool.name()
    )))
}

/// The custom path points at the ffmpeg executable; ffprobe is expected beside it.
fn resolve_custom(tool: Tool, custom_ffmpeg: &Path) -> Result<PathBuf, FfmpegError> {
    if !custom_ffmpeg.is_absolute() {
        return Err(FfmpegError::InvalidCustomPath(format!("harus path absolut: {}", custom_ffmpeg.display())));
    }
    let stem_ok = custom_ffmpeg
        .file_stem()
        .and_then(OsStr::to_str)
        .is_some_and(|stem| stem.eq_ignore_ascii_case(Tool::Ffmpeg.name()));
    if !stem_ok {
        return Err(FfmpegError::InvalidCustomPath(format!(
            "nama file harus {}: {}",
            executable_name(Tool::Ffmpeg.name()),
            custom_ffmpeg.display()
        )));
    }

    let target = match tool {
        Tool::Ffmpeg => custom_ffmpeg.to_path_buf(),
        Tool::Ffprobe => custom_ffmpeg.with_file_name(executable_name(Tool::Ffprobe.name())),
    };
    if target.is_file() {
        Ok(target)
    } else {
        Err(FfmpegError::InvalidCustomPath(format!("file tidak ada: {}", target.display())))
    }
}

fn executable_name(stem: &str) -> String {
    format!("{stem}{}", env::consts::EXE_SUFFIX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let dir = env::temp_dir().join(format!("script-studio-test-{}", uuid::Uuid::new_v4().simple()));
            fs::create_dir_all(&dir).expect("create temp dir");
            Self(dir)
        }

        fn touch(&self, name: &str) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, b"").expect("create file");
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn prefers_bundled_over_path() {
        let bundled = TempDir::new();
        let system = TempDir::new();
        let expected = bundled.touch(&executable_name("ffmpeg"));
        system.touch(&executable_name("ffmpeg"));
        let path_var = env::join_paths([&system.0]).expect("join paths");

        let resolved = resolve_with(Tool::Ffmpeg, None, Some(&bundled.0), Some(&path_var)).expect("resolved");
        assert_eq!(resolved, ResolvedBinary { path: expected, source: BinarySource::Bundled });
    }

    #[test]
    fn finds_bundled_sidecar_with_target_triple() {
        let bundled = TempDir::new();
        let expected = bundled.touch(&executable_name(&format!("ffprobe-{}", env!("TARGET_TRIPLE"))));

        let resolved = resolve_with(Tool::Ffprobe, None, Some(&bundled.0), None).expect("resolved");
        assert_eq!(resolved.path, expected);
    }

    #[test]
    fn falls_back_to_system_path() {
        let empty = TempDir::new();
        let system = TempDir::new();
        let expected = system.touch(&executable_name("ffmpeg"));
        let path_var = env::join_paths([&system.0]).expect("join paths");

        let resolved = resolve_with(Tool::Ffmpeg, None, Some(&empty.0), Some(&path_var)).expect("resolved");
        assert_eq!(resolved, ResolvedBinary { path: expected, source: BinarySource::System });
    }

    #[test]
    fn custom_path_wins_and_derives_ffprobe() {
        let custom = TempDir::new();
        let ffmpeg = custom.touch(&executable_name("ffmpeg"));
        let ffprobe = custom.touch(&executable_name("ffprobe"));
        let bundled = TempDir::new();
        bundled.touch(&executable_name("ffprobe"));

        let resolved = resolve_with(Tool::Ffprobe, Some(&ffmpeg), Some(&bundled.0), None).expect("resolved");
        assert_eq!(resolved, ResolvedBinary { path: ffprobe, source: BinarySource::Custom });
    }

    #[test]
    fn invalid_custom_path_does_not_fall_back() {
        let bundled = TempDir::new();
        bundled.touch(&executable_name("ffmpeg"));
        let other = TempDir::new();
        let wrong_name = other.touch(&executable_name("notffmpeg"));

        let err = resolve_with(Tool::Ffmpeg, Some(&wrong_name), Some(&bundled.0), None).expect_err("must reject");
        assert!(matches!(err, FfmpegError::InvalidCustomPath(_)));

        let relative = Path::new("ffmpeg");
        let err = resolve_with(Tool::Ffmpeg, Some(relative), Some(&bundled.0), None).expect_err("must reject");
        assert!(matches!(err, FfmpegError::InvalidCustomPath(_)));
    }

    #[test]
    fn reports_not_found() {
        let empty = TempDir::new();
        let err = resolve_with(Tool::Ffmpeg, None, Some(&empty.0), None).expect_err("not found");
        assert!(matches!(err, FfmpegError::NotFound(_)));
    }
}
