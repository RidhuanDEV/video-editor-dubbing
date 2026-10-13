/**
 * Project readiness (PRD 10 §4.4): one source of truth for "what is the next step" in the
 * script panel, the status bar and the export dialog. Pure, so it is unit-tested.
 */
import type { ProjectManifest } from "../types";

export type ReadinessId = "media" | "scenes" | "clips" | "narration" | "voice";

/** What the UI offers to fix an item; the UI maps each to a button. */
export type ReadinessAction = "importMedia" | "addScript" | "relink" | "selectEmptyScene" | "synthesize";

export interface ReadinessItem {
  readonly id: ReadinessId;
  readonly ok: boolean;
  /** Blocking items prevent export; the rest only lower quality (e.g. silent scenes). */
  readonly blocking: boolean;
  readonly label: string;
  readonly action: ReadinessAction;
  readonly actionLabel: string;
}

export interface Readiness {
  readonly items: ReadonlyArray<ReadinessItem>;
  readonly done: number;
  readonly total: number;
  /** The first unfinished item, in workflow order. */
  readonly next: ReadinessItem | null;
  readonly canExport: boolean;
}

export function projectReadiness(manifest: ProjectManifest, missingAssetIds: ReadonlySet<string>): Readiness {
  const videos = manifest.assets.filter((a) => a.kind === "video");
  const assetIds = new Set(manifest.assets.map((a) => a.id));
  const scenes = manifest.scenes;
  const brokenClips = scenes.filter((s) => !assetIds.has(s.videoClipId) || missingAssetIds.has(s.videoClipId)).length;
  const empty = scenes.filter((s) => s.narration.trim() === "").length;
  const unsynthesized = scenes.filter((s) => s.narration.trim() !== "" && s.audioDurationMs === undefined).length;

  const items: ReadonlyArray<ReadinessItem> = [
    {
      id: "media",
      ok: videos.length > 0,
      blocking: true,
      label: videos.length > 0 ? `${videos.length} rekaman video diimpor` : "Impor rekaman layar (video)",
      action: "importMedia",
      actionLabel: "Impor video",
    },
    {
      id: "scenes",
      ok: scenes.length > 0,
      blocking: true,
      label: scenes.length > 0 ? `${scenes.length} scene` : "Tulis atau tempel naskah",
      action: "addScript",
      actionLabel: "Tempel naskah",
    },
    {
      id: "clips",
      ok: brokenClips === 0,
      blocking: true,
      label: brokenClips === 0 ? "Semua klip ditemukan" : `${brokenClips} scene memakai file yang hilang`,
      action: "relink",
      actionLabel: "Hubungkan ulang",
    },
    {
      id: "narration",
      ok: empty === 0,
      blocking: false,
      label: empty === 0 ? "Semua scene punya narasi" : `${empty} scene belum punya narasi`,
      action: "selectEmptyScene",
      actionLabel: "Isi narasi",
    },
    {
      id: "voice",
      ok: unsynthesized === 0,
      blocking: false,
      label: unsynthesized === 0 ? "Semua narasi sudah bersuara" : `${unsynthesized} scene belum disintesis`,
      action: "synthesize",
      actionLabel: `Sintesis ${unsynthesized} scene`,
    },
  ];
  // "All clips found" and "all narrated" mean nothing before there are scenes.
  const relevant = scenes.length === 0 ? items.slice(0, 2) : items;
  const done = relevant.filter((i) => i.ok).length;
  return {
    items: relevant,
    done,
    total: relevant.length,
    next: relevant.find((i) => !i.ok) ?? null,
    canExport: relevant.every((i) => i.ok || !i.blocking),
  };
}
