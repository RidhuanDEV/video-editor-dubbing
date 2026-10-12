fn main() {
    // Exposes the target triple so the FFmpeg resolver can find Tauri sidecars named `ffmpeg-<triple>`.
    println!(
        "cargo:rustc-env=TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("cargo sets TARGET for build scripts")
    );
    tauri_build::build();
}
