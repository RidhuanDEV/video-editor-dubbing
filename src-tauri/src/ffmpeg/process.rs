//! Runs FFmpeg/FFprobe with an argument array (never a shell string), a hard timeout, and
//! kill-on-drop so a cancelled or timed-out call never leaves an orphan process.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;

use super::FfmpegError;

pub struct ProcessOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

fn command_for(program: &Path, args: &[&str]) -> Command {
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
    command
}

fn label_of(program: &Path) -> String {
    program.file_name().map_or_else(|| program.display().to_string(), |n| n.to_string_lossy().into_owned())
}

pub async fn run(program: &Path, args: &[&str], timeout: Duration) -> Result<ProcessOutput, FfmpegError> {
    let mut command = command_for(program, args);
    let label = label_of(program);
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

/// Keeps at most this much stderr from a long-running encode (enough for `error_summary`).
const MAX_STDERR_BYTES: u64 = 64 * 1024;

/// Runs a long FFmpeg job and hands each stdout line to `on_line` (use with `-progress pipe:1`).
/// stderr is drained concurrently so a chatty encoder can never block on a full pipe.
pub async fn run_with_progress(
    program: &Path,
    args: &[&str],
    timeout: Duration,
    mut on_line: impl FnMut(&str) + Send,
) -> Result<ProcessOutput, FfmpegError> {
    let label = label_of(program);
    let mut child = command_for(program, args).spawn().map_err(|e| FfmpegError::Spawn(format!("{label}: {e}")))?;
    let stdout = child.stdout.take().ok_or_else(|| FfmpegError::Spawn(format!("{label}: stdout tidak tersedia")))?;
    let stderr = child.stderr.take().ok_or_else(|| FfmpegError::Spawn(format!("{label}: stderr tidak tersedia")))?;

    let stderr_task = tokio::spawn(async move {
        let mut text = String::new();
        let _ = stderr.take(MAX_STDERR_BYTES).read_to_string(&mut text).await;
        text
    });

    let work = async {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            on_line(&line);
        }
        child.wait().await
    };
    // On timeout `child` is dropped with kill_on_drop, so the encoder process dies with it.
    let status = tokio::time::timeout(timeout, work)
        .await
        .map_err(|_| FfmpegError::Timeout(format!("{label} ({} dtk)", timeout.as_secs())))?
        .map_err(|e| FfmpegError::Spawn(format!("{label}: {e}")))?;
    let stderr = stderr_task.await.unwrap_or_default();
    Ok(ProcessOutput { success: status.success(), stdout: String::new(), stderr })
}

/// Parses `out_time_us=12345` from FFmpeg's `-progress` output into milliseconds.
pub fn progress_out_ms(line: &str) -> Option<u64> {
    line.strip_prefix("out_time_us=")?.trim().parse::<u64>().ok().map(|us| us / 1000)
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
    fn parses_progress_lines() {
        assert_eq!(progress_out_ms("out_time_us=1500000"), Some(1500));
        assert_eq!(progress_out_ms("out_time_us=N/A"), None);
        assert_eq!(progress_out_ms("frame=12"), None);
    }

    #[test]
    fn summary_handles_plain_and_empty_output() {
        assert_eq!(error_summary("\n  Unknown encoder 'x'\n"), "Unknown encoder 'x'");
        assert_eq!(error_summary(""), "tanpa keluaran error");
    }
}
