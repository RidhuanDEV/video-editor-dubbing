//! TTS abstraction (01 §2.1). Edge-TTS is unofficial and may break or be blocked at any time,
//! so engines sit behind `TtsProvider` and every failure is a typed `TtsError`.

mod cache;
mod edge;

pub use cache::{synthesize_cached, TtsResult};
pub use edge::EdgeTtsProvider;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Upper bound per request; long narration is split into chunks inside the provider.
pub const MAX_TEXT_CHARS: usize = 20_000;

#[derive(Debug, Error)]
pub enum TtsError {
    #[error("Koneksi gagal: {0}")]
    Network(String),
    #[error("Permintaan ditolak layanan: {0}")]
    Blocked(String),
    #[error("Batas waktu habis: {0}")]
    Timeout(String),
    #[error("Respons tidak dikenali: {0}")]
    Protocol(String),
    #[error("Permintaan tidak valid: {0}")]
    InvalidRequest(String),
    #[error("Gagal menulis cache: {0}")]
    Io(String),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TtsRequest {
    pub text: String,
    pub voice_id: String,
    pub rate: String,
    pub pitch: String,
    pub volume: String,
}

impl TtsRequest {
    /// IPC input is untrusted: these values are interpolated into SSML attributes, so they are
    /// checked against strict formats (no quotes or markup can get through).
    pub fn validate(&self) -> Result<(), TtsError> {
        let text = self.text.trim();
        if text.is_empty() {
            return Err(TtsError::InvalidRequest("teks kosong".into()));
        }
        if text.chars().count() > MAX_TEXT_CHARS {
            return Err(TtsError::InvalidRequest(format!("teks melebihi {MAX_TEXT_CHARS} karakter")));
        }
        let voice_ok = !self.voice_id.is_empty()
            && self.voice_id.len() <= 100
            && self.voice_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
        if !voice_ok {
            return Err(TtsError::InvalidRequest(format!("voiceId tidak valid: {}", self.voice_id)));
        }
        for (field, value, unit) in [("rate", &self.rate, "%"), ("pitch", &self.pitch, "Hz"), ("volume", &self.volume, "%")] {
            if !is_signed_with_unit(value, unit) {
                return Err(TtsError::InvalidRequest(format!("{field} harus berformat +N{unit} atau -N{unit}: {value}")));
            }
        }
        Ok(())
    }
}

/// Matches `^[+-]\d+<unit>$`.
fn is_signed_with_unit(value: &str, unit: &str) -> bool {
    let Some(rest) = value.strip_prefix('+').or_else(|| value.strip_prefix('-')) else {
        return false;
    };
    rest.strip_suffix(unit).is_some_and(|digits| !digits.is_empty() && digits.len() <= 4 && digits.bytes().all(|b| b.is_ascii_digit()))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordBoundary {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInfo {
    pub short_name: String,
    pub locale: String,
    pub gender: String,
    pub friendly_name: String,
}

/// Raw provider output; the cache layer owns where it is written.
pub struct SynthesizedAudio {
    /// MP3 bytes.
    pub audio: Vec<u8>,
    pub duration_ms: u64,
    /// Empty when the engine provides no boundaries (caller falls back to proportional timing).
    pub word_boundaries: Vec<WordBoundary>,
}

#[async_trait]
pub trait TtsProvider: Send + Sync {
    /// Stable id; part of the cache key so switching engines never reuses stale audio.
    fn id(&self) -> &'static str;
    async fn list_voices(&self) -> Result<Vec<VoiceInfo>, TtsError>;
    async fn synthesize(&self, request: &TtsRequest) -> Result<SynthesizedAudio, TtsError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> TtsRequest {
        TtsRequest {
            text: "Halo".into(),
            voice_id: "id-ID-GadisNeural".into(),
            rate: "+0%".into(),
            pitch: "-5Hz".into(),
            volume: "+10%".into(),
        }
    }

    #[test]
    fn accepts_valid_request() {
        assert!(request().validate().is_ok());
    }

    #[test]
    fn rejects_markup_in_ssml_attributes() {
        let mut r = request();
        r.voice_id = "x'/><evil".into();
        assert!(matches!(r.validate(), Err(TtsError::InvalidRequest(_))));

        let mut r = request();
        r.rate = "+0%' volume='+100%".into();
        assert!(matches!(r.validate(), Err(TtsError::InvalidRequest(_))));
    }

    #[test]
    fn rejects_bad_prosody_formats() {
        for bad in ["0%", "+%", "+10", "+10Hz", "++1%"] {
            let mut r = request();
            r.rate = bad.into();
            assert!(r.validate().is_err(), "rate {bad} must be rejected");
        }
    }

    #[test]
    fn rejects_blank_text() {
        let mut r = request();
        r.text = "  \n ".into();
        assert!(matches!(r.validate(), Err(TtsError::InvalidRequest(_))));
    }
}
