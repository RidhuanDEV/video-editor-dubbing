# Script Studio (desktop)

Script-driven video editor & dubbing studio: Tauri 2 (Rust) + React 19 + TypeScript strict + Tailwind CSS v4.
Specs live in `../../docs/desktop-editor-prd/` (PRD 00–09). Licence: Apache-2.0. FFmpeg is an LGPL sidecar (ADR D3).

Status: **Phase 0/1** — scaffold, core contracts, FFmpeg resolver + encoder detection, native Edge-TTS spike.

## Prerequisites

- Node.js ≥ 22.12
- Rust stable (MSVC toolchain on Windows) + Microsoft C++ Build Tools, WebView2 (preinstalled on Windows 11)
- FFmpeg on `PATH` or a custom path until the LGPL sidecar is pinned (`src-tauri/binaries/README.md`)

## Commands

| Command | Purpose |
| :-- | :-- |
| `npm install` | Install frontend deps |
| `npm run tauri dev` | Run the desktop app (Vite on :1420 + Rust core) |
| `npm run dev` | UI only in a browser; engine calls show "Engine Rust tidak tersedia" |
| `npm run typecheck` | `tsc` strict for `src/` and `vite.config.ts` |
| `npm run rust:check` / `npm run rust:test` | `cargo check` / `cargo test` for `src-tauri` |
| `npm run tauri build` | Production installer |

## Layout

```
src/
  types/        Zod schemas = single source of truth; types inferred + DeepReadonly
    project.ts  ProjectManifest contract (PRD 02)
    ipc.ts      IPC DTOs mirrored from Rust serde output
    theme.ts    ThemePreference / resolveTheme (PRD 08 §4)
  lib/ipc.ts    Typed invoke wrapper: every response/rejection validated with Zod
  lib/theme.ts  Theme hook (system/light/dark, Ctrl/Cmd+Shift+L, native title bar sync)
  styles/       tokens.css (PRD 08 tokens) + index.css (Tailwind v4 @theme inline)
  components/   AppShell (page bar), WorkspacePage, EngineView (diagnostics), ui primitives
src-tauri/src/
  ffmpeg/       resolver (custom → bundled → PATH), process (array args, timeout, kill-on-drop),
                probe (version + LGPL/GPL/nonfree detection), encoder (real test-encode chain)
  tts/          TtsProvider trait, EdgeTtsProvider (native WebSocket, WordBoundary, chunking,
                clock-skew retry), SHA-256 disk cache (atomic writes)
  commands.rs   IPC: check_dependencies, detect_encoder, tts_synthesize, tts_list_voices
  error.rs      AppError { kind, message } crossing IPC
```

## Engineering rules

- TypeScript: zero `any`, zero `unknown` annotations, zero loose casts. External data (disk, IPC, network) is parsed with Zod.
- FFmpeg is always invoked with an argument array, never a shell string.
- Edge-TTS is an **unofficial** service; failures are typed (`network`, `blocked`, `timeout`, `protocol`) and shown with an action.

## Known environment quirk

The dev machine has a stray `D:\.gitignore` containing `*`. Tools that honour ancestor ignore files (Tailwind's
scanner) skip everything under D: unless the project is its own git repo, which this folder is. Do not
move `src/` outside the repo root.
