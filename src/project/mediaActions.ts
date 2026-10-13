/**
 * Media workflows shared by the media panel, the setup wizard, drag-and-drop and the command
 * palette: import (dialog or drop), relink, and "use as BGM".
 */
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { create } from "zustand";
import { mediaImport, mediaImportDropped, mediaRelinkFile, mediaRelinkFolder } from "../lib/ipc";
import { newJobId } from "../lib/jobs";
import { notify } from "../lib/notices";
import { DropSummarySchema, FILES_DROPPED_EVENT, type ImportOutcome, type MediaAsset, type RelinkCandidate } from "../types";
import { addAssets, addBgmTrack, relinkAssets } from "./commands";
import { useEditor } from "./editor";
import { assetFromProbe, fileNameOf } from "./manifest";
import { openDroppedProject, refreshMissingAssets, useSessionUi } from "./session";
import { useProjectStore } from "./store";
import { useWorkspace } from "./workspace";

interface MediaJobStore {
  /** Running import/relink job, for progress text; null when idle. */
  readonly running: { readonly kind: "import" | "relink"; readonly jobId: string } | null;
  /** Relink candidate whose duration differs; the media panel asks before applying it. */
  readonly mismatch: RelinkCandidate | null;
}

export const useMediaJobs = create<MediaJobStore>()(() => ({ running: null, mismatch: null }));

/** Files from the OS are being dragged over the window (drives the drop overlay). */
export const useFileDragOver = create<{ readonly over: boolean }>()(() => ({ over: false }));

function applyImport(outcomes: ReadonlyArray<ImportOutcome>): ReadonlyArray<MediaAsset> {
  const imported = outcomes.flatMap((o) => (o.status === "imported" ? [assetFromProbe(o.media)] : []));
  for (const failure of outcomes) {
    if (failure.status === "failed") notify("error", `${failure.fileName}: ${failure.message}`);
  }
  if (imported.length > 0) {
    useProjectStore.getState().execute(addAssets(imported));
    notify("success", `${imported.length} media diimpor.`);
  }
  return imported;
}

/** Imports from a native dialog or from the last drop; returns the new assets. */
export async function importMedia(source: "dialog" | "drop"): Promise<ReadonlyArray<MediaAsset>> {
  const project = useProjectStore.getState().project;
  if (!project || project.readOnly || useMediaJobs.getState().running) return [];
  const jobId = newJobId();
  useMediaJobs.setState({ running: { kind: "import", jobId } });
  const result = source === "dialog" ? await mediaImport(jobId) : await mediaImportDropped(jobId);
  useMediaJobs.setState({ running: null });
  if (!result.ok) {
    notify("error", result.error.message);
    return [];
  }
  if (source === "drop" && result.value.length === 0) notify("info", "Tidak ada file media yang didukung di antara file yang diseret.");
  return applyImport(result.value);
}

async function applyRelink(candidates: ReadonlyArray<RelinkCandidate>): Promise<void> {
  const current = useProjectStore.getState().project?.manifest;
  if (!current || candidates.length === 0) return;
  useProjectStore.getState().execute(relinkAssets(current, candidates.map((c) => assetFromProbe(c.media))));
  await refreshMissingAssets();
}

export async function relinkMissingFromFolder(): Promise<void> {
  const project = useProjectStore.getState().project;
  if (!project || useMediaJobs.getState().running) return;
  const missingIds = useSessionUi.getState().missingAssetIds;
  const missing = project.manifest.assets.filter((a) => missingIds.has(a.id));
  if (missing.length === 0) return;
  const jobId = newJobId();
  useMediaJobs.setState({ running: { kind: "relink", jobId } });
  const result = await mediaRelinkFolder(
    jobId,
    missing.map((a) => ({ id: a.id, fileName: fileNameOf(a.filePath), durationMs: a.durationMs ?? null })),
  );
  useMediaJobs.setState({ running: null });
  if (!result.ok) return notify("error", result.error.message);
  const accepted = result.value.filter((c) => c.durationMatches);
  const rejected = result.value.length - accepted.length;
  await applyRelink(accepted);
  const stillMissing = missing.length - accepted.length;
  notify(
    stillMissing === 0 ? "success" : "warning",
    `${accepted.length} file terhubung ulang.${rejected > 0 ? ` ${rejected} file bernama sama dilewati karena durasinya berbeda.` : ""}${
      stillMissing > 0 ? ` ${stillMissing} file masih hilang.` : ""
    }`,
  );
}

export async function relinkAsset(asset: MediaAsset): Promise<void> {
  const result = await mediaRelinkFile(asset.id, asset.durationMs ?? null);
  if (!result.ok) return notify("error", result.error.message);
  if (!result.value) return;
  if (result.value.durationMatches) await applyRelink([result.value]);
  else useMediaJobs.setState({ mismatch: result.value });
}

/** Answer to the duration-mismatch question. */
export async function resolveMismatch(accept: boolean): Promise<void> {
  const candidate = useMediaJobs.getState().mismatch;
  useMediaJobs.setState({ mismatch: null });
  if (accept && candidate) await applyRelink([candidate]);
}

/** Adds an imported audio asset to the BGM track at the playhead. */
export function addAsBgm(asset: MediaAsset): void {
  if (asset.kind !== "audio" || asset.durationMs === undefined) return;
  const command = addBgmTrack(asset, useEditor.getState().playheadMs, fileNameOf(asset.filePath));
  useProjectStore.getState().execute(command);
  notify("success", `${fileNameOf(asset.filePath)} ditambahkan sebagai musik latar di posisi playhead.`);
}

/**
 * Mount once (App): files dropped on the window. Without a project a dropped .smbproj opens;
 * with one, media files are imported. The paths themselves never leave Rust.
 */
export function useFileDrop(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    listen(FILES_DROPPED_EVENT, (event) => {
      if (!active || !DropSummarySchema.safeParse(event.payload).success) return;
      const project = useProjectStore.getState().project;
      if (!project) {
        void openDroppedProject();
        return;
      }
      useWorkspace.getState().setLeftTab("media");
      void importMedia("drop");
    })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch((error: Error) => console.warn("drop listener failed", error.message));
    // Only the drag state is read here; dropped paths stay in Rust (see FILES_DROPPED_EVENT).
    let unlistenHover: (() => void) | null = null;
    getCurrentWebview()
      .onDragDropEvent((event) => useFileDragOver.setState({ over: event.payload.type === "enter" || event.payload.type === "over" }))
      .then((stop) => {
        if (active) unlistenHover = stop;
        else stop();
      })
      .catch((error: Error) => console.warn("drag state listener failed", error.message));
    return () => {
      active = false;
      unlisten?.();
      unlistenHover?.();
    };
  }, []);
}
