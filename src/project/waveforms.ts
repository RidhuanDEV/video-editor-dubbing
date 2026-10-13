/**
 * Waveform peaks for the timeline (08 §8). Rust computes and caches them on disk; this store
 * keeps them in memory per audio path for the session and requests each path once.
 */
import { isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { create } from "zustand";
import { audioPeaks } from "../lib/ipc";

/** Must match `waveform::PEAKS_PER_SECOND` in Rust. */
export const PEAKS_PER_SECOND = 50;

type PeakState = { readonly state: "loading" } | { readonly state: "ready"; readonly peaks: ReadonlyArray<number> } | { readonly state: "error" };

export const useWaveforms = create<{ readonly byPath: ReadonlyMap<string, PeakState> }>()(() => ({ byPath: new Map() }));

function set(path: string, state: PeakState): void {
  useWaveforms.setState((s) => ({ byPath: new Map(s.byPath).set(path, state) }));
}

async function load(path: string): Promise<void> {
  set(path, { state: "loading" });
  const result = await audioPeaks(path);
  set(path, result.ok ? { state: "ready", peaks: result.value } : { state: "error" });
}

/** Peaks for `path` (project-relative narration or absolute BGM path), or null while unknown. */
export function useWaveform(path: string | undefined): ReadonlyArray<number> | null {
  const entry = useWaveforms((s) => (path === undefined ? undefined : s.byPath.get(path)));
  useEffect(() => {
    if (path !== undefined && entry === undefined && isTauri()) void load(path);
  }, [path, entry]);
  return entry?.state === "ready" ? entry.peaks : null;
}

/** Forget everything when another project opens (relative narration paths are per project). */
export function resetWaveforms(): void {
  useWaveforms.setState({ byPath: new Map() });
}

/**
 * Max peak per output column for a `[startS, startS + durationS)` window drawn `columns` wide.
 * Pure, so the timeline only maps numbers to bar heights.
 */
export function peakColumns(peaks: ReadonlyArray<number>, startS: number, durationS: number, columns: number): ReadonlyArray<number> {
  const out: number[] = [];
  if (columns <= 0 || durationS <= 0) return out;
  const perColumn = (durationS * PEAKS_PER_SECOND) / columns;
  const first = startS * PEAKS_PER_SECOND;
  for (let c = 0; c < columns; c += 1) {
    const from = Math.floor(first + c * perColumn);
    const to = Math.max(from + 1, Math.floor(first + (c + 1) * perColumn));
    let max = 0;
    for (let i = from; i < to && i < peaks.length; i += 1) max = Math.max(max, peaks[i] ?? 0);
    out.push(max / 255);
  }
  return out;
}
