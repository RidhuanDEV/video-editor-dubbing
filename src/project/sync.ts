/** Scene audio/video alignment (04 §1): durations and the status shown on scene cards. */
import type { ScriptScene } from "../types";

/** Within this difference narration and clip count as in sync (04 §1.2). */
export const SYNC_TOLERANCE_MS = 100;

export type SceneSync =
  | { readonly kind: "pending" }
  | { readonly kind: "synced" }
  | { readonly kind: "freeze"; readonly padMs: number }
  | { readonly kind: "videoLonger"; readonly extraMs: number }
  | { readonly kind: "audioCut"; readonly overMs: number };

export function clipDurationMs(scene: ScriptScene): number {
  return Math.round((scene.videoTrimEndMs - scene.videoTrimStartMs) / scene.playbackRate);
}

export function sceneSync(scene: ScriptScene): SceneSync {
  if (scene.audioDurationMs === undefined) return { kind: "pending" };
  const clipMs = clipDurationMs(scene);
  const diff = scene.audioDurationMs - clipMs;
  if (Math.abs(diff) <= SYNC_TOLERANCE_MS) return { kind: "synced" };
  if (diff > 0) {
    // natural-pause never pads the video, so the extra narration runs into the next scene.
    return scene.alignmentMode === "natural-pause" ? { kind: "audioCut", overMs: diff } : { kind: "freeze", padMs: diff };
  }
  return { kind: "videoLonger", extraMs: -diff };
}

/** Scene length on the timeline including the breathing gap (04 §1.1 table). */
export function sceneDurationMs(scene: ScriptScene, gapMs: number): number {
  const clipMs = clipDurationMs(scene);
  const audioMs = scene.audioDurationMs ?? 0;
  switch (scene.alignmentMode) {
    case "freeze-frame":
    case "natural-pause":
      return Math.max(clipMs, audioMs) + gapMs;
    case "ripple-cut":
      return (audioMs > 0 ? audioMs : clipMs) + gapMs;
  }
}

/** Rough narration length before synthesis (~12 characters per second measured on id-ID voices). */
export function estimateNarrationMs(text: string): number {
  return Math.round((text.trim().length / 12) * 1000);
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} dtk`;
}
