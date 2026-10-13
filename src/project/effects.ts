/**
 * Effect geometry and timing (04 §4), shared by the preview and (Phase 5) the filter generator.
 * - Zoom: eases in/out over ~300 ms, holds the peak. The viewport is 1/scale of the frame,
 *   centred on `target` and clamped inside the frame.
 * - Spotlight (`spotlightMask`): no zoom; the same viewport stays bright, the rest is dimmed.
 * - Blur: `rect` in source-video pixels (04 §4.3).
 */
import type { BadgeCalloutEffect, BlurEffect, CanvasSettings, FitMode, SceneEffect, ZoomEffect } from "../types";
import type { SceneSegment } from "./timeline";

export const EASE_MS = 300;
export const DEFAULT_EFFECT_MS = 2000;
export const SPOTLIGHT_DIM = 0.6;

export interface NormRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Effects of a scene that cover `offsetMs` (scene-relative). */
export function activeEffects(effects: ReadonlyArray<SceneEffect>, offsetMs: number): ReadonlyArray<SceneEffect> {
  return effects.filter((e) => offsetMs >= e.startOffsetMs && offsetMs < e.startOffsetMs + e.durationMs);
}

function smoothstep(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}

/** 0 → 1 → 0 envelope over the effect, ramping for `EASE_MS` (or a third of short effects). */
export function easeEnvelope(effect: { readonly durationMs: number }, elapsedMs: number): number {
  const ramp = Math.min(EASE_MS, effect.durationMs / 3);
  if (ramp <= 0) return 1;
  return Math.min(smoothstep(elapsedMs / ramp), smoothstep((effect.durationMs - elapsedMs) / ramp));
}

/** Scale at a moment: 1 at the edges, `effect.scale` at the plateau. */
export function zoomScaleAt(effect: ZoomEffect, elapsedMs: number): number {
  return 1 + (effect.scale - 1) * easeEnvelope(effect, elapsedMs);
}

/** Visible part of the frame (normalized) for a zoom of `scale` around `target`. */
export function zoomViewport(target: { readonly x: number; readonly y: number }, scale: number): NormRect {
  const size = 1 / Math.max(scale, 1);
  const clamp = (center: number): number => Math.min(Math.max(center - size / 2, 0), 1 - size);
  return { x: clamp(target.x), y: clamp(target.y), w: size, h: size };
}

/** Where the source frame lands inside the canvas (normalized to the canvas box). */
export function contentRect(canvas: Pick<CanvasSettings, "width" | "height">, sourceW: number, sourceH: number, fit: FitMode): NormRect {
  if (fit === "fill" || sourceW <= 0 || sourceH <= 0) return { x: 0, y: 0, w: 1, h: 1 };
  const canvasAspect = canvas.width / canvas.height;
  const sourceAspect = sourceW / sourceH;
  const wider = sourceAspect > canvasAspect;
  // contain: the limiting side fits; cover: the other side fits (overflowing, clipped).
  const fitWidth = fit === "contain" ? wider : !wider;
  const w = fitWidth ? 1 : sourceAspect / canvasAspect;
  const h = fitWidth ? canvasAspect / sourceAspect : 1;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** Blur rect (source px) → normalized source rect, clamped to the frame. */
export function blurRectNorm(effect: BlurEffect, sourceW: number, sourceH: number): NormRect {
  const x = Math.min(effect.rect.x / sourceW, 1);
  const y = Math.min(effect.rect.y / sourceH, 1);
  return { x, y, w: Math.min(effect.rect.width / sourceW, 1 - x), h: Math.min(effect.rect.height / sourceH, 1 - y) };
}

/** Rectangle drawn on the frame (normalized) → zoom target/scale. */
export function zoomFromRect(rect: NormRect): Pick<ZoomEffect, "target" | "scale"> {
  const scale = Math.min(Math.max(1 / Math.max(rect.w, rect.h, 0.125), 1.1), 8);
  return { target: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, scale: Math.round(scale * 100) / 100 };
}

/** New effect timing at the playhead, kept inside the scene's moving video. */
export function effectTimingAt(segment: SceneSegment, playheadMs: number): { readonly startOffsetMs: number; readonly durationMs: number } | null {
  const span = segment.endMs - segment.startMs;
  const start = Math.round(Math.min(Math.max(playheadMs - segment.startMs, 0), span - 100));
  if (start < 0) return null;
  return { startOffsetMs: start, durationMs: Math.max(100, Math.min(DEFAULT_EFFECT_MS, span - start)) };
}

export function calloutPositionFor(point: { readonly x: number; readonly y: number }): BadgeCalloutEffect["position"] {
  return `${point.y < 0.5 ? "top" : "bottom"}-${point.x < 0.5 ? "left" : "right"}`;
}

export const EFFECT_LABEL: Readonly<Record<SceneEffect["type"], string>> = { zoom: "Zoom", blur: "Blur", callout: "Badge" };

/**
 * Callout colours are part of the rendered video, so they are fixed (not UI-theme tokens):
 * the export must look the same in Dark and Light (08 §4). tosca-700 + white passes AA.
 */
export const CALLOUT_COLORS: { readonly background: string; readonly text: string } = { background: "#0F766E", text: "#FFFFFF" };
