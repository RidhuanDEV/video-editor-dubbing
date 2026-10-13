/**
 * Background proxy queue (Phase 3 deliverable 1). Builds one proxy at a time for every video and
 * audio asset without a usable proxy; results attach to the manifest without an undo step.
 */
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { create } from "zustand";
import { mediaBuildProxy } from "../lib/ipc";
import { newJobId } from "../lib/jobs";
import { JOB_EVENT, JobEventSchema, type MediaAsset } from "../types";
import { useSessionUi } from "./session";
import { useProjectStore } from "./store";

export type ProxyStatus =
  | { readonly state: "queued" }
  | { readonly state: "building"; readonly percent: number }
  | { readonly state: "error"; readonly message: string };

interface ProxyStore {
  readonly byAsset: ReadonlyMap<string, ProxyStatus>;
  /** Assets whose proxy file turned out unusable (e.g. deleted): rebuild despite `proxyPath`. */
  readonly stale: ReadonlySet<string>;
}

export const useProxies = create<ProxyStore>()(() => ({ byAsset: new Map(), stale: new Set() }));

function setStatus(assetId: string, status: ProxyStatus | null): void {
  useProxies.setState((state) => {
    const byAsset = new Map(state.byAsset);
    if (status === null) byAsset.delete(assetId);
    else byAsset.set(assetId, status);
    return { byAsset };
  });
}

/** Called by the preview when a proxy fails to load. */
export function requestProxyRebuild(assetId: string): void {
  const { stale, byAsset } = useProxies.getState();
  if (stale.has(assetId) || byAsset.get(assetId)?.state === "building") return;
  useProxies.setState({ stale: new Set([...stale, assetId]) });
  setStatus(assetId, null);
}

function needsProxy(asset: MediaAsset, missing: ReadonlySet<string>, store: ProxyStore): boolean {
  if (asset.kind === "image" || missing.has(asset.id)) return false;
  if (store.byAsset.has(asset.id)) return false; // queued, building, or failed (retry after reopen)
  return asset.proxyPath === undefined || store.stale.has(asset.id);
}

let running = false;
const jobToAsset = new Map<string, string>();

async function drainQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const project = useProjectStore.getState().project;
      if (!project || project.readOnly) return;
      const missing = useSessionUi.getState().missingAssetIds;
      const next = project.manifest.assets.find((a) => needsProxy(a, missing, useProxies.getState()));
      if (!next) return;

      const jobId = newJobId();
      jobToAsset.set(jobId, next.id);
      setStatus(next.id, { state: "building", percent: 0 });
      const result = await mediaBuildProxy(jobId, next.id, next.filePath, next.durationMs ?? null, next.kind === "audio" ? "audio" : "video");
      jobToAsset.delete(jobId);

      if (!result.ok) {
        setStatus(next.id, { state: "error", message: result.error.message });
        continue;
      }
      // Attach only if the same project is still open.
      if (useProjectStore.getState().project?.root === project.root) {
        useProjectStore.getState().setAssetProxy(next.id, result.value);
        useProxies.setState((state) => ({ stale: new Set([...state.stale].filter((id) => id !== next.id)) }));
      }
      setStatus(next.id, null);
    }
  } finally {
    running = false;
  }
}

/** Mount once (App): reacts to asset changes and forwards progress events. */
export function useProxyBuilder(): void {
  const assets = useProjectStore((s) => s.project?.manifest.assets);
  const missing = useSessionUi((s) => s.missingAssetIds);
  const stale = useProxies((s) => s.stale);
  const root = useProjectStore((s) => s.project?.root);

  useEffect(() => {
    useProxies.setState({ byAsset: new Map(), stale: new Set() });
  }, [root]);

  useEffect(() => {
    if (assets && isTauri()) void drainQueue();
  }, [assets, missing, stale]);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    listen(JOB_EVENT, (event) => {
      const parsed = JobEventSchema.safeParse(event.payload);
      if (!parsed.success || parsed.data.kind !== "mediaProxy" || parsed.data.status !== "progress") return;
      const assetId = jobToAsset.get(parsed.data.jobId);
      const percent = Number(parsed.data.message);
      if (assetId && Number.isFinite(percent)) setStatus(assetId, { state: "building", percent });
    })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch((error: Error) => console.warn("proxy progress listener failed", error.message));
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);
}
