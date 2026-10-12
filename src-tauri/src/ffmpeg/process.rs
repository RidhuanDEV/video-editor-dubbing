//! Runs FFmpeg/FFprobe with an argument array (never a shell string), a hard timeout, and
//! kill-on-drop so a cancelled or timed-out call never leaves an orphan process.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

use super::FfmpegError;

pub struct ProcessOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

pub async fn run(program: &Path, args: &[&str], timeout: Duration) -> Result<ProcessOutput, FfmpegError> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: no console flash for every probe in the GUI build.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let label = program.file_name().map_or_else(|| program.display().to_string(), |n| n.to_string_lossy().into_owned());
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| FfmpegError::Timeout(format!("{label} ({} dtk)", timeout.as_secs())))?
        .map_err(|e| FfmpegError::Spawn(format!("{label}: {e}")))?;

    Ok(ProcessOutput {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// Short failure reason from FFmpeg stderr. FFmpeg prints the root cause first (e.g. "Driver does
/// not support the required nvenc API version") followed by a cascade of generic consequences
/// ("Nothing was written into output file"), so the first lines are the useful ones.
pub fn error_summary(stderr: &str) -> String {
    const MAX_LINES: usize = 2;
    const MAX_CHARS: usize = 300;
    let summary = stderr
        .lines()
        .map(strip_component_prefix)
        .filter(|line| !line.is_empty())
        .take(MAX_LINES)
        .collect::<Vec<_>>()
        .join(" ");
    if summary.is_empty() {
        return "tanpa keluaran error".to_owned();
    }
    summary.chars().take(MAX_CHARS).collect()
}

/// `[h264_nvenc @ 000002...] message` → `message` (the pointer is noise for users).
fn strip_component_prefix(line: &str) -> &str {
    let line = line.trim();
    match line.strip_prefix('[').and_then(|rest| rest.split_once("] ")) {
        Some((component, message)) if component.contains(" @ ") => message.trim(),
        _ => line,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_keeps_root_cause_not_cascade() {
        let stderr = "[h264_nvenc @ 00000215ade03bc0] Driver does not support the required nvenc API version. Required: 13.1 Found: 13.0\n\
                      [h264_nvenc @ 00000215ade03bc0] The minimum required Nvidia driver for nvenc is 610.00 or newer\n\
                      [out#0/null @ 00000215add53ac0] Nothing was written into output file, because at least one of its streams received no packets.\n";
        assert_eq!(
            error_summary(stderr),
            "Driver does not support the required nvenc API version. Required: 13.1 Found: 13.0 \
             The minimum required Nvidia driver for nvenc is 610.00 or newer"
        );
    }

    #[test]
    fn summary_handles_plain_and_empty_output() {
        assert_eq!(error_summary("\n  Unknown encoder 'x'\n"), "Unknown encoder 'x'");
        assert_eq!(error_summary(""), "tanpa keluaran error");
    }
}
