//! App-level settings (not per project): TTS consent and Azure region in a JSON file in the app
//! config dir; the Azure API key in the OS credential store (01 §7: keys never in plain files).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use thiserror::Error;

const SETTINGS_FILE: &str = "settings.json";
const KEYRING_SERVICE: &str = "dev.ridhuan.scriptstudio";
const AZURE_KEY_USER: &str = "azure-speech-key";

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("Gagal menyimpan pengaturan: {0}")]
    Io(String),
    #[error("Penyimpanan kredensial OS tidak tersedia: {0}")]
    Keychain(String),
    #[error("{0}")]
    Invalid(String),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// The user accepted the Edge-TTS notice (unofficial service, text sent to Microsoft).
    pub edge_tts_consent: bool,
    pub azure_region: Option<String>,
}

pub struct SettingsStore {
    path: PathBuf,
    current: Mutex<AppSettings>,
}

impl SettingsStore {
    /// A missing or corrupt file falls back to defaults (consent must then be given again).
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join(SETTINGS_FILE);
        let current = std::fs::read(&path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
        Self { path, current: Mutex::new(current) }
    }

    pub fn get(&self) -> AppSettings {
        self.current.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }

    pub fn update(&self, change: impl FnOnce(&mut AppSettings)) -> Result<AppSettings, SettingsError> {
        let mut guard = self.current.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut next = guard.clone();
        change(&mut next);
        let json = serde_json::to_vec_pretty(&next).map_err(|e| SettingsError::Io(e.to_string()))?;
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| SettingsError::Io(e.to_string()))?;
        }
        crate::project::write_atomic(&self.path, &json).map_err(|e| SettingsError::Io(e.to_string()))?;
        *guard = next.clone();
        Ok(next)
    }
}

/// Azure regions are host-name labels (`southeastasia`); anything else could redirect the request.
pub fn validate_azure_region(region: &str) -> Result<(), SettingsError> {
    let ok = (2..=32).contains(&region.len()) && region.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    if ok {
        Ok(())
    } else {
        Err(SettingsError::Invalid("Region Azure tidak valid (contoh: southeastasia).".into()))
    }
}

/// Azure keys are 32 hex characters (older) or ~84 base62 characters (newer).
pub fn validate_azure_key(key: &str) -> Result<(), SettingsError> {
    let ok = (20..=128).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_alphanumeric());
    if ok {
        Ok(())
    } else {
        Err(SettingsError::Invalid("Kunci Azure tidak valid.".into()))
    }
}

fn entry() -> Result<keyring::Entry, SettingsError> {
    keyring::Entry::new(KEYRING_SERVICE, AZURE_KEY_USER).map_err(|e| SettingsError::Keychain(e.to_string()))
}

/// Keychain calls can block (and prompt on some systems): run them off the async runtime.
pub async fn store_azure_key(key: String) -> Result<(), SettingsError> {
    tokio::task::spawn_blocking(move || entry()?.set_password(&key).map_err(|e| SettingsError::Keychain(e.to_string())))
        .await
        .map_err(|e| SettingsError::Keychain(e.to_string()))?
}

pub async fn read_azure_key() -> Result<Option<String>, SettingsError> {
    tokio::task::spawn_blocking(|| match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(SettingsError::Keychain(e.to_string())),
    })
    .await
    .map_err(|e| SettingsError::Keychain(e.to_string()))?
}

pub async fn delete_azure_key() -> Result<(), SettingsError> {
    tokio::task::spawn_blocking(|| match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(SettingsError::Keychain(e.to_string())),
    })
    .await
    .map_err(|e| SettingsError::Keychain(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_region_and_key_shapes() {
        assert!(validate_azure_region("southeastasia").is_ok());
        for bad in ["", "south east", "evil.com/x", "SouthEastAsia", "a"] {
            assert!(validate_azure_region(bad).is_err(), "{bad}");
        }
        assert!(validate_azure_key(&"a1".repeat(16)).is_ok());
        assert!(validate_azure_key("short").is_err());
        assert!(validate_azure_key(&format!("{}\n", "a".repeat(32))).is_err());
    }

    #[test]
    fn settings_round_trip_and_survive_corruption() {
        let dir = std::env::temp_dir().join(format!("script-studio-settings-{}", uuid::Uuid::new_v4().simple()));
        let store = SettingsStore::load(&dir);
        assert_eq!(store.get(), AppSettings::default());
        store.update(|s| s.edge_tts_consent = true).expect("save");
        assert!(SettingsStore::load(&dir).get().edge_tts_consent);
        std::fs::write(dir.join(SETTINGS_FILE), b"{not json").expect("corrupt");
        assert!(!SettingsStore::load(&dir).get().edge_tts_consent);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod live_tests {
    /// Live: real OS credential store round trip under a test-only service name.
    #[test]
    #[ignore = "machine-specific: writes to the OS credential store"]
    fn live_keychain_round_trip() {
        let entry = keyring::Entry::new("dev.ridhuan.scriptstudio.test", "round-trip").expect("entry");
        entry.set_password("secret-123").expect("set");
        assert_eq!(entry.get_password().expect("get"), "secret-123");
        entry.delete_credential().expect("delete");
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
}
