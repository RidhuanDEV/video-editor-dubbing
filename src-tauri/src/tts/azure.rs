//! Azure AI Speech (official, user's own key) via the REST API (01 §2.1, P1 engine).
//! REST returns audio only, no word timings: subtitles for Azure scenes use the proportional
//! fallback and are marked imprecise (04 §3.3).

use std::time::Duration;

use async_trait::async_trait;
use serde::Deserialize;

use super::edge::{escape_xml, sanitize, split_escaped_chunks};
use super::{SynthesizedAudio, TtsError, TtsProvider, TtsRequest, VoiceInfo};

const OUTPUT_FORMAT: &str = "audio-24khz-48kbitrate-mono-mp3";
/// Same CBR format as Edge: 48 kbps → bytes map exactly to duration.
const BYTES_PER_MS: u64 = 6;
/// Keeps each SSML request comfortably below the service limits.
const MAX_SSML_TEXT_BYTES: usize = 4000;
const HTTP_TIMEOUT: Duration = Duration::from_secs(60);

pub struct AzureSpeechProvider {
    http: reqwest::Client,
    region: String,
    key: String,
}

impl AzureSpeechProvider {
    /// `region` and `key` must already be validated (`settings::validate_azure_*`).
    pub fn new(region: String, key: String) -> Result<Self, TtsError> {
        let http = reqwest::Client::builder()
            .timeout(HTTP_TIMEOUT)
            .build()
            .map_err(|e| TtsError::Network(format!("HTTP client: {e}")))?;
        Ok(Self { http, region, key })
    }

    fn url(&self, path: &str) -> String {
        format!("https://{}.tts.speech.microsoft.com/cognitiveservices/{path}", self.region)
    }
}

fn map_status(status: reqwest::StatusCode) -> Option<TtsError> {
    match status.as_u16() {
        200..=299 => None,
        401 | 403 => Some(TtsError::Blocked("kunci atau region Azure ditolak (HTTP 401/403)".into())),
        429 => Some(TtsError::Blocked("kuota Azure habis atau terlalu banyak permintaan (HTTP 429)".into())),
        code => Some(TtsError::Protocol(format!("Azure HTTP {code}"))),
    }
}

fn map_http(err: reqwest::Error) -> TtsError {
    if err.is_timeout() {
        TtsError::Timeout("Azure Speech".into())
    } else {
        TtsError::Network(err.to_string())
    }
}

#[async_trait]
impl TtsProvider for AzureSpeechProvider {
    fn id(&self) -> &'static str {
        "azure-speech"
    }

    async fn list_voices(&self) -> Result<Vec<VoiceInfo>, TtsError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "PascalCase")]
        struct RawVoice {
            short_name: String,
            locale: String,
            #[serde(default)]
            gender: String,
            #[serde(default)]
            display_name: String,
        }
        let response = self.http.get(self.url("voices/list")).header("Ocp-Apim-Subscription-Key", &self.key).send().await.map_err(map_http)?;
        if let Some(err) = map_status(response.status()) {
            return Err(err);
        }
        let voices: Vec<RawVoice> = response.json().await.map_err(|e| TtsError::Protocol(format!("daftar suara Azure: {e}")))?;
        Ok(voices
            .into_iter()
            .map(|v| VoiceInfo { short_name: v.short_name, locale: v.locale, gender: v.gender, friendly_name: v.display_name })
            .collect())
    }

    async fn synthesize(&self, request: &TtsRequest) -> Result<SynthesizedAudio, TtsError> {
        request.validate()?;
        let mut audio = Vec::new();
        for chunk in split_escaped_chunks(&sanitize(&request.text), MAX_SSML_TEXT_BYTES) {
            let lang = request.voice_id.splitn(3, '-').take(2).collect::<Vec<_>>().join("-");
            let ssml = format!(
                "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='{}'><voice name='{}'><prosody pitch='{}' rate='{}' volume='{}'>{chunk}</prosody></voice></speak>",
                escape_xml(&lang),
                escape_xml(&request.voice_id),
                request.pitch,
                request.rate,
                request.volume
            );
            let response = self
                .http
                .post(self.url("v1"))
                .header("Ocp-Apim-Subscription-Key", &self.key)
                .header("Content-Type", "application/ssml+xml")
                .header("X-Microsoft-OutputFormat", OUTPUT_FORMAT)
                .header("User-Agent", "ScriptStudio")
                .body(ssml)
                .send()
                .await
                .map_err(map_http)?;
            if let Some(err) = map_status(response.status()) {
                return Err(err);
            }
            audio.extend_from_slice(&response.bytes().await.map_err(map_http)?);
        }
        if audio.is_empty() {
            return Err(TtsError::Protocol("Azure tidak mengembalikan audio".into()));
        }
        let duration_ms = audio.len() as u64 / BYTES_PER_MS;
        Ok(SynthesizedAudio { audio, duration_ms, word_boundaries: Vec::new() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_http_statuses_to_actionable_errors() {
        assert!(map_status(reqwest::StatusCode::OK).is_none());
        assert!(matches!(map_status(reqwest::StatusCode::UNAUTHORIZED), Some(TtsError::Blocked(_))));
        assert!(matches!(map_status(reqwest::StatusCode::TOO_MANY_REQUESTS), Some(TtsError::Blocked(_))));
        assert!(matches!(map_status(reqwest::StatusCode::BAD_GATEWAY), Some(TtsError::Protocol(_))));
    }

    #[test]
    fn builds_regional_endpoints() {
        let provider = AzureSpeechProvider::new("southeastasia".into(), "k".repeat(32)).expect("provider");
        assert_eq!(provider.url("v1"), "https://southeastasia.tts.speech.microsoft.com/cognitiveservices/v1");
        assert_eq!(provider.id(), "azure-speech");
    }
}
