//! Job lifecycle events (01 §8). Every long-running command carries a client-generated
//! `jobId` that appears in IPC events and in the log, so a failure can be traced end to end.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, ErrorKind};

pub const JOB_EVENT: &str = "job://event";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobKind {
    Tts,
    EncoderDetection,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Started,
    Progress,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct JobEvent<'a> {
    job_id: &'a str,
    kind: JobKind,
    status: JobStatus,
    message: Option<String>,
}

/// A job id is untrusted IPC input that ends up in logs and file names: only canonical UUIDs pass.
pub fn validate_job_id(job_id: &str) -> Result<String, AppError> {
    uuid::Uuid::parse_str(job_id)
        .map(|id| id.hyphenated().to_string())
        .map_err(|_| AppError::new(ErrorKind::InvalidRequest, "jobId harus UUID"))
}

pub struct Job<'a> {
    app: &'a AppHandle,
    id: &'a str,
    kind: JobKind,
}

impl<'a> Job<'a> {
    pub fn start(app: &'a AppHandle, id: &'a str, kind: JobKind) -> Self {
        let job = Self { app, id, kind };
        tracing::info!(job_id = id, kind = ?kind, "job started");
        job.emit(JobStatus::Started, None);
        job
    }

    pub fn progress(&self, message: impl Into<String>) {
        self.emit(JobStatus::Progress, Some(message.into()));
    }

    /// Emits the terminal event matching `result` and passes it through unchanged.
    pub fn finish<T>(self, result: Result<T, AppError>) -> Result<T, AppError> {
        match &result {
            Ok(_) => {
                tracing::info!(job_id = self.id, kind = ?self.kind, "job succeeded");
                self.emit(JobStatus::Succeeded, None);
            }
            Err(err) => {
                tracing::warn!(job_id = self.id, kind = ?self.kind, error_kind = ?err.kind, error = %err.message, "job failed");
                self.emit(JobStatus::Failed, Some(err.message.clone()));
            }
        }
        result
    }

    fn emit(&self, status: JobStatus, message: Option<String>) {
        let event = JobEvent { job_id: self.id, kind: self.kind, status, message };
        // Events are best-effort UI feedback; the command result remains the source of truth.
        if let Err(err) = self.app.emit(JOB_EVENT, event) {
            tracing::warn!(job_id = self.id, error = %err, "failed to emit job event");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_uuids() {
        let id = "6F1C2B9E-4A63-4F0E-9D2A-0C8F5B7E1A24";
        assert_eq!(validate_job_id(id).expect("valid"), id.to_lowercase());
        for bad in ["", "abc", "../../etc", "6f1c2b9e-4a63-4f0e-9d2a"] {
            assert!(validate_job_id(bad).is_err(), "{bad} must be rejected");
        }
    }
}
