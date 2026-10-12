//! `check_dependencies`: which ffmpeg/ffprobe will be used, its version and build license.
//! A GPL or nonfree build is reported so it never ends up in the bundle unnoticed (ADR D3).

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use super::process::{error_summary, run};
use super::resolver::{resolve, BinarySource};
use super::Tool;

const VERSION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FfmpegLicense {
    Lgpl,
    Gpl,
    Nonfree,
    Undetected,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ToolStatus {
    Found { path: PathBuf, source: BinarySource, version: String, license: FfmpegLicense },
    Missing { reason: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyReport {
    pub ffmpeg: ToolStatus,
    pub ffprobe: ToolStatus,
}

pub async fn check_dependencies(custom_ffmpeg: Option<&Path>) -> DependencyReport {
    let (ffmpeg, ffprobe) = tokio::join!(tool_status(Tool::Ffmpeg, custom_ffmpeg), tool_status(Tool::Ffprobe, custom_ffmpeg));
    DependencyReport { ffmpeg, ffprobe }
}

async fn tool_status(tool: Tool, custom_ffmpeg: Option<&Path>) -> ToolStatus {
    let resolved = match resolve(tool, custom_ffmpeg) {
        Ok(resolved) => resolved,
        Err(err) => return ToolStatus::Missing { reason: err.to_string() },
    };
    match run(&resolved.path, &["-hide_banner", "-version"], VERSION_TIMEOUT).await {
        Ok(output) if output.success => {
            let (version, license) = parse_version_output(&output.stdout);
            ToolStatus::Found { path: resolved.path, source: resolved.source, version, license }
        }
        Ok(output) => ToolStatus::Missing { reason: format!("{} -version gagal: {}", tool.name(), error_summary(&output.stderr)) },
        Err(err) => ToolStatus::Missing { reason: err.to_string() },
    }
}

/// First line is `ffmpeg version <v> Copyright ...`; the `configuration:` line lists build flags.
pub(crate) fn parse_version_output(stdout: &str) -> (String, FfmpegLicense) {
    let version = stdout
        .lines()
        .next()
        .map(|line| line.split(" Copyright").next().unwrap_or(line).trim().to_owned())
        .filter(|line| !line.is_empty())
        .unwrap_or_else(|| "versi tidak terbaca".to_owned());

    let license = match stdout.lines().find(|l| l.trim_start().starts_with("configuration:")) {
        None => FfmpegLicense::Undetected,
        Some(config) => {
            let has_flag = |flag: &str| config.split_whitespace().any(|token| token == flag);
            if has_flag("--enable-nonfree") {
                FfmpegLicense::Nonfree
            } else if has_flag("--enable-gpl") {
                FfmpegLicense::Gpl
            } else {
                FfmpegLicense::Lgpl
            }
        }
    };
    (version, license)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_lgpl_build() {
        let out = "ffmpeg version n7.1 Copyright (c) 2000-2024 the FFmpeg developers\n  built with gcc\n  configuration: --enable-shared --enable-libopenh264 --enable-nvenc\n";
        assert_eq!(parse_version_output(out), ("ffmpeg version n7.1".to_owned(), FfmpegLicense::Lgpl));
    }

    #[test]
    fn detects_gpl_and_nonfree_builds() {
        let gpl = "ffmpeg version 7.1\n  configuration: --enable-gpl --enable-libx264\n";
        assert_eq!(parse_version_output(gpl).1, FfmpegLicense::Gpl);
        let nonfree = "ffmpeg version 7.1\n  configuration: --enable-gpl --enable-nonfree\n";
        assert_eq!(parse_version_output(nonfree).1, FfmpegLicense::Nonfree);
    }

    #[test]
    fn flag_match_is_exact() {
        let out = "ffmpeg version 7.1\n  configuration: --enable-gpl-like-but-not\n";
        assert_eq!(parse_version_output(out).1, FfmpegLicense::Lgpl);
    }

    #[test]
    fn handles_missing_configuration() {
        assert_eq!(parse_version_output("").1, FfmpegLicense::Undetected);
    }
}
