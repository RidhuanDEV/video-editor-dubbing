//! Structured logs to stderr and a daily-rotated file in the app log dir (01 §8).
//! Never log narration text or full user paths at `info`.

use std::error::Error;
use std::path::Path;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, EnvFilter};

const RETAINED_LOG_FILES: usize = 14;

/// Keeps the background log writer alive; dropping it flushes and stops file logging.
pub struct LogGuard {
    _guard: WorkerGuard,
}

pub fn init(log_dir: &Path) -> Result<LogGuard, Box<dyn Error>> {
    std::fs::create_dir_all(log_dir)?;
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("script-studio")
        .filename_suffix("log")
        .max_log_files(RETAINED_LOG_FILES)
        .build(log_dir)?;
    let (file_writer, guard) = tracing_appender::non_blocking(appender);

    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(fmt::layer().with_target(false))
        .with(fmt::layer().with_target(false).with_ansi(false).with_writer(file_writer))
        .try_init()?;
    Ok(LogGuard { _guard: guard })
}
