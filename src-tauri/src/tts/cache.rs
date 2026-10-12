//! Disk cache keyed by SHA-256 of (provider, voice, prosody, normalized text) (01 §6):
//! `<sha>.mp3` + `<sha>.json` (duration, word boundaries). Writes are atomic (temp + rename),
//! so a crash never leaves a half-written entry that would be served later.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{TtsError, TtsProvider, TtsRequest, WordBoundary};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsResult {
    pub job_id: String,
    pub provider_id: String,
    pub sha256: String,
    pub audio_path: PathBuf,
    pub duration_ms: u64,
    pub cached: bool,
    pub word_boundaries: Vec<WordBoundary>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheMeta {
    duration_ms: u64,
    word_boundaries: Vec<WordBoundary>,
}

/// Collapse whitespace so cosmetic edits to the script do not bust the cache.
fn normalize(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn cache_key(provider_id: &str, request: &TtsRequest) -> String {
    // JSON array encoding keeps fields unambiguous (no delimiter collisions).
    let material = serde_json::json!([
        provider_id,
        request.voice_id,
        request.rate,
        request.pitch,
        request.volume,
        normalize(&request.text)
    ])
    .to_string();
    hex::encode(Sha256::digest(material.as_bytes()))
}

pub async fn synthesize_cached(
    provider: &dyn TtsProvider,
    request: &TtsRequest,
    cache_dir: &Path,
    job_id: String,
) -> Result<TtsResult, TtsError> {
    request.validate()?;
    let sha256 = cache_key(provider.id(), request);
    let audio_path = cache_dir.join(format!("{sha256}.mp3"));
    let meta_path = cache_dir.join(format!("{sha256}.json"));

    if let Some(meta) = read_meta(&audio_path, &meta_path).await {
        tracing::info!(job_id, sha256, "tts cache hit");
        return Ok(TtsResult {
            job_id,
            provider_id: provider.id().to_owned(),
            sha256,
            audio_path,
            duration_ms: meta.duration_ms,
            cached: true,
            word_boundaries: meta.word_boundaries,
        });
    }

    tracing::info!(job_id, provider = provider.id(), chars = request.text.chars().count(), "tts synthesize");
    let normalized = TtsRequest { text: normalize(&request.text), ..request.clone() };
    let output = provider.synthesize(&normalized).await?;

    tokio::fs::create_dir_all(cache_dir).await.map_err(io_error)?;
    let meta = CacheMeta { duration_ms: output.duration_ms, word_boundaries: output.word_boundaries };
    let meta_json = serde_json::to_vec(&meta).map_err(|e| TtsError::Io(e.to_string()))?;
    // Audio first, metadata last: metadata presence marks a complete entry.
    write_atomic(&audio_path, &output.audio, &job_id).await?;
    write_atomic(&meta_path, &meta_json, &job_id).await?;

    Ok(TtsResult {
        job_id,
        provider_id: provider.id().to_owned(),
        sha256,
        audio_path,
        duration_ms: meta.duration_ms,
        cached: false,
        word_boundaries: meta.word_boundaries,
    })
}

async fn read_meta(audio_path: &Path, meta_path: &Path) -> Option<CacheMeta> {
    if !tokio::fs::try_exists(audio_path).await.unwrap_or(false) {
        return None;
    }
    let bytes = tokio::fs::read(meta_path).await.ok()?;
    // A corrupt entry is treated as a miss and overwritten, never surfaced as an error.
    serde_json::from_slice(&bytes).ok()
}

async fn write_atomic(path: &Path, bytes: &[u8], job_id: &str) -> Result<(), TtsError> {
    let tmp = path.with_extension(format!("{job_id}.part"));
    if let Err(err) = tokio::fs::write(&tmp, bytes).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(io_error(err));
    }
    if let Err(err) = tokio::fs::rename(&tmp, path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(io_error(err));
    }
    Ok(())
}

fn io_error(err: std::io::Error) -> TtsError {
    TtsError::Io(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tts::{SynthesizedAudio, VoiceInfo};
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct FakeProvider {
        calls: AtomicUsize,
    }

    #[async_trait]
    impl TtsProvider for FakeProvider {
        fn id(&self) -> &'static str {
            "fake"
        }

        async fn list_voices(&self) -> Result<Vec<VoiceInfo>, TtsError> {
            Ok(Vec::new())
        }

        async fn synthesize(&self, request: &TtsRequest) -> Result<SynthesizedAudio, TtsError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(SynthesizedAudio {
                audio: vec![0xFF; 6000],
                duration_ms: 1000,
                word_boundaries: vec![WordBoundary { text: request.text.clone(), start_ms: 0, end_ms: 500 }],
            })
        }
    }

    fn request(text: &str) -> TtsRequest {
        TtsRequest {
            text: text.into(),
            voice_id: "id-ID-GadisNeural".into(),
            rate: "+0%".into(),
            pitch: "+0Hz".into(),
            volume: "+0%".into(),
        }
    }

    #[test]
    fn key_ignores_whitespace_but_not_voice() {
        let a = cache_key("edge-tts", &request("Halo   dunia\n"));
        assert_eq!(a, cache_key("edge-tts", &request("Halo dunia")));
        let mut other = request("Halo dunia");
        other.voice_id = "id-ID-ArdiNeural".into();
        assert_ne!(a, cache_key("edge-tts", &other));
        assert_ne!(a, cache_key("kokoro-local", &request("Halo dunia")));
    }

    #[tokio::test]
    async fn second_call_is_served_from_cache() {
        let dir = std::env::temp_dir().join(format!("script-studio-tts-{}", uuid::Uuid::new_v4().simple()));
        let provider = FakeProvider { calls: AtomicUsize::new(0) };

        let first = synthesize_cached(&provider, &request("Halo dunia"), &dir, "job-1".into()).await.expect("first");
        let second = synthesize_cached(&provider, &request("Halo  dunia"), &dir, "job-2".into()).await.expect("second");

        assert!(!first.cached);
        assert!(second.cached);
        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
        assert_eq!(second.duration_ms, 1000);
        assert_eq!(second.word_boundaries, first.word_boundaries);
        assert!(first.audio_path.is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
