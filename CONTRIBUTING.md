# Contributing

Thanks for helping. Product specs live in the PRD (`docs/desktop-editor-prd/`, modules 00–09);
read the module for the area you touch before changing behaviour.

## Setup

```bash
npm install
npm run ffmpeg:fetch
npm run tauri dev
```

Requirements are in the README (Node ≥ 22.12, Rust stable, platform WebView). Install the pinned
LGPL FFmpeg sidecar once with `npm run ffmpeg:fetch` (`cargo build` needs it).

## Before opening a pull request

All of these must pass (CI runs them too):

```bash
npm run typecheck
npm test
npm run rust:check
npm run rust:test
```

Machine-specific checks that need FFmpeg/GPU or the network are `#[ignore]`d. Run them locally
when you change TTS, media, proxy or export code:

```bash
cd src-tauri
cargo test -- --ignored live_ --nocapture --test-threads=1
```

## Rules

- **TypeScript**: zero `any`, zero `unknown` annotations, zero casts (`as X`, `as const`).
  Data from disk, IPC or the network is parsed with Zod before use.
- **IPC is a trust boundary**: every response is validated in `src/lib/ipc.ts`; every Rust
  command validates its inputs. Paths to write come from native dialogs opened in Rust, never
  from the webview.
- **FFmpeg**: arguments as an array (no shell); long filtergraphs via `-/filter_complex <file>`;
  each filtergraph label is consumed once (enforced by `assert_labels_single_use`).
- **Undo**: every project mutation is a `Command` (`src/project/commands.ts`).
- **Design**: semantic tokens only (`src/styles/tokens.css`); status always icon + text; text
  ≥ 12 px; both themes must pass WCAG 2.2 AA.
- **Rendered output never depends on the UI theme** (e.g. badge colours are fixed).
- Remove dead code in the same change that makes it dead.

## Commits

Conventional style (`feat:`, `fix:`, `docs:` …), one logical change per commit.

## Licence

By contributing you agree that your contribution is licensed under Apache-2.0.
