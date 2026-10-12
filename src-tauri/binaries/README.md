# FFmpeg sidecar binaries (ADR D3)

## Pinned build (decided 2026-10-12)

| | |
| :-- | :-- |
| Source | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) release assets, **LGPL** variant |
| Version | **FFmpeg 8.1** (`n8.1.3`), e.g. `ffmpeg-n8.1.3-…-win64-lgpl-8.1.zip` |
| Encoders | `h264_nvenc`, `h264_qsv` (libvpl), `h264_amf`, `libopenh264`; no `libx264` (GPL) |
| Why 8.1 | BtbN builds 8.0/8.1 against NVENC SDK 13.0 (NVIDIA driver ≥ 570). 9.0/master use SDK 13.1, which needs driver ≥ 610 and failed on a driver-580 test machine. |

Still to do before bundling: download the exact asset, record its SHA-256 here and in CI, and check
`ffmpeg -buildconf` (no `--enable-gpl` / `--enable-nonfree`) plus `ffmpeg -encoders`. The app's
Engine page reports the licence and runs real test encodes for this.

## Layout

Place the binaries here (not committed; CI downloads them and verifies the checksum):

- `ffmpeg-<target-triple>[.exe]`, e.g. `ffmpeg-x86_64-pc-windows-msvc.exe`
- `ffprobe-<target-triple>[.exe]`

Then add `"externalBin": ["binaries/ffmpeg", "binaries/ffprobe"]` under `bundle` in
`tauri.conf.json`. It is intentionally not declared yet: `tauri-build` fails when the files
are missing. Until then the resolver falls back to the user's custom path or `PATH`.
