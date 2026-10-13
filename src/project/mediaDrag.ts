/**
 * Dragging a media item onto the script or the timeline (PRD 10 §8 Fase D). Pointer-based:
 * HTML5 drag-and-drop inside the WebView conflicts with Tauri's native file drop on Windows.
 *
 * Drop targets are elements with `data-drop`:
 *   `scene:<id>`  → a video replaces that scene's clip
 *   `scenes`      → a video becomes a new scene at the end
 *   `bgm-lane`    → an audio file becomes BGM at the dropped time (needs `data-px-per-ms`)
 */
import { create } from "zustand";
import { notify } from "../lib/notices";
import type { MediaAsset } from "../types";
import { addBgmTrack, buildScenes, insertScenes, updateScene } from "./commands";
import { useEditor } from "./editor";
import { fileNameOf } from "./manifest";
import { useProjectStore } from "./store";

const DRAG_THRESHOLD_PX = 4;

interface MediaDragStore {
  readonly asset: MediaAsset | null;
  readonly x: number;
  readonly y: number;
  /** `data-drop` value under the pointer that accepts the dragged asset, for highlighting. */
  readonly target: string | null;
}

export const useMediaDrag = create<MediaDragStore>()(() => ({ asset: null, x: 0, y: 0, target: null }));

/** Whether `target` (a `data-drop` value) accepts an asset of this kind. */
export function accepts(target: string, asset: MediaAsset): boolean {
  if (target.startsWith("scene:") || target === "scenes") return asset.kind === "video";
  if (target === "bgm-lane") return asset.kind === "audio" && asset.durationMs !== undefined;
  return false;
}

function dropElementAt(x: number, y: number): HTMLElement | null {
  const hit = document.elementFromPoint(x, y);
  return hit instanceof HTMLElement ? hit.closest<HTMLElement>("[data-drop]") : null;
}

function applyDrop(asset: MediaAsset, element: HTMLElement, x: number): void {
  const store = useProjectStore.getState();
  const manifest = store.project?.manifest;
  const target = element.dataset.drop ?? "";
  if (!manifest || store.project?.readOnly || !accepts(target, asset)) return;
  const name = fileNameOf(asset.filePath);
  if (target.startsWith("scene:")) {
    const sceneId = target.slice("scene:".length);
    store.execute(updateScene(manifest, sceneId, { videoClipId: asset.id, videoTrimStartMs: 0, videoTrimEndMs: Math.max(1, asset.durationMs ?? 1) }));
    useEditor.getState().select({ type: "scene", id: sceneId });
    notify("success", `Scene sekarang memakai ${name}.`);
  } else if (target === "scenes") {
    const scenes = buildScenes(asset, [""], () => `Scene ${manifest.scenes.length + 1}`);
    store.execute(insertScenes(manifest, scenes));
    const first = scenes[0];
    if (first) useEditor.getState().select({ type: "scene", id: first.id });
  } else {
    const pxPerMs = Number(element.dataset.pxPerMs);
    const startMs = Number.isFinite(pxPerMs) && pxPerMs > 0 ? Math.max(0, Math.round((x - element.getBoundingClientRect().left) / pxPerMs)) : useEditor.getState().playheadMs;
    store.execute(addBgmTrack(asset, startMs, name));
    notify("success", `${name} ditambahkan sebagai musik latar.`);
  }
}

/** Starts tracking a possible drag from a media item (left button). Click without moving does nothing. */
export function beginMediaDrag(asset: MediaAsset, startX: number, startY: number): void {
  let dragging = false;
  const move = (event: PointerEvent): void => {
    if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD_PX) return;
    dragging = true;
    const element = dropElementAt(event.clientX, event.clientY);
    const target = element?.dataset.drop ?? null;
    useMediaDrag.setState({ asset, x: event.clientX, y: event.clientY, target: target !== null && accepts(target, asset) ? target : null });
  };
  const end = (event: PointerEvent | KeyboardEvent): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("keydown", cancelOnEscape);
    useMediaDrag.setState({ asset: null, target: null });
    if (!dragging || !(event instanceof PointerEvent)) return;
    const element = dropElementAt(event.clientX, event.clientY);
    if (element) applyDrop(asset, element, event.clientX);
  };
  const cancelOnEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape") end(event);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("keydown", cancelOnEscape);
}
