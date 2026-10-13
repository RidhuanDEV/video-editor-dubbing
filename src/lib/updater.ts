/**
 * Signed auto-update (ADR D6): checks GitHub Releases once at startup in production builds.
 * Updates are verified by the Tauri updater against the public key in tauri.conf.json.
 */
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect } from "react";
import { create } from "zustand";
import { notify } from "./notices";

interface UpdaterStore {
  readonly available: { readonly version: string; readonly notes: string } | null;
  /** 0–100 while downloading, null otherwise. */
  readonly progress: number | null;
}

export const useUpdater = create<UpdaterStore>()(() => ({ available: null, progress: null }));

/** Kept outside the store: it is a backend resource handle, not UI state. */
let pending: Update | null = null;

/** Returns true when an update was found (the update dialog then opens). */
export async function checkForUpdates(): Promise<boolean> {
  const update = await check();
  if (!update) return false;
  pending = update;
  useUpdater.setState({ available: { version: update.version, notes: update.body ?? "" } });
  return true;
}

/** Once at startup in production builds. */
export function useUpdateCheck(): void {
  useEffect(() => {
    if (!isTauri() || !import.meta.env.PROD) return;
    // Offline or no published release yet: not worth interrupting the user.
    checkForUpdates().catch((error: Error) => console.warn("update check failed", error.message));
  }, []);
}

export function dismissUpdate(): void {
  useUpdater.setState({ available: null });
}

/** Downloads, installs and restarts. The caller saves the project first. */
export async function installUpdate(): Promise<void> {
  const update = pending;
  if (!update) return;
  let total = 0;
  let received = 0;
  try {
    useUpdater.setState({ progress: 0 });
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      if (event.event === "Progress") {
        received += event.data.chunkLength;
        if (total > 0) useUpdater.setState({ progress: Math.min(100, Math.round((received / total) * 100)) });
      }
    });
    await relaunch();
  } catch (error) {
    useUpdater.setState({ progress: null });
    notify("error", `Pembaruan gagal: ${error instanceof Error ? error.message : String(error)}`);
  }
}
