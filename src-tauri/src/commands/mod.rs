//! Tauri IPC commands. Inputs are untrusted and validated here or in the service they call;
//! every failure crosses the boundary as a typed `AppError`.

pub mod engine;
pub mod export;
pub mod media;
pub mod project;
pub mod settings;

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{watch, Mutex};

use crate::error::{AppError, ErrorKind};
use crate::ffmpeg::{self, Codec, VideoEncoder};
use crate::project::ProjectSession;
use crate::settings::{self as app_settings, SettingsStore};
use crate::tts::{AzureSpeechProvider, EdgeTtsProvider, TtsProvider};

pub const ENGINE_EDGE: &str = "edge-tts";
pub const ENGINE_AZURE: &str = "azure-speech";

pub struct AppState {
    pub edge: Arc<EdgeTtsProvider>,
    /// Built from settings + keychain on first use; cleared when Azure settings change.
    pub azure: Mutex<Option<Arc<AzureSpeechProvider>>>,
    pub settings: SettingsStore,
    pub session: ProjectSession,
    /// Detected encoder per codec family. An async mutex so concurrent proxy/export jobs wait
    /// for one detection instead of each running its own round of test encodes.
    pub encoders: Mutex<HashMap<Codec, VideoEncoder>>,
    /// Cancel handles of running exports, by job id.
    pub exports: std::sync::Mutex<HashMap<String, watch::Sender<bool>>>,
}

impl AppState {
    pub fn new(edge: Arc<EdgeTtsProvider>, settings: SettingsStore) -> Self {
        Self {
            edge,
            azure: Mutex::new(None),
            settings,
            session: ProjectSession::default(),
            encoders: Mutex::new(HashMap::new()),
            exports: std::sync::Mutex::new(HashMap::new()),
        }
    }

    /// Provider for a manifest engine id. Edge-TTS is unofficial, so it runs only after the
    /// user accepted the notice (enforced here, not just in the UI).
    pub async fn provider(&self, engine: &str) -> Result<Arc<dyn TtsProvider>, AppError> {
        match engine {
            ENGINE_EDGE => {
                if !self.settings.get().edge_tts_consent {
                    return Err(AppError::new(ErrorKind::ConsentRequired, "Edge-TTS belum disetujui. Setujui pemberitahuan atau pilih Azure Speech."));
                }
                Ok(self.edge.clone())
            }
            ENGINE_AZURE => {
                let mut cached = self.azure.lock().await;
                if let Some(provider) = cached.as_ref() {
                    return Ok(provider.clone());
                }
                let not_configured = || AppError::new(ErrorKind::InvalidRequest, "Azure Speech belum diatur. Isi region dan kunci di Pengaturan.");
                let region = self.settings.get().azure_region.ok_or_else(not_configured)?;
                let key = app_settings::read_azure_key().await?.ok_or_else(not_configured)?;
                let provider = Arc::new(AzureSpeechProvider::new(region, key)?);
                *cached = Some(provider.clone());
                Ok(provider)
            }
            other => Err(AppError::new(ErrorKind::InvalidRequest, format!("Engine TTS tidak didukung: {other}"))),
        }
    }

    /// Cached encoder for `codec`, detecting once (default resolution order) when unknown.
    pub async fn encoder(&self, codec: Codec) -> Result<VideoEncoder, AppError> {
        let mut cached = self.encoders.lock().await;
        if let Some(encoder) = cached.get(&codec) {
            return Ok(*encoder);
        }
        let detection = ffmpeg::detect_encoder(None, codec, |_| {}).await?;
        let encoder = detection.selected.ok_or_else(|| {
            let name = match codec {
                Codec::H264 => "H.264",
                Codec::Av1 => "AV1",
            };
            AppError::new(ErrorKind::BinaryNotFound, format!("Tidak ada encoder {name} yang berfungsi. Periksa halaman Engine atau atur FFmpeg kustom."))
        })?;
        cached.insert(codec, encoder);
        Ok(encoder)
    }
}

/// Ids from the manifest end up in file names (thumbnails), so only a strict charset passes.
fn validate_asset_id(id: &str) -> Result<(), AppError> {
    let ok = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(())
    } else {
        Err(AppError::new(ErrorKind::InvalidRequest, "id aset tidak valid"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_ids_cannot_escape_thumbnail_folder() {
        assert!(validate_asset_id("6f1c2b9e-4a63-4f0e-9d2a-0c8f5b7e1a24").is_ok());
        for bad in ["", "../x", "a/b", r"a\b", "x.jpg", &"a".repeat(65)] {
            assert!(validate_asset_id(bad).is_err(), "{bad} must be rejected");
        }
    }
}

/// Locks the JSON shape the UI's Zod schemas expect (`src/types/ipc.ts`). A rename on either
/// side fails here instead of at runtime in the webview.
#[cfg(test)]
mod contract_tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::media::ImportOutcome;
    use crate::media::{MediaKind, ProbedMedia, RelinkCandidate};
    use crate::project::OpenedProject;

    fn probed() -> ProbedMedia {
        ProbedMedia {
            id: "a1".into(),
            kind: MediaKind::Video,
            file_path: PathBuf::from("C:/v.mp4"),
            file_name: "v.mp4".into(),
            duration_ms: Some(2000),
            width: Some(640),
            height: Some(360),
            fps: Some(30.0),
            thumbnail_path: None,
        }
    }

    #[test]
    fn opened_project_shape() {
        let opened = OpenedProject { root: PathBuf::from("C:/p.smbproj"), manifest_json: None, recovery_json: Some("{}".into()) };
        assert_eq!(serde_json::to_value(opened).expect("json"), json!({ "root": "C:/p.smbproj", "manifestJson": null, "recoveryJson": "{}" }));
    }

    #[test]
    fn media_shapes() {
        let expected_media = json!({
            "id": "a1", "kind": "video", "filePath": "C:/v.mp4", "fileName": "v.mp4",
            "durationMs": 2000, "width": 640, "height": 360, "fps": 30.0, "thumbnailPath": null
        });
        assert_eq!(serde_json::to_value(probed()).expect("json"), expected_media);
        assert_eq!(
            serde_json::to_value(ImportOutcome::Imported { media: probed() }).expect("json"),
            json!({ "status": "imported", "media": expected_media })
        );
        assert_eq!(
            serde_json::to_value(ImportOutcome::Failed { file_name: "x.txt".into(), message: "m".into() }).expect("json"),
            json!({ "status": "failed", "fileName": "x.txt", "message": "m" })
        );
        assert_eq!(
            serde_json::to_value(RelinkCandidate { media: probed(), duration_matches: false }).expect("json"),
            json!({ "media": expected_media, "durationMatches": false })
        );
    }
}
