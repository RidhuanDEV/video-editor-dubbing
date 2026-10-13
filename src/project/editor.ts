/** Edit-page UI state: playhead, transport, selection and zoom. Never written to the manifest. */
import { create } from "zustand";

export type Selection = { readonly type: "scene"; readonly id: string } | { readonly type: "bgm"; readonly id: string } | null;

export const MIN_PX_PER_SEC = 10;
export const MAX_PX_PER_SEC = 400;

interface EditorStore {
  readonly playheadMs: number;
  readonly playing: boolean;
  readonly selection: Selection;
  readonly pxPerSec: number;
  readonly seek: (ms: number, durationMs: number) => void;
  readonly setPlaying: (playing: boolean) => void;
  readonly select: (selection: Selection) => void;
  readonly setZoom: (pxPerSec: number) => void;
}

export const useEditor = create<EditorStore>()((set) => ({
  playheadMs: 0,
  playing: false,
  selection: null,
  pxPerSec: 60,
  seek: (ms, durationMs) => set({ playheadMs: Math.min(Math.max(0, ms), Math.max(0, durationMs)) }),
  setPlaying: (playing) => set({ playing }),
  select: (selection) => set({ selection }),
  setZoom: (pxPerSec) => set({ pxPerSec: Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, pxPerSec)) }),
}));

/** Resets transport and selection when another project opens. */
export function resetEditor(): void {
  useEditor.setState({ playheadMs: 0, playing: false, selection: null });
}
