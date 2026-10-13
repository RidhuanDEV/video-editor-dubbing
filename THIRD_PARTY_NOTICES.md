# Third-party notices

Script Studio is licensed under the Apache License 2.0 (see `LICENSE` and `NOTICE`).
It uses or bundles the third-party components below under their own licences.

## FFmpeg (bundled as a separate program)

- **What**: `ffmpeg` and `ffprobe` executables, run as separate processes (sidecar). They are not
  linked into the application binary.
- **Licence**: GNU Lesser General Public License **version 3 or later** (configured without
  `--enable-gpl` and `--enable-nonfree`, with `--enable-version3`). The licence text ships as
  `licenses/FFMPEG-LICENSE.txt` next to the application.
- **Build**: FFmpeg 8.1.3 (`n8.1.3-18-g46d899d7a0`) built by
  [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) (LGPL variant). Archive checksums
  and executable hashes are recorded in `src-tauri/binaries/README.md` and
  `src-tauri/binaries/ffmpeg.lock.json`.
- **Corresponding source**: the release
  <https://github.com/RidhuanDEV/video-editor-dubbing/releases/tag/ffmpeg-8.1-lgpl> is the
  designated place to copy the source of the shipped binaries: FFmpeg at commit
  `46d899d7a02bc63237472cc4897258d5ddf274ac` and the BtbN build scripts at commit
  `63ac3265b0789ea16c7b1f8351cd2ad195a28722`, which pin the source of every bundled library.
- **Replacing it**: the resolver order is custom path → bundled → `PATH`, so a different FFmpeg
  can be used instead of the bundled one (the LGPL right to substitute). The custom ffmpeg is
  chosen in Settings → Video & GPU, verified, stored, and then used by every job.
  A build you supply (e.g. with `libx264`) is under its own licence and your responsibility.
- The FFmpeg build includes **libass** (ISC), **FreeType** (FTL), **FriBidi** (LGPL),
  **HarfBuzz** (MIT), **OpenH264** (BSD-2-Clause), **libvpl** (MIT), **nv-codec-headers** (MIT)
  and **AMF** headers (MIT).
- **Patents**: software licences do not grant patent rights for H.264/AAC. Cisco's OpenH264
  patent coverage applies only to binaries built and distributed by Cisco. For this reason the
  default export is **AV1 + Opus in WebM** (royalty-free formats, encoded with SVT-AV1 or the
  GPU's AV1 encoder); H.264 + AAC in MP4 is an explicit opt-in for compatibility (ADR D6).
  This is not legal advice.

## Fonts (bundled)

- **Inter** — © The Inter Project Authors, SIL Open Font License 1.1. UI: `@fontsource-variable/inter`.
  Export: `Inter-Regular.ttf` and `Inter-Bold.ttf` from the official Inter 4.1 release
  (Inter-4.1.zip, SHA-256 `9883fdd4…b11e`) ship in `fonts/` and are passed to libass so burned-in
  subtitles and badges use the same font as the preview. Licence: `licenses/Inter-OFL.txt`.
- **JetBrains Mono** — © JetBrains s.r.o., SIL Open Font License 1.1 (`@fontsource-variable/jetbrains-mono`).

## Frontend libraries (npm, bundled into the app)

| Package | Licence |
| :-- | :-- |
| react, react-dom | MIT |
| @tauri-apps/api, @tauri-apps/plugin-updater, @tauri-apps/plugin-process | Apache-2.0 OR MIT |
| zod | MIT |
| zustand | MIT |
| radix-ui (Radix Primitives) | MIT |
| react-resizable-panels | MIT |
| cmdk | MIT |
| lucide-react | ISC |
| tailwindcss (build time) | MIT |

## Rust crates (compiled into the app)

Direct dependencies: tauri, tauri-plugin-dialog, tauri-plugin-updater, tauri-plugin-process,
tauri-plugin-window-state, tauri-plugin-single-instance (Apache-2.0 OR MIT), tokio, serde, serde_json, tokio-tungstenite, reqwest, futures-util,
async-trait, sha2, hex, uuid, chrono, httpdate, thiserror, tracing, tracing-subscriber,
tracing-appender, keyring (MIT and/or Apache-2.0).
The full transitive list with licence texts is generated per release with
[`cargo-about`](https://github.com/EmbarkStudios/cargo-about) and attached to the release.

## Online services

- **Edge-TTS (opt-in)**: narration can use Microsoft Edge's read-aloud service through an
  **unofficial** client. It is used only after the user accepts a notice in the app (revocable
  in Settings). It is not affiliated with or endorsed by Microsoft, may change or be blocked at
  any time, and its terms for commercial use are unclear.
- **Azure Speech (official)**: uses the user's own Azure key and region; the key is stored in the
  operating system keychain. Usage is billed and governed by the user's Azure terms. Recommended
  for commercial work.
- **Updates**: at startup the app checks this repository's GitHub Releases for a signed update.
