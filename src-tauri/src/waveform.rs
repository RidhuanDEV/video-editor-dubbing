//! Audio peaks for timeline waveforms (08 §8: computed once and cached). FFmpeg decodes to
//! 8 kHz mono PCM on stdout; peaks are folded while streaming, so memory stays constant even
//! for long BGM files.

use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, UNIX_EPOCH};

use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;

use crate::ffmpeg::{command_for, error_summary, resolve, FfmpegError, Tool};

pub const PEAKS_PER_SECOND: u32 = 50;
const SAMPLE_RATE: u32 = 8000;
const SAMPLES_PER_PEAK: u32 = SAMPLE_RATE / PEAKS_PER_SECOND;
const DECODE_TIMEOUT: Duration = Duration::from_secs(180);

/// Max |sample| per bucket, scaled to 0–255. A trailing partial bucket is kept.
#[derive(Default)]
struct PeakFolder {
    peaks: Vec<u8>,
    current: u16,
    count: u32,
    /// Odd byte left over between reads (samples are 2 bytes, reads are not aligned).
    carry: Option<u8>,
}

impl PeakFolder {
    fn push_bytes(&mut self, bytes: &[u8]) {
        let mut rest = bytes;
        if let (Some(low), Some((&high, tail))) = (self.carry.take(), rest.split_first()) {
            self.push_sample(i16::from_le_bytes([low, high]));
            rest = tail;
        }
        let mut chunks = rest.chunks_exact(2);
        for pair in &mut chunks {
            self.push_sample(i16::from_le_bytes([pair[0], pair[1]]));
        }
        self.carry = chunks.remainder().first().copied();
    }

    fn push_sample(&mut self, sample: i16) {
        self.current = self.current.max(sample.unsigned_abs());
        self.count += 1;
        if self.count == SAMPLES_PER_PEAK {
            self.flush();
        }
    }

    fn flush(&mut self) {
        // 32768 → 255; u32 math so the largest magnitude cannot overflow.
        self.peaks.push(u8::try_from(u32::from(self.current) * 255 / 32768).unwrap_or(u8::MAX));
        self.current = 0;
        self.count = 0;
    }

    fn finish(mut self) -> Vec<u8> {
        if self.count > 0 {
            self.flush();
        }
        self.peaks
    }
}

/// Cache key: the file identity (path, size, mtime), so an edited file is re-analysed.
fn cache_key(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos();
    let mut hasher = Sha256::new();
    hasher.update(path.display().to_string().as_bytes());
    hasher.update(meta.len().to_le_bytes());
    hasher.update(mtime.to_le_bytes());
    Some(hex::encode(hasher.finalize()))
}

/// Peaks of `audio`, from `cache_dir` when already computed. Cache write failures only cost a
/// recomputation next time, so they are logged, not returned.
pub async fn peaks(audio: &Path, cache_dir: &Path) -> Result<Vec<u8>, FfmpegError> {
    let cached = cache_key(audio).map(|key| cache_dir.join(format!("{key}.peaks")));
    if let Some(bytes) = cached.as_deref().and_then(|p| std::fs::read(p).ok()) {
        return Ok(bytes);
    }
    let computed = decode_peaks(audio).await?;
    if let Some(path) = cached {
        let write = std::fs::create_dir_all(cache_dir).and_then(|()| std::fs::write(&path, &computed));
        if let Err(err) = write {
            tracing::warn!(error = %err, "waveform cache not written");
        }
    }
    Ok(computed)
}

async fn decode_peaks(audio: &Path) -> Result<Vec<u8>, FfmpegError> {
    let ffmpeg = resolve(Tool::Ffmpeg, None)?;
    let input = audio.display().to_string();
    let rate = SAMPLE_RATE.to_string();
    let args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", &input, "-vn", "-ac", "1", "-ar", &rate, "-f", "s16le", "pipe:1"];
    let mut command = command_for(&ffmpeg.path, &args);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| FfmpegError::Spawn(format!("ffmpeg: {e}")))?;
    let mut stdout = child.stdout.take().ok_or_else(|| FfmpegError::Spawn("ffmpeg: stdout tidak tersedia".into()))?;
    let mut stderr = child.stderr.take().ok_or_else(|| FfmpegError::Spawn("ffmpeg: stderr tidak tersedia".into()))?;

    let work = async {
        let mut folder = PeakFolder::default();
        let mut buffer = vec![0_u8; 64 * 1024];
        let mut errors = String::new();
        let read_err = |e: std::io::Error| FfmpegError::Failed(format!("membaca audio: {e}"));
        // stderr is drained concurrently so a chatty decoder never blocks on a full pipe.
        let (pcm, _) = tokio::join!(
            async {
                loop {
                    let n = stdout.read(&mut buffer).await.map_err(read_err)?;
                    if n == 0 {
                        return Ok::<_, FfmpegError>(());
                    }
                    folder.push_bytes(&buffer[..n]);
                }
            },
            stderr.read_to_string(&mut errors)
        );
        pcm?;
        let status = child.wait().await.map_err(|e| FfmpegError::Failed(e.to_string()))?;
        if status.success() {
            Ok(folder.finish())
        } else {
            Err(FfmpegError::Failed(error_summary(&errors)))
        }
    };
    // kill_on_drop (command_for) ends the decoder if the timeout drops `work`.
    tokio::time::timeout(DECODE_TIMEOUT, work)
        .await
        .map_err(|_| FfmpegError::Timeout(format!("analisis waveform ({} dtk)", DECODE_TIMEOUT.as_secs())))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pcm(samples: &[i16]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }

    #[test]
    fn folds_max_magnitude_per_bucket_across_unaligned_reads() {
        let per = SAMPLES_PER_PEAK as usize;
        let mut samples = vec![0_i16; per * 2 + 10];
        samples[3] = -32768;
        samples[per + 5] = 16384;
        samples[per * 2 + 1] = 100;
        let bytes = pcm(&samples);
        let mut folder = PeakFolder::default();
        // Odd split: the sample boundary falls inside a read.
        folder.push_bytes(&bytes[..333]);
        folder.push_bytes(&bytes[333..]);
        assert_eq!(folder.finish(), vec![255, 127, 0]);
    }

    /// Live: decodes a generated tone with the real FFmpeg.
    #[tokio::test]
    #[ignore = "machine-specific: needs FFmpeg"]
    async fn live_peaks_of_generated_tone() {
        let dir = std::env::temp_dir().join(format!("script-studio-peaks-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).expect("dir");
        let wav = dir.join("tone.wav");
        let ffmpeg = resolve(Tool::Ffmpeg, None).expect("ffmpeg");
        let status = std::process::Command::new(&ffmpeg.path)
            .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-y"])
            .arg(&wav)
            .status()
            .expect("run");
        assert!(status.success());
        let first = peaks(&wav, &dir.join("cache")).await.expect("peaks");
        assert_eq!(first.len(), (2 * PEAKS_PER_SECOND) as usize);
        // lavfi `sine` has amplitude 1/8 → peak ≈ 255/8 ≈ 31 in every bucket.
        assert!(first.iter().all(|&p| (28..=34).contains(&p)), "{first:?}");
        // Second call is served from the cache file.
        assert_eq!(peaks(&wav, &dir.join("cache")).await.expect("cached"), first);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
