#!/usr/bin/env node
// Installs the pinned LGPL FFmpeg sidecar into src-tauri/binaries/ (ADR D3).
//
//   node scripts/fetch-ffmpeg.mjs                 # host target
//   node scripts/fetch-ffmpeg.mjs --target <triple>
//   node scripts/fetch-ffmpeg.mjs --placeholder   # empty files: lets `cargo check` run where no
//                                                 # build exists yet (never ship these)
//
// Downloads from the release pinned in src-tauri/binaries/ffmpeg.lock.json, verifies SHA-256
// before extracting, and writes ffmpeg-<triple>[.exe] / ffprobe-<triple>[.exe].
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binaries = join(root, "src-tauri", "binaries");
const lock = JSON.parse(readFileSync(join(binaries, "ffmpeg.lock.json"), "utf8"));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

function hostTriple() {
  const rustc = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  const host = rustc.stdout?.match(/^host: (.+)$/m)?.[1];
  if (host) return host.trim();
  const map = { "win32-x64": "x86_64-pc-windows-msvc", "linux-x64": "x86_64-unknown-linux-gnu", "darwin-arm64": "aarch64-apple-darwin", "darwin-x64": "x86_64-apple-darwin" };
  const triple = map[`${process.platform}-${process.arch}`];
  if (!triple) throw new Error(`Unknown platform ${process.platform}-${process.arch}; pass --target`);
  return triple;
}

const triple = option("--target") ?? hostTriple();
const exeSuffix = triple.includes("windows") ? ".exe" : "";
const outputs = ["ffmpeg", "ffprobe"].map((tool) => ({ tool, path: join(binaries, `${tool}-${triple}${exeSuffix}`) }));

if (flag("--placeholder")) {
  // tauri-build also requires the bundled licence resource to exist.
  const licence = join(binaries, "FFMPEG-LICENSE.txt");
  for (const path of [...outputs.map((o) => o.path), licence]) if (!existsSync(path)) writeFileSync(path, "");
  console.log(`placeholder sidecars for ${triple} (for cargo check only; not runnable)`);
  process.exit(0);
}

const target = lock.targets[triple];
if (!target) {
  console.error(`No pinned FFmpeg build for ${triple}. Pinned: ${Object.keys(lock.targets).join(", ")}`);
  process.exit(1);
}
if (!flag("--force") && outputs.every(({ path }) => existsSync(path) && readFileSync(path).length > 0)) {
  console.log(`FFmpeg ${lock.version} already installed for ${triple}`);
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), "ffmpeg-sidecar-"));
try {
  const url = `${lock.release}/${target.archive}`;
  console.log(`downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== target.sha256) throw new Error(`checksum mismatch for ${target.archive}: got ${digest}, expected ${target.sha256}`);
  writeFileSync(join(work, target.archive), bytes);

  // Relative archive path + cwd: GNU tar would read "C:" in an absolute path as a remote host.
  // On Windows use the system bsdtar explicitly: Git Bash puts GNU tar first on PATH, and GNU
  // tar cannot read .zip.
  const systemTar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  const extract = spawnSync(systemTar, ["-xf", target.archive], { cwd: work, stdio: "inherit" });
  if (extract.status !== 0) throw new Error("extracting the archive failed (tar)");

  mkdirSync(binaries, { recursive: true });
  for (const { tool, path } of outputs) {
    const source = join(work, ...target.binDir.split("/"), `${tool}${target.exeSuffix}`);
    copyFileSync(source, path);
    if (!exeSuffix) chmodSync(path, 0o755);
  }
  copyFileSync(join(work, target.binDir.split("/")[0], "LICENSE.txt"), join(binaries, "FFMPEG-LICENSE.txt"));
  console.log(`installed FFmpeg ${lock.version} (${lock.license}) for ${triple}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
