# FFmpeg sidecar binaries (ADR D3)

Install for this machine (downloads, verifies SHA-256, extracts):

```bash
npm run ffmpeg:fetch
```

The binaries are not committed (`.gitignore`); `ffmpeg.lock.json` pins exactly what is installed.

## Pinned build

| | |
| :-- | :-- |
| Version | FFmpeg **8.1.3** (`n8.1.3-18-g46d899d7a0`, commit `46d899d7a02bc63237472cc4897258d5ddf274ac`) |
| Licence | **LGPL-3.0-or-later** (built without `--enable-gpl`/`--enable-nonfree`, with `--enable-version3`) |
| Builder | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) auto-build 2026-10-12 13:12, scripts commit `63ac3265b0789ea16c7b1f8351cd2ad195a28722` |
| Hosted at | release [`ffmpeg-8.1-lgpl`](https://github.com/RidhuanDEV/video-editor-dubbing/releases/tag/ffmpeg-8.1-lgpl) (BtbN prunes old builds, so we keep our own copy) together with the corresponding source and build scripts |
| Why 8.1 | BtbN builds 8.0/8.1 against NVENC SDK 13.0 (NVIDIA driver ≥ 570). 9.0 needs driver ≥ 610 and failed on a driver-580 test machine; with this build NVENC passes there. |

Verified on the Windows build (2026-10-13): encoders `h264_nvenc`, `h264_qsv`, `h264_amf`, `libopenh264`,
`aac`; filters `ass`, `zoompan`, `gblur`, `loudnorm`, `sidechaincompress`, `tpad`. Real test encodes:
NVENC, QSV and OpenH264 pass on the dev machine (AMF needs an AMD GPU).

**Not in the LGPL build:** `boxblur` (GPL-only). The renderer uses `gblur` for privacy blur.

| Target | Archive SHA-256 | Executables |
| :-- | :-- | :-- |
| `x86_64-pc-windows-msvc` | `03a86ada3d4fa14f28ac365f03866ab9ba68587442c172d4f5c6088f431c36c2` | ffmpeg.exe `4737dc5c…cfb`, ffprobe.exe `980010ab…759` |
| `x86_64-unknown-linux-gnu` | `968e3a2d1c36b98e7a99e755d5fc61997e83ef864f8fe0d57d280bc20ca4c777` | |
| macOS (`aarch64`/`x86_64-apple-darwin`) | not yet: built by `.github/workflows/ffmpeg-macos.yml` (BtbN has no macOS builds) | |

## How it is bundled

`tauri.conf.json` declares `"externalBin": ["binaries/ffmpeg", "binaries/ffprobe"]`, so the files
must exist as `ffmpeg-<target-triple>[.exe]` before `cargo build`. Tauri places them next to the
app executable without the triple; the resolver order is custom path → bundled → `PATH`.
For `cargo check` on a target without a pinned build, `node scripts/fetch-ffmpeg.mjs --placeholder`
creates empty files (never ship these).

## Updating the pin

1. Download the new BtbN LGPL assets and `checksums.sha256`; verify.
2. Check `-buildconf` (no GPL/nonfree), encoders, filters; run `cargo test -- --ignored live_` with it on `PATH`.
3. Create a new release with binaries + matching FFmpeg source + BtbN scripts + `SHA256SUMS`.
4. Update `ffmpeg.lock.json`, this file and `THIRD_PARTY_NOTICES.md`.
