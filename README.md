# Script Studio (desktop)

Script-driven video editor & dubbing studio: Tauri 2 (Rust) + React 19 + TypeScript strict + Tailwind CSS v4.
Specs live in `../../docs/desktop-editor-prd/` (PRD 00–09). Licence: Apache-2.0. FFmpeg is an LGPL sidecar (ADR D3).

Status: **Phase 5 (MVP feature-complete)** — export with presets (YouTube 1080p/4K, Shorts,
WhatsApp, audio only), two-pass loudness, burned-in overlay (subtitles, badges, spotlight) or SRT sidecar,
progress/ETA, safe cancel. Bundled pinned LGPL FFmpeg sidecar, signed in-app updater.
Legal defaults (ADR D6): export defaults to royalty-free **AV1 + Opus (WebM)**, H.264 + AAC (MP4) is an
option; Edge-TTS is opt-in behind a consent notice, Azure Speech (official, user's own key) is available.
Installers are **not code-signed** (open-source, no certificate budget): Windows SmartScreen asks once.
Remaining: macOS build, cross-OS verification and benchmarks (see Release checklist).

## Prerequisites

- Node.js ≥ 22.12
- Rust stable (MSVC toolchain on Windows) + Microsoft C++ Build Tools, WebView2 (preinstalled on Windows 11)
- FFmpeg sidecar: `npm run ffmpeg:fetch` (pinned LGPL build, checksum-verified; see `src-tauri/binaries/README.md`)

## Commands

| Command | Purpose |
| :-- | :-- |
| `npm install` | Install frontend deps |
| `npm run tauri dev` | Run the desktop app (Vite on :1420 + Rust core) |
| `npm run dev` | UI only in a browser; engine calls show "Engine Rust tidak tersedia" |
| `npm run typecheck` | `tsc` strict for `src/` and `vite.config.ts` |
| `npm test` | Vitest unit tests (schemas, commands/undo, chunking, sync status) |
| `npm run rust:check` / `npm run rust:test` | `cargo check` / `cargo test` for `src-tauri` |
| `cargo test -- --ignored live_` (in `src-tauri`) | Live checks: real Edge-TTS, real FFmpeg encode/probe on this machine |
| `npm run tauri build` | Production installer |

## Layout

```
src/
  types/        Zod schemas = single source of truth; types inferred + DeepReadonly
    project.ts  ProjectManifest contract (PRD 02)
    ipc.ts      IPC DTOs mirrored from Rust serde output
    theme.ts    ThemePreference / resolveTheme (PRD 08 §4)
  project/      manifest (create/load/serialize), commands (undo/redo), store (Zustand),
                session (open/save/autosave/recovery), chunk, sync, synthesis,
                timeline (layout/snap), editor (playhead/selection), proxies (background queue),
                effects (geometry/easing), subtitles (align/chunk/ASS/SRT), subtitleData,
                overlay (export ASS: subtitles + badges + spotlight)
  lib/ipc.ts    Typed invoke wrapper: every response/rejection validated with Zod
  lib/theme.ts  Theme hook (system/light/dark, Ctrl/Cmd+Shift+L, native title bar sync)
  styles/       tokens.css (PRD 08 tokens) + index.css (Tailwind v4 @theme inline)
  components/   AppShell, StartScreen, MediaPage, ScriptPage + SceneEditor, AudioPage, ExportPage, EngineView, Dialog, ui
    edit/       EditPage (Edit + Efek), Preview, EffectLayers, EffectGizmo, EffectsPanel, Timeline
src-tauri/src/
  ffmpeg/       resolver (custom → bundled → PATH), process (array args, timeout, kill-on-drop),
                probe (version + LGPL/GPL/nonfree detection), encoder (real test-encode chain)
  tts/          TtsProvider trait, EdgeTtsProvider (native WebSocket, WordBoundary, chunking,
                clock-skew retry), SHA-256 disk cache (atomic writes)
  project.rs    .smbproj folder service: atomic writes inside the open project only
  media.rs      ffprobe metadata, thumbnails, relink by file or folder
  proxy.rs      preview proxies inside the project (video H.264 540p short GOP, audio AAC)
  render/       model (manifest subset + timeline math), graph (filtergraph generator, golden tests),
                export (2-pass loudnorm, presets, progress, cancel, .part → rename)
  dialog.rs     Native dialogs opened from Rust (the webview never supplies paths to write)
  settings.rs   settings.json (Edge consent, Azure region) + Azure key in the OS keychain
  commands/     IPC: engine (deps, encoders, TTS), project, media, export, settings
  error.rs      AppError { kind, message } crossing IPC
```

## Engineering rules

- TypeScript: zero `any`, zero `unknown` annotations, zero loose casts. External data (disk, IPC, network) is parsed with Zod.
- FFmpeg is always invoked with an argument array, never a shell string.
- Edge-TTS is an **unofficial** service used only after consent; failures are typed (`network`, `blocked`, `timeout`, `protocol`, `consentRequired`) and shown with an action.
- Secrets (Azure key) live only in the OS keychain; never in the manifest, settings.json or logs.

## Release checklist (owner)

- [x] Pin the BtbN LGPL FFmpeg 8.1.3 build (Windows, Linux), verify, host it with its source in release `ffmpeg-8.1-lgpl`, bundle as `externalBin` (`npm run ffmpeg:fetch`).
- [ ] macOS FFmpeg: run `.github/workflows/ffmpeg-macos.yml` once, attach the result to the release, add it to `ffmpeg.lock.json` and `release.yml`.
- [x] Code signing: decided **not** to sign (ADR D6). Windows shows SmartScreen once; macOS users must allow the app in Privacy & Security.
- [x] Updater key pair: secrets `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` set; public key and endpoint in `tauri.conf.json`.
- [ ] **Back up the updater private key** (`%USERPROFILE%\.tauri\script-studio\updater.key` + its password) somewhere safe. If it is lost, installed apps can never verify a new update.
- [ ] Publish a release: bump the version (`tauri.conf.json`, `Cargo.toml`, `package.json`), push a tag `vX.Y.Z`, wait for `release.yml`, review the draft release, then **Publish** it. The updater only sees published releases (`releases/latest/download/latest.json`).
- [ ] Export a 20-scene sample project on Windows, macOS and Linux; record CPU-only and GPU benchmarks (PRD 05 §6).
- [x] Legal defaults (ADR D6): AV1/Opus default export, H.264/AAC opt-in, Edge-TTS opt-in, Azure Speech official engine. Not legal advice.

## Known environment quirk

The dev machine has a stray `D:\.gitignore` containing `*`. Tools that honour ancestor ignore files (Tailwind's
scanner) skip everything under D: unless the project is its own git repo, which this folder is. Do not
move `src/` outside the repo root.
