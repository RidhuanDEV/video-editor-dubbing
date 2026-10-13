/** Loads WordBoundary data for synthesized scenes (once per audio) and derives subtitle cues. */
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { ttsWordBoundaries } from "../lib/ipc";
import type { WordBoundary } from "../types";
import { useProjectStore } from "./store";
import { buildCues, type Cue } from "./subtitles";
import type { TimelineLayout } from "./timeline";

interface BoundaryCache {
  readonly root: string | null;
  readonly bySha: ReadonlyMap<string, ReadonlyArray<WordBoundary>>;
  /** Requested shas, including ones the cache did not have (no retry loop). */
  readonly requested: ReadonlySet<string>;
}

const useBoundaryCache = create<BoundaryCache>()(() => ({ root: null, bySha: new Map(), requested: new Set() }));

export function useCues(layout: TimelineLayout): ReadonlyArray<Cue> {
  const root = useProjectStore((s) => s.project?.root ?? null);
  const settings = useProjectStore((s) => s.project?.manifest.subtitleSettings);
  const bySha = useBoundaryCache((s) => s.bySha);

  useEffect(() => {
    if (useBoundaryCache.getState().root !== root) useBoundaryCache.setState({ root, bySha: new Map(), requested: new Set() });
    const { requested } = useBoundaryCache.getState();
    const missing = [...new Set(layout.segments.flatMap((s) => (s.scene.audioSha256 ? [s.scene.audioSha256] : [])))].filter((sha) => !requested.has(sha));
    if (root === null || missing.length === 0) return;
    useBoundaryCache.setState({ requested: new Set([...requested, ...missing]) });
    void ttsWordBoundaries(missing).then((result) => {
      if (!result.ok || useBoundaryCache.getState().root !== root) return;
      useBoundaryCache.setState((state) => ({ bySha: new Map([...state.bySha, ...Object.entries(result.value)]) }));
    });
  }, [layout, root]);

  return useMemo(() => (settings ? buildCues(layout, bySha, settings) : []), [layout, bySha, settings]);
}
