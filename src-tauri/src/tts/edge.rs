//! Native Edge-TTS client (WebSocket), replacing the Python `edge-tts` dependency.
//!
//! Protocol mirrors the reference implementation github.com/rany2/edge-tts
//! (`constants.py`, `drm.py`, `communicate.py`). The service is UNOFFICIAL: any of these
//! constants may change server-side, which surfaces as `TtsError::Blocked`/`Protocol`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderValue, StatusCode};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use super::{SynthesizedAudio, TtsError, TtsProvider, TtsRequest, VoiceInfo, WordBoundary};

const BASE_URL: &str = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION: &str = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION: &str = "143";
const ORIGIN: &str = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const OUTPUT_FORMAT: &str = "audio-24khz-48kbitrate-mono-mp3";

/// Seconds between the Windows file-time epoch (1601) and the Unix epoch.
const WIN_EPOCH_SECS: u64 = 11_644_473_600;
const TICKS_PER_SECOND: u64 = 10_000_000;
const TICKS_PER_MS: u64 = 10_000;
/// `audio-24khz-48kbitrate-mono-mp3` is constant bitrate, so bytes map exactly to time.
const MP3_BITRATE_BPS: u64 = 48_000;
/// Service limit per SSML request (after XML escaping).
const MAX_SSML_TEXT_BYTES: usize = 4096;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const RECEIVE_TIMEOUT: Duration = Duration::from_secs(30);
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub struct EdgeTtsProvider {
    http: reqwest::Client,
    /// Server time minus local time, learned from a 403 response's `Date` header.
    clock_skew_secs: AtomicI64,
}

impl EdgeTtsProvider {
    pub fn new() -> Result<Self, TtsError> {
        let http = reqwest::Client::builder()
            .timeout(HTTP_TIMEOUT)
            .build()
            .map_err(|e| TtsError::Network(format!("HTTP client: {e}")))?;
        Ok(Self { http, clock_skew_secs: AtomicI64::new(0) })
    }

    fn now_unix_secs(&self) -> u64 {
        let local = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        local.saturating_add_signed(self.clock_skew_secs.load(Ordering::Relaxed))
    }

    /// Returns true when a skew correction was applied (worth one retry).
    fn adjust_skew_from(&self, server_date: Option<&str>) -> bool {
        let Some(server) = server_date.and_then(|d| httpdate::parse_http_date(d).ok()) else {
            return false;
        };
        let Ok(server_secs) = server.duration_since(UNIX_EPOCH).map(|d| d.as_secs()) else {
            return false;
        };
        let local_secs = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        let skew = i64::try_from(server_secs).unwrap_or(i64::MAX).saturating_sub(i64::try_from(local_secs).unwrap_or(0));
        self.clock_skew_secs.store(skew, Ordering::Relaxed);
        tracing::warn!(skew_secs = skew, "edge-tts: adjusted clock skew after 403");
        true
    }

    fn drm_query(&self) -> String {
        format!(
            "Sec-MS-GEC={}&Sec-MS-GEC-Version=1-{CHROMIUM_FULL_VERSION}",
            sec_ms_gec(self.now_unix_secs())
        )
    }

    async fn connect(&self) -> Result<Socket, TtsError> {
        let mut retried_after_skew = false;
        loop {
            let url = format!(
                "wss://{BASE_URL}/edge/v1?TrustedClientToken={TRUSTED_CLIENT_TOKEN}&ConnectionId={}&{}",
                uuid::Uuid::new_v4().simple(),
                self.drm_query()
            );
            let mut request = url
                .into_client_request()
                .map_err(|e| TtsError::Protocol(format!("URL WebSocket: {e}")))?;
            let headers = request.headers_mut();
            headers.insert("Pragma", HeaderValue::from_static("no-cache"));
            headers.insert("Cache-Control", HeaderValue::from_static("no-cache"));
            headers.insert("Origin", HeaderValue::from_static(ORIGIN));
            headers.insert("Accept-Encoding", HeaderValue::from_static("gzip, deflate, br, zstd"));
            headers.insert("Accept-Language", HeaderValue::from_static("en-US,en;q=0.9"));
            headers.insert(
                "User-Agent",
                HeaderValue::from_str(&user_agent()).map_err(|e| TtsError::Protocol(e.to_string()))?,
            );
            headers.insert(
                "Cookie",
                HeaderValue::from_str(&format!("muid={};", random_muid())).map_err(|e| TtsError::Protocol(e.to_string()))?,
            );

            match tokio::time::timeout(CONNECT_TIMEOUT, tokio_tungstenite::connect_async(request)).await {
                Err(_) => return Err(TtsError::Timeout("koneksi WebSocket".into())),
                Ok(Ok((socket, _response))) => return Ok(socket),
                Ok(Err(WsError::Http(response))) => {
                    let status = response.status();
                    if status == StatusCode::FORBIDDEN && !retried_after_skew {
                        let date = response.headers().get("Date").and_then(|v| v.to_str().ok());
                        if self.adjust_skew_from(date) {
                            retried_after_skew = true;
                            continue;
                        }
                    }
                    return Err(match status {
                        StatusCode::FORBIDDEN | StatusCode::UNAUTHORIZED | StatusCode::TOO_MANY_REQUESTS => {
                            TtsError::Blocked(format!("HTTP {status}"))
                        }
                        _ => TtsError::Protocol(format!("handshake HTTP {status}")),
                    });
                }
                Ok(Err(err)) => return Err(map_ws_error(err)),
            }
        }
    }

    async fn synthesize_chunk(&self, request: &TtsRequest, escaped_text: &str, offset_ticks: u64) -> Result<ChunkOutput, TtsError> {
        let mut socket = self.connect().await?;

        let config = format!(
            "X-Timestamp:{}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n\
             {{\"context\":{{\"synthesis\":{{\"audio\":{{\"metadataoptions\":{{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"true\"}},\"outputFormat\":\"{OUTPUT_FORMAT}\"}}}}}}}}\r\n",
            js_date()
        );
        socket.send(Message::text(config)).await.map_err(map_ws_error)?;

        let ssml = format!(
            "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>\
             <voice name='{}'><prosody pitch='{}' rate='{}' volume='{}'>{escaped_text}</prosody></voice></speak>",
            long_voice_name(&request.voice_id),
            request.pitch,
            request.rate,
            request.volume
        );
        // The trailing "Z" after a JS-style date is intentional; it mirrors the Edge client.
        let ssml_message = format!(
            "X-RequestId:{}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:{}Z\r\nPath:ssml\r\n\r\n{ssml}",
            uuid::Uuid::new_v4().simple(),
            js_date()
        );
        socket.send(Message::text(ssml_message)).await.map_err(map_ws_error)?;

        let mut audio = Vec::new();
        let mut boundaries = Vec::new();
        loop {
            let message = match tokio::time::timeout(RECEIVE_TIMEOUT, socket.next()).await {
                Err(_) => return Err(TtsError::Timeout("menunggu audio dari layanan".into())),
                Ok(None) => return Err(TtsError::Protocol("koneksi ditutup sebelum turn.end".into())),
                Ok(Some(Err(err))) => return Err(map_ws_error(err)),
                Ok(Some(Ok(message))) => message,
            };
            match message {
                Message::Text(text) => {
                    let (headers, body) = split_text_frame(text.as_str())?;
                    match headers.get("Path").copied() {
                        Some("audio.metadata") => boundaries.extend(parse_word_boundaries(body, offset_ticks)?),
                        Some("turn.end") => break,
                        Some("response" | "turn.start") => {}
                        other => return Err(TtsError::Protocol(format!("path tidak dikenal: {other:?}"))),
                    }
                }
                Message::Binary(data) => {
                    if let Some(chunk) = parse_audio_frame(&data)? {
                        audio.extend_from_slice(chunk);
                    }
                }
                Message::Close(frame) => {
                    return Err(TtsError::Protocol(format!("koneksi ditutup layanan sebelum selesai: {frame:?}")));
                }
                Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
            }
        }
        // Best-effort close; the turn already completed.
        let _ = socket.close(None).await;

        if audio.is_empty() {
            return Err(TtsError::Protocol("tidak ada audio yang diterima; periksa suara/parameter".into()));
        }
        Ok(ChunkOutput { audio, boundaries })
    }
}

struct ChunkOutput {
    audio: Vec<u8>,
    boundaries: Vec<WordBoundary>,
}

#[async_trait]
impl TtsProvider for EdgeTtsProvider {
    fn id(&self) -> &'static str {
        "edge-tts"
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
            friendly_name: String,
        }

        let url = format!("https://{BASE_URL}/voices/list?trustedclienttoken={TRUSTED_CLIENT_TOKEN}&{}", self.drm_query());
        let response = self
            .http
            .get(url)
            .header("User-Agent", user_agent())
            .header("Accept", "*/*")
            .header("Accept-Language", "en-US,en;q=0.9")
            .send()
            .await
            .map_err(map_http_error)?;
        let status = response.status();
        if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(TtsError::Blocked(format!("HTTP {status}")));
        }
        if !status.is_success() {
            return Err(TtsError::Protocol(format!("daftar suara HTTP {status}")));
        }
        let voices: Vec<RawVoice> = response.json().await.map_err(|e| TtsError::Protocol(format!("daftar suara: {e}")))?;
        Ok(voices
            .into_iter()
            .map(|v| VoiceInfo { short_name: v.short_name, locale: v.locale, gender: v.gender, friendly_name: v.friendly_name })
            .collect())
    }

    async fn synthesize(&self, request: &TtsRequest) -> Result<SynthesizedAudio, TtsError> {
        request.validate()?;
        let chunks = split_escaped_chunks(&sanitize(&request.text), MAX_SSML_TEXT_BYTES);

        let mut audio = Vec::new();
        let mut word_boundaries = Vec::new();
        for chunk in &chunks {
            // Each chunk restarts offsets at 0; shift by the exact CBR duration of prior audio.
            let offset_ticks = bytes_to_ticks(audio.len() as u64);
            let out = self.synthesize_chunk(request, chunk, offset_ticks).await?;
            audio.extend_from_slice(&out.audio);
            word_boundaries.extend(out.boundaries);
        }

        let duration_ms = bytes_to_ticks(audio.len() as u64) / TICKS_PER_MS;
        Ok(SynthesizedAudio { audio, duration_ms, word_boundaries })
    }
}

// ---------------------------------------------------------------------------
// Pure protocol helpers (unit tested)
// ---------------------------------------------------------------------------

/// `Sec-MS-GEC`: SHA-256 of (Windows file-time ticks rounded down to 5 minutes + client token).
pub(crate) fn sec_ms_gec(unix_secs: u64) -> String {
    let mut secs = unix_secs + WIN_EPOCH_SECS;
    secs -= secs % 300;
    let ticks = u128::from(secs) * u128::from(TICKS_PER_SECOND);
    let digest = Sha256::digest(format!("{ticks}{TRUSTED_CLIENT_TOKEN}").as_bytes());
    hex::encode_upper(digest)
}

/// `id-ID-GadisNeural` → `Microsoft Server Speech Text to Speech Voice (id-ID, GadisNeural)`.
pub(crate) fn long_voice_name(short: &str) -> String {
    let mut parts = short.splitn(3, '-');
    let (Some(lang), Some(region), Some(name)) = (parts.next(), parts.next(), parts.next()) else {
        return short.to_owned();
    };
    let shape_ok = lang.len() >= 2
        && lang.bytes().all(|b| b.is_ascii_lowercase())
        && region.len() >= 2
        && region.bytes().all(|b| b.is_ascii_uppercase())
        && name.ends_with("Neural");
    if !shape_ok {
        return short.to_owned();
    }
    // e.g. zh-CN-liaoning-XiaobeiNeural: the dialect belongs to the region part.
    let (region, name) = match name.split_once('-') {
        Some((dialect, rest)) => (format!("{region}-{dialect}"), rest),
        None => (region.to_owned(), name),
    };
    format!("Microsoft Server Speech Text to Speech Voice ({lang}-{region}, {name})")
}

/// Control characters the service rejects (e.g. vertical tab from OCR'd PDFs) become spaces.
pub(crate) fn sanitize(text: &str) -> String {
    text.chars()
        .map(|c| match u32::from(c) {
            0..=8 | 11..=12 | 14..=31 => ' ',
            _ => c,
        })
        .collect()
}

pub(crate) fn escape_xml(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

fn unescape_xml(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// Splits on whitespace into escaped chunks of at most `max_bytes`, never inside an XML entity
/// or a UTF-8 sequence (escaping happens per word, before measuring).
pub(crate) fn split_escaped_chunks(text: &str, max_bytes: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        let escaped = escape_xml(word);
        if escaped.len() > max_bytes {
            if !current.is_empty() {
                chunks.push(std::mem::take(&mut current));
            }
            for c in word.chars() {
                let piece = escape_xml(c.encode_utf8(&mut [0; 4]));
                if current.len() + piece.len() > max_bytes {
                    chunks.push(std::mem::take(&mut current));
                }
                current.push_str(&piece);
            }
            continue;
        }
        let needed = if current.is_empty() { escaped.len() } else { current.len() + 1 + escaped.len() };
        if needed > max_bytes {
            chunks.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(&escaped);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Text frames are `Header:Value\r\n...\r\n\r\nbody`.
pub(crate) fn split_text_frame(frame: &str) -> Result<(HashMap<&str, &str>, &str), TtsError> {
    let (head, body) = frame
        .split_once("\r\n\r\n")
        .ok_or_else(|| TtsError::Protocol("frame teks tanpa pemisah header".into()))?;
    Ok((parse_headers(head), body))
}

fn parse_headers(head: &str) -> HashMap<&str, &str> {
    head.split("\r\n").filter_map(|line| line.split_once(':')).map(|(k, v)| (k.trim(), v.trim())).collect()
}

/// Binary frames: 2-byte big-endian header length, headers, then audio. Returns the audio
/// payload, or `None` for the empty end-of-stream frame (no Content-Type, no data).
pub(crate) fn parse_audio_frame(frame: &[u8]) -> Result<Option<&[u8]>, TtsError> {
    let [hi, lo, rest @ ..] = frame else {
        return Err(TtsError::Protocol("frame biner tanpa panjang header".into()));
    };
    let header_len = usize::from(u16::from_be_bytes([*hi, *lo]));
    if header_len > rest.len() {
        return Err(TtsError::Protocol("panjang header melebihi frame".into()));
    }
    let head = std::str::from_utf8(&rest[..header_len]).map_err(|_| TtsError::Protocol("header biner bukan UTF-8".into()))?;
    let headers = parse_headers(head);
    if headers.get("Path").copied() != Some("audio") {
        return Err(TtsError::Protocol("frame biner bukan audio".into()));
    }
    let data = &rest[header_len..];
    match headers.get("Content-Type").copied() {
        Some("audio/mpeg") if !data.is_empty() => Ok(Some(data)),
        Some("audio/mpeg") => Err(TtsError::Protocol("frame audio kosong".into())),
        None if data.is_empty() => Ok(None),
        other => Err(TtsError::Protocol(format!("Content-Type audio tidak terduga: {other:?}"))),
    }
}

#[derive(Deserialize)]
struct MetadataEnvelope {
    #[serde(rename = "Metadata")]
    metadata: Vec<MetadataItem>,
}

#[derive(Deserialize)]
struct MetadataItem {
    #[serde(rename = "Type")]
    kind: String,
    #[serde(rename = "Data", default)]
    data: Option<MetadataData>,
}

#[derive(Deserialize)]
struct MetadataData {
    #[serde(rename = "Offset", default)]
    offset: Option<u64>,
    #[serde(rename = "Duration", default)]
    duration: Option<u64>,
    #[serde(default)]
    text: Option<MetadataText>,
}

#[derive(Deserialize)]
struct MetadataText {
    #[serde(rename = "Text")]
    text: String,
}

/// `audio.metadata` body → word boundaries in ms. Offsets/durations are 100 ns ticks.
pub(crate) fn parse_word_boundaries(body: &str, offset_ticks: u64) -> Result<Vec<WordBoundary>, TtsError> {
    let envelope: MetadataEnvelope =
        serde_json::from_str(body).map_err(|e| TtsError::Protocol(format!("metadata JSON: {e}")))?;
    Ok(envelope
        .metadata
        .into_iter()
        .filter(|item| item.kind == "WordBoundary")
        .filter_map(|item| {
            let data = item.data?;
            let start = data.offset? + offset_ticks;
            let end = start + data.duration?;
            Some(WordBoundary { text: unescape_xml(&data.text?.text), start_ms: start / TICKS_PER_MS, end_ms: end / TICKS_PER_MS })
        })
        .collect())
}

fn bytes_to_ticks(bytes: u64) -> u64 {
    bytes * 8 * TICKS_PER_SECOND / MP3_BITRATE_BPS
}

/// JavaScript `Date.toString()` style in UTC, as sent by the Edge client.
fn js_date() -> String {
    chrono::Utc::now().format("%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)").to_string()
}

fn user_agent() -> String {
    format!(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) \
         Chrome/{CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/{CHROMIUM_MAJOR_VERSION}.0.0.0"
    )
}

fn random_muid() -> String {
    uuid::Uuid::new_v4().simple().to_string().to_uppercase()
}

fn map_ws_error(err: WsError) -> TtsError {
    match err {
        WsError::Io(e) => TtsError::Network(e.to_string()),
        WsError::Tls(e) => TtsError::Network(format!("TLS: {e}")),
        WsError::Url(e) => TtsError::Protocol(format!("URL: {e}")),
        WsError::ConnectionClosed | WsError::AlreadyClosed => TtsError::Network("koneksi tertutup".into()),
        other => TtsError::Protocol(other.to_string()),
    }
}

fn map_http_error(err: reqwest::Error) -> TtsError {
    if err.is_timeout() {
        TtsError::Timeout("daftar suara".into())
    } else {
        TtsError::Network(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sec_ms_gec_rounds_to_five_minutes_and_is_upper_hex() {
        let a = sec_ms_gec(1_700_000_000);
        let b = sec_ms_gec(1_700_000_000 + 1);
        assert_eq!(a.len(), 64);
        assert!(a.bytes().all(|c| c.is_ascii_digit() || (b'A'..=b'F').contains(&c)));
        assert_eq!(a, b, "same 5-minute window must give the same token");
        // 1_700_000_000 + WIN_EPOCH is 200 s into its window; +100 s crosses into the next one.
        assert_ne!(a, sec_ms_gec(1_700_000_000 + 100));
    }

    #[test]
    fn sec_ms_gec_matches_reference_formula() {
        // Reference (Python edge-tts): f"{ticks:.0f}{TOKEN}" with ticks = floor5min(unix + WIN_EPOCH) * 1e7.
        let secs = (1_700_000_000_u64 + WIN_EPOCH_SECS) / 300 * 300;
        let expected = hex::encode_upper(Sha256::digest(format!("{}{TRUSTED_CLIENT_TOKEN}", u128::from(secs) * 10_000_000).as_bytes()));
        assert_eq!(sec_ms_gec(1_700_000_000), expected);
    }

    #[test]
    fn converts_short_voice_names() {
        assert_eq!(long_voice_name("id-ID-GadisNeural"), "Microsoft Server Speech Text to Speech Voice (id-ID, GadisNeural)");
        assert_eq!(
            long_voice_name("zh-CN-liaoning-XiaobeiNeural"),
            "Microsoft Server Speech Text to Speech Voice (zh-CN-liaoning, XiaobeiNeural)"
        );
        assert_eq!(long_voice_name("fil-PH-AngeloNeural"), "Microsoft Server Speech Text to Speech Voice (fil-PH, AngeloNeural)");
        assert_eq!(long_voice_name("custom"), "custom");
    }

    #[test]
    fn escapes_and_sanitizes() {
        assert_eq!(escape_xml("a<b & 'c'"), "a&lt;b &amp; &apos;c&apos;");
        assert_eq!(sanitize("a\u{0b}b"), "a b");
        assert_eq!(unescape_xml("&lt;x&gt; &amp;amp;"), "<x> &amp;");
    }

    #[test]
    fn splits_long_text_without_breaking_entities() {
        let text = "a&b ".repeat(2000); // each word escapes to 7 bytes
        let chunks = split_escaped_chunks(&text, 100);
        assert!(chunks.len() > 1);
        for chunk in &chunks {
            assert!(chunk.len() <= 100);
            assert!(chunk.split(' ').all(|w| w == "a&amp;b"));
        }
        assert_eq!(chunks.iter().map(|c| c.split(' ').count()).sum::<usize>(), 2000);
    }

    #[test]
    fn hard_splits_oversized_word_on_char_boundary() {
        let word = "é".repeat(10); // 20 bytes
        let chunks = split_escaped_chunks(&word, 7);
        assert!(chunks.iter().all(|c| c.len() <= 7));
        assert_eq!(chunks.concat(), word);
    }

    #[test]
    fn parses_text_frame_headers() {
        let (headers, body) = split_text_frame("X-RequestId:abc\r\nPath:turn.end\r\n\r\n{}").expect("frame");
        assert_eq!(headers.get("Path"), Some(&"turn.end"));
        assert_eq!(body, "{}");
    }

    #[test]
    fn parses_audio_frames() {
        let head = b"X-RequestId:1\r\nContent-Type:audio/mpeg\r\nPath:audio";
        let mut frame = (head.len() as u16).to_be_bytes().to_vec();
        frame.extend_from_slice(head);
        frame.extend_from_slice(&[1, 2, 3]);
        assert_eq!(parse_audio_frame(&frame).expect("ok"), Some(&[1_u8, 2, 3][..]));

        let end = b"X-RequestId:1\r\nPath:audio";
        let mut frame = (end.len() as u16).to_be_bytes().to_vec();
        frame.extend_from_slice(end);
        assert_eq!(parse_audio_frame(&frame).expect("ok"), None);

        assert!(parse_audio_frame(&[0, 50, 1]).is_err());
    }

    #[test]
    fn parses_word_boundaries_with_offset() {
        let body = r#"{"Metadata":[{"Type":"WordBoundary","Data":{"Offset":1000000,"Duration":2500000,"text":{"Text":"Halo &amp; hai","Length":4,"BoundaryType":"WordBoundary"}}},{"Type":"SessionEnd","Data":{"Offset":0}}]}"#;
        let words = parse_word_boundaries(body, 10_000_000).expect("parsed");
        assert_eq!(words, vec![WordBoundary { text: "Halo & hai".into(), start_ms: 1100, end_ms: 1350 }]);
    }

    /// Live check against the real service: `cargo test -- --ignored live_`.
    /// Writes the MP3 to the temp dir so its duration can be cross-checked with ffprobe.
    #[tokio::test]
    #[ignore = "network: calls the real Edge-TTS service"]
    async fn live_synthesize_indonesian() {
        let provider = EdgeTtsProvider::new().expect("provider");
        let request = TtsRequest {
            text: "Selamat datang di tutorial aplikasi SUMBA. Klik tombol Simpan untuk melanjutkan.".into(),
            voice_id: "id-ID-GadisNeural".into(),
            rate: "+0%".into(),
            pitch: "+0Hz".into(),
            volume: "+0%".into(),
        };
        let out = provider.synthesize(&request).await.expect("live synthesis");
        let path = std::env::temp_dir().join("script-studio-live-tts.mp3");
        std::fs::write(&path, &out.audio).expect("write mp3");
        println!("audio={} bytes={} duration_ms={} words={}", path.display(), out.audio.len(), out.duration_ms, out.word_boundaries.len());
        for w in &out.word_boundaries {
            println!("  {:>6}-{:<6} {}", w.start_ms, w.end_ms, w.text);
        }
        assert!(out.duration_ms > 1000);
        assert!(out.word_boundaries.len() >= 10);
        assert!(out.word_boundaries.windows(2).all(|p| p[0].start_ms <= p[1].start_ms));
        assert!(out.word_boundaries.last().is_some_and(|w| w.end_ms <= out.duration_ms + 50));
    }

    #[tokio::test]
    #[ignore = "network: calls the real Edge-TTS service"]
    async fn live_list_voices_has_indonesian() {
        let voices = EdgeTtsProvider::new().expect("provider").list_voices().await.expect("voices");
        let id: Vec<_> = voices.iter().filter(|v| v.locale == "id-ID").map(|v| v.short_name.as_str()).collect();
        println!("total={} id-ID={id:?}", voices.len());
        assert!(id.contains(&"id-ID-GadisNeural"));
    }

    #[test]
    fn cbr_bytes_to_duration() {
        // 48 kbps → 6000 bytes per second.
        assert_eq!(bytes_to_ticks(6000) / TICKS_PER_MS, 1000);
    }
}
