//! Live export tests with the machine's FFmpeg: `cargo test -- --ignored live_export --nocapture`.

use std::path::PathBuf;
use std::time::Duration;

use tokio::sync::watch;

use super::*;
use crate::ffmpeg::run;
use crate::render::graph::tests::sample_manifest;

struct Fixture {
    root: PathBuf,
    manifest: Manifest,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

async fn generate(args: &[String]) {
    let ffmpeg = resolve(Tool::Ffmpeg, None).expect("ffmpeg");
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    assert!(run(&ffmpeg.path, &refs, Duration::from_secs(120)).await.expect("gen").success, "generate {args:?}");
}

fn strings(parts: &[&str], tail: &[String]) -> Vec<String> {
    parts.iter().map(|s| (*s).to_owned()).chain(tail.iter().cloned()).collect()
}

/// Project with a generated 1080p recording, sine "narrations" and BGM, laid out like
/// `sample_manifest()` (freeze, 2x ripple-cut, blur, zoom, ducked BGM). The root path has
/// spaces on purpose.
async fn fixture() -> Fixture {
    let root = std::env::temp_dir().join(format!("script studio export {}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(root.join("cache/tts")).expect("dirs");
    let video = root.join("login recording.mp4");
    generate(&strings(&["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=8", "-pix_fmt", "yuv420p"], &[video.to_string_lossy().into_owned()])).await;
    for (name, secs, freq) in [("a", "3.42", "440"), ("b", "1.5", "660")] {
        let path = root.join(format!("cache/tts/{}.mp3", name.repeat(64)));
        generate(&strings(&["-y", "-loglevel", "error", "-f", "lavfi", "-i"], &[format!("sine=frequency={freq}:duration={secs}"), path.to_string_lossy().into_owned()])).await;
    }
    let bgm = root.join("bgm.mp3");
    generate(&strings(&["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=20"], &[bgm.to_string_lossy().into_owned()])).await;

    let mut manifest = sample_manifest();
    manifest.assets[0].file_path = video.to_string_lossy().into_owned();
    manifest.bgm_tracks[0].file_path = bgm.to_string_lossy().into_owned();
    Fixture { root, manifest }
}

const OVERLAY: &str = "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,42,&H00FFFFFF,&H00FFFFFF,&HFF000000,&H5F000000,0,0,0,0,100,100,0,0,4,8,0,2,60,60,64,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Selamat datang\n";

async fn encoder(codec: Codec) -> VideoEncoder {
    crate::ffmpeg::detect_encoder(None, codec, |_| {}).await.expect("detect").selected.expect("encoder")
}

#[tokio::test]
#[ignore = "machine-specific: full encode with the local ffmpeg"]
async fn live_export_end_to_end_av1() {
    end_to_end(Codec::Av1, "webm", ["av1", "opus"]).await;
}

#[tokio::test]
#[ignore = "machine-specific: full encode with the local ffmpeg"]
async fn live_export_end_to_end_h264() {
    end_to_end(Codec::H264, "mp4", ["h264", "aac"]).await;
}

async fn end_to_end(codec: Codec, ext: &str, codecs: [&str; 2]) {
    let fx = fixture().await;
    let encoder = encoder(codec).await;
    let (_tx, rx) = watch::channel(false);
    let mut last = 0.0;
    let output = run_export(
        ExportJob {
            job_id: "live",
            project_root: &fx.root,
            manifest: fx.manifest.clone(),
            preset: PresetId::Youtube1080,
            codec,
            output: fx.root.join("hasil akhir.mp4"),
            encoder: Some(encoder),
            overlay_ass: Some(OVERLAY.to_owned()),
            // The bundled fonts, as the installed app passes them.
            fonts_dir: Some(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fonts")),
            srt: Some("1\n00:00:00,000 --> 00:00:01,000\nHalo\n".to_owned()),
        },
        rx,
        |p| last = p.percentage,
    )
    .await
    .expect("export");

    // The extension follows the codec family even if the dialog suggested another one.
    assert!(output.is_file() && output.ends_with(format!("hasil akhir.{ext}")), "{}", output.display());
    assert!(fx.root.join("hasil akhir.srt").is_file());
    assert!(!fx.root.join(format!("hasil akhir.part.{ext}")).exists());
    assert!(!fx.root.join("cache/render/live").exists(), "work dir cleaned");
    println!("encoder={} last progress={last:.1}%", encoder.ffmpeg_name());

    let ffprobe = resolve(Tool::Ffprobe, None).expect("ffprobe");
    let out = output.to_string_lossy().into_owned();
    let probe = run(
        &ffprobe.path,
        &["-v", "error", "-show_entries", "stream=codec_name,width,height,r_frame_rate:format=duration", "-of", "json", &out],
        Duration::from_secs(30),
    )
    .await
    .expect("probe");
    println!("{}", probe.stdout);
    for name in codecs {
        assert!(probe.stdout.contains(&format!("\"codec_name\": \"{name}\"")), "missing {name}");
    }
    assert!(probe.stdout.contains("\"width\": 1920") && probe.stdout.contains("\"height\": 1080"));
    let duration: f64 = probe
        .stdout
        .split("\"duration\": \"")
        .nth(1)
        .and_then(|s| s.split('"').next())
        .and_then(|s| s.parse().ok())
        .expect("duration");
    assert!((duration - 5.52).abs() < 0.1, "duration {duration} vs timeline 5.52 s");

    // Integrated loudness of the result should land near the -14 LUFS target.
    let ffmpeg = resolve(Tool::Ffmpeg, None).expect("ffmpeg");
    let measure = run(&ffmpeg.path, &["-hide_banner", "-nostats", "-i", &out, "-af", "ebur128", "-f", "null", "-"], Duration::from_secs(60))
        .await
        .expect("measure");
    let integrated: f64 = measure
        .stderr
        .rsplit("I:")
        .next()
        .and_then(|s| s.split("LUFS").next())
        .and_then(|s| s.trim().parse().ok())
        .expect("integrated loudness");
    println!("integrated loudness {integrated} LUFS");
    assert!((integrated + 14.0).abs() < 2.0, "loudness {integrated} LUFS");

    // Frames for visual inspection: blur active (0.5 s) and zoom peak (1.5 s).
    for (t, name) in [("0.5", "frame-blur.png"), ("1.5", "frame-zoom.png")] {
        let target = std::env::temp_dir().join(format!("script-studio-{ext}-{name}")).to_string_lossy().into_owned();
        let _ = run(&ffmpeg.path, &["-y", "-loglevel", "error", "-ss", t, "-i", &out, "-frames:v", "1", "-update", "1", &target], Duration::from_secs(30)).await;
    }
}

#[tokio::test]
#[ignore = "machine-specific: full encode with the local ffmpeg"]
async fn live_export_cancel_leaves_nothing() {
    let fx = fixture().await;
    let encoder = encoder(Codec::H264).await;
    let (tx, rx) = watch::channel(false);
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(400)).await;
        let _ = tx.send(true);
    });
    let mut manifest = fx.manifest.clone();
    manifest.loudness.enabled = false;
    let result = run_export(
        ExportJob {
            job_id: "cancel",
            project_root: &fx.root,
            manifest,
            preset: PresetId::Youtube4k,
            codec: Codec::H264,
            output: fx.root.join("batal.mp4"),
            encoder: Some(encoder),
            overlay_ass: None,
            fonts_dir: None,
            srt: None,
        },
        rx,
        |_| {},
    )
    .await;
    assert!(matches!(result, Err(ExportError::Ffmpeg(FfmpegError::Cancelled))), "{result:?}");
    assert!(!fx.root.join("batal.mp4").exists() && !fx.root.join("batal.part.mp4").exists());
    assert!(!fx.root.join("cache/render/cancel").exists());
}
