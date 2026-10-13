/**
 * Manifest lifecycle (02 §5): create, load (version probe → validate), serialize.
 *
 * Migration: `schemaVersion` is read with a tiny schema before full validation. Only 1.0.0
 * exists today, so there are no migrators yet; the first schema bump adds a `vN → vN+1` pure
 * function here plus a fixture under `fixtures/` and the `.bak` backup before saving.
 */
import { z } from "zod";
import {
  ProjectManifestSchema,
  SCHEMA_VERSION,
  type MediaAsset,
  type ProbedMedia,
  type ProjectManifest,
  type TrackKind,
} from "../types";

const VersionProbeSchema = z.object({ schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/) });

const TRACK_ORDER: ReadonlyArray<TrackKind> = ["video", "narration", "bgm", "effects", "subtitle"];

export function createManifest(title: string, now: Date = new Date()): ProjectManifest {
  const timestamp = now.toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    title: title.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
    defaultVoice: { engine: "edge-tts", voiceId: "id-ID-GadisNeural", rate: "+0%", pitch: "+0Hz", volume: "+0%" },
    canvas: { width: 1920, height: 1080, fps: 30, background: "#1F2933", padding: 0, fit: "contain", aspectRatio: "16:9" },
    assets: [],
    scenes: [],
    bgmTracks: [],
    subtitleSettings: {
      enabled: true,
      fontName: "Inter",
      fontSize: 42,
      primaryColor: "#FFFFFF",
      highlightColor: "#F5A800",
      backColor: "#000000A0",
      maxCharsPerChunk: 80,
    },
    markers: [],
    tracks: TRACK_ORDER.map((kind) => ({ kind, muted: false, solo: false, locked: false })),
    sceneGapMs: 300,
    loudness: { enabled: true, targetLufs: -14 },
  };
}

export type LoadResult =
  | { readonly ok: true; readonly manifest: ProjectManifest; readonly readOnly: boolean }
  | { readonly ok: false; readonly message: string };

/** Compares `x.y.z` versions numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * `JSON.parse` output goes straight into a schema and is never held as an untyped value.
 * Returns null for text that is not JSON at all.
 */
function parseJsonWith<S extends z.ZodType>(schema: S, text: string): z.ZodSafeParseResult<z.output<S>> | null {
  try {
    return schema.safeParse(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Parses untrusted `project.json` text. Never throws. */
export function loadManifest(text: string): LoadResult {
  const probe = parseJsonWith(VersionProbeSchema, text);
  if (probe === null) return { ok: false, message: "project.json bukan JSON yang valid." };
  if (!probe.success) return { ok: false, message: "project.json tidak memiliki schemaVersion yang valid." };
  const version = probe.data.schemaVersion;
  const order = compareVersions(version, SCHEMA_VERSION);

  if (order < 0) {
    return { ok: false, message: `Versi proyek ${version} lebih lama dan belum memiliki migrator ke ${SCHEMA_VERSION}.` };
  }
  if (order > 0) {
    // Newer app wrote this file: open read-only (02 §5.5), best-effort with the known shape.
    const parsed = parseJsonWith(ProjectManifestSchema.extend({ schemaVersion: z.string() }), text);
    if (parsed === null || !parsed.success) return { ok: false, message: `Proyek versi ${version} lebih baru dan tidak dapat dibaca${parsed ? `: ${formatIssues(parsed.error)}` : "."}` };
    return { ok: true, manifest: { ...parsed.data, schemaVersion: SCHEMA_VERSION }, readOnly: true };
  }

  const parsed = parseJsonWith(ProjectManifestSchema, text);
  if (parsed === null || !parsed.success) {
    return { ok: false, message: `project.json tidak valid${parsed ? `: ${formatIssues(parsed.error)}` : "."}` };
  }
  return { ok: true, manifest: parsed.data, readOnly: false };
}

export function serializeManifest(manifest: ProjectManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Maps a Rust probe result to the manifest shape (optional keys omitted, not undefined). */
export function assetFromProbe(media: ProbedMedia): MediaAsset {
  return {
    id: media.id,
    kind: media.kind,
    filePath: media.filePath,
    ...(media.durationMs !== null && { durationMs: media.durationMs }),
    ...(media.width !== null && { width: media.width }),
    ...(media.height !== null && { height: media.height }),
    ...(media.fps !== null && { fps: media.fps }),
  };
}

/** Deterministic thumbnail location written by the Rust media service. */
export function thumbnailPathFor(assetId: string): string {
  return `proxy/thumbs/${assetId}.jpg`;
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
