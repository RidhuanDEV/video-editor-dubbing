/**
 * Project session workflows that cross the IPC boundary: create/open (with crash recovery),
 * save, autosave, close, and missing-media detection. Components call these; they never
 * talk to IPC for project data directly.
 */
import { useEffect } from "react";
import { create } from "zustand";
import {
  mediaCheckPaths,
  projectAutosave,
  projectClose,
  projectCreate,
  projectDiscardRecovery,
  projectOpen,
  projectOpenDropped,
  projectOpenRecent,
  projectSave,
} from "../lib/ipc";
import { notify } from "../lib/notices";
import type { AspectRatio, OpenedProject, ProjectManifest } from "../types";
import { CANVAS_SIZE } from "./commands";
import { createManifest, loadManifest, serializeManifest } from "./manifest";
import { isDirty, useProjectStore } from "./store";
import { resetWorkspace } from "./workspace";

export const AUTOSAVE_INTERVAL_MS = 30_000;

/** UI-only session state: never written to the manifest. */
interface SessionUiStore {
  readonly missingAssetIds: ReadonlySet<string>;
  /** Manifest found in autosave, waiting for the user to restore or discard it. */
  readonly pendingRecovery: ProjectManifest | null;
  readonly busy: boolean;
  readonly setMissing: (ids: ReadonlySet<string>) => void;
  readonly setPendingRecovery: (manifest: ProjectManifest | null) => void;
  readonly setBusy: (busy: boolean) => void;
}

export const useSessionUi = create<SessionUiStore>()((set) => ({
  missingAssetIds: new Set(),
  pendingRecovery: null,
  busy: false,
  setMissing: (missingAssetIds) => set({ missingAssetIds }),
  setPendingRecovery: (pendingRecovery) => set({ pendingRecovery }),
  setBusy: (busy) => set({ busy }),
}));

export async function refreshMissingAssets(): Promise<void> {
  const project = useProjectStore.getState().project;
  if (!project) return;
  const assets = project.manifest.assets;
  const result = await mediaCheckPaths(assets.map((a) => a.filePath));
  if (!result.ok) {
    notify("error", `Gagal memeriksa file media: ${result.error.message}`);
    return;
  }
  useSessionUi.getState().setMissing(new Set(assets.filter((_, i) => result.value[i] === false).map((a) => a.id)));
}

async function adoptOpened(opened: OpenedProject, title: string, aspectRatio: AspectRatio = "16:9"): Promise<void> {
  const store = useProjectStore.getState();
  if (opened.manifestJson === null) {
    // Fresh folder: write the initial manifest right away so the folder is a valid project.
    const base = createManifest(title);
    const manifest = { ...base, canvas: { ...base.canvas, aspectRatio, ...CANVAS_SIZE[aspectRatio] } };
    store.open({ root: opened.root, manifest, readOnly: false });
    await saveProject();
    return;
  }
  const loaded = loadManifest(opened.manifestJson);
  if (!loaded.ok) {
    await projectClose();
    notify("error", loaded.message);
    return;
  }
  store.open({ root: opened.root, manifest: loaded.manifest, readOnly: loaded.readOnly });
  if (loaded.readOnly) {
    notify("warning", "Proyek dibuat oleh versi aplikasi yang lebih baru. Dibuka dalam mode baca saja.");
  }
  if (opened.recoveryJson !== null) {
    const recovery = loadManifest(opened.recoveryJson);
    if (recovery.ok && !recovery.readOnly) useSessionUi.getState().setPendingRecovery(recovery.manifest);
  }
  await refreshMissingAssets();
}

/** Runs one open/create at a time; resolves true when a project ended up open. */
async function withBusy(task: () => Promise<void>): Promise<boolean> {
  const ui = useSessionUi.getState();
  if (ui.busy) return false;
  ui.setBusy(true);
  try {
    await task();
  } finally {
    useSessionUi.getState().setBusy(false);
  }
  return useProjectStore.getState().project !== null;
}

export function createProject(title: string, aspectRatio: AspectRatio): Promise<boolean> {
  return withBusy(async () => {
    const result = await projectCreate(title);
    if (!result.ok) return notify("error", result.error.message);
    if (result.value) await adoptOpened(result.value, title, aspectRatio);
  });
}

export function openProject(): Promise<boolean> {
  return withBusy(async () => {
    const result = await projectOpen();
    if (!result.ok) return notify("error", result.error.message);
    if (result.value) await adoptOpened(result.value, "");
  });
}

export function openRecentProject(path: string): Promise<boolean> {
  return withBusy(async () => {
    const result = await projectOpenRecent(path);
    if (!result.ok) return notify("error", result.error.message);
    await adoptOpened(result.value, "");
  });
}

/** Opens a `.smbproj` folder dropped on the window; false when the drop held none. */
export function openDroppedProject(): Promise<boolean> {
  return withBusy(async () => {
    const result = await projectOpenDropped();
    if (!result.ok) return notify("error", result.error.message);
    if (result.value) await adoptOpened(result.value, "");
    else notify("info", "Seret folder proyek (.smbproj) untuk membukanya, atau buat proyek dulu untuk mengimpor media.");
  });
}

/** Returns true when the manifest is safely on disk. */
export async function saveProject(): Promise<boolean> {
  const { project, revision } = useProjectStore.getState();
  if (!project || project.readOnly) return false;
  const updatedAt = new Date().toISOString();
  const result = await projectSave(serializeManifest({ ...project.manifest, updatedAt }));
  if (!result.ok) {
    notify("error", `Proyek gagal disimpan: ${result.error.message}`);
    return false;
  }
  useProjectStore.getState().markSaved(revision, updatedAt);
  return true;
}

export async function closeProject(): Promise<void> {
  await projectClose();
  useProjectStore.getState().close();
  useSessionUi.setState({ missingAssetIds: new Set(), pendingRecovery: null });
  resetWorkspace();
}

export async function resolveRecovery(restore: boolean): Promise<void> {
  const ui = useSessionUi.getState();
  const recovered = ui.pendingRecovery;
  const project = useProjectStore.getState().project;
  ui.setPendingRecovery(null);
  if (!recovered || !project) return;
  if (restore) {
    // Restored edits are unsaved until the user saves; the autosave stays as a safety net.
    useProjectStore.getState().open({ ...project, manifest: recovered }, { dirty: true });
    await refreshMissingAssets();
  } else {
    const result = await projectDiscardRecovery();
    if (!result.ok) notify("error", result.error.message);
  }
}

/** Writes an autosave every 30 s while there are unsaved changes (F-OPS-1). */
export function useAutosave(): void {
  useEffect(() => {
    let lastAutosaved = -1;
    const timer = window.setInterval(() => {
      const state = useProjectStore.getState();
      if (!state.project || state.project.readOnly || !isDirty(state) || state.revision === lastAutosaved) return;
      const revision = state.revision;
      void projectAutosave(serializeManifest(state.project.manifest)).then((result) => {
        if (result.ok) lastAutosaved = revision;
        else notify("error", `Autosave gagal: ${result.error.message}`);
      });
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
}
