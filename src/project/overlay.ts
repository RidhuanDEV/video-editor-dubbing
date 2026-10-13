/**
 * Export overlay ASS (Phase 5): everything drawn in screen space on top of the video.
 * - Layer 0: spotlight dimming (four rectangles around the focus area, 04 §4.1).
 * - Layer 1: step badges (04 §4.4), fixed colours so the export ignores the UI theme.
 * - Layer 2: subtitles (optional; burn-in can be turned off).
 * Zoom and blur are FFmpeg filters (Rust); this mirrors the preview's EffectLayers.
 */
import type { BadgeCalloutEffect, ProjectManifest, ZoomEffect } from "../types";
import { CALLOUT_COLORS, contentRect, EASE_MS, SPOTLIGHT_DIM, zoomViewport } from "./effects";
import { assColor, assHeader, assText, assTime, subtitleEvents, subtitleStyle, type Cue } from "./subtitles";
import type { TimelineLayout } from "./timeline";

const BADGE_FONT_PX = 36;

/** Canvas-pixel anchor and ASS alignment per badge position (matches the preview's CSS). */
function badgeAnchor(position: BadgeCalloutEffect["position"], w: number, h: number): string {
  const left = Math.round(w * 0.04);
  const right = Math.round(w * 0.96);
  const top = Math.round(h * 0.06);
  const bottom = Math.round(h * 0.84);
  switch (position) {
    case "top-left":
      return `\\an7\\pos(${left},${top})`;
    case "top-right":
      return `\\an9\\pos(${right},${top})`;
    case "bottom-left":
      return `\\an1\\pos(${left},${bottom})`;
    case "bottom-right":
      return `\\an3\\pos(${right},${bottom})`;
  }
}

function fade(durationMs: number): string {
  const ramp = Math.round(Math.min(EASE_MS, durationMs / 3));
  return `\\fad(${ramp},${ramp})`;
}

/** Four rectangles covering the frame minus the focus box (no even-odd fill needed). */
function spotlightDrawing(focus: { x: number; y: number; w: number; h: number }, width: number, height: number): string {
  const x1 = Math.round(focus.x * width);
  const y1 = Math.round(focus.y * height);
  const x2 = Math.round((focus.x + focus.w) * width);
  const y2 = Math.round((focus.y + focus.h) * height);
  const rect = (ax: number, ay: number, bx: number, by: number): string => `m ${ax} ${ay} l ${bx} ${ay} ${bx} ${by} ${ax} ${by}`;
  return [rect(0, 0, width, y1), rect(0, y2, width, height), rect(0, y1, x1, y2), rect(x2, y1, width, y2)].join(" ");
}

export function buildOverlayAss(manifest: ProjectManifest, layout: TimelineLayout, subtitles: ReadonlyArray<Cue> | null): string | null {
  const { width, height } = manifest.canvas;
  const events: string[] = [];
  const dimAlpha = Math.round((1 - SPOTLIGHT_DIM) * 255).toString(16).padStart(2, "0").toUpperCase();

  for (const segment of layout.segments) {
    const asset = manifest.assets.find((a) => a.id === segment.scene.videoClipId);
    const content = contentRect(manifest.canvas, asset?.width ?? width, asset?.height ?? height, manifest.canvas.fit);
    for (const effect of segment.scene.effects) {
      const start = assTime(segment.startMs + effect.startOffsetMs);
      const end = assTime(segment.startMs + effect.startOffsetMs + effect.durationMs);
      if (effect.type === "zoom" && effect.spotlightMask) {
        const focus = spotlightFocus(effect, content);
        events.push(
          `Dialogue: 0,${start},${end},Spot,,0,0,0,,{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H000000&\\1a&H${dimAlpha}&${fade(effect.durationMs)}\\p1}${spotlightDrawing(focus, width, height)}{\\p0}`,
        );
      } else if (effect.type === "callout") {
        events.push(`Dialogue: 1,${start},${end},Badge,,0,0,0,,{${badgeAnchor(effect.position, width, height)}${fade(effect.durationMs)}}${assText(effect.label)}`);
      }
    }
  }
  if (subtitles) events.push(...subtitleEvents(subtitles, manifest.subtitleSettings, 2));
  if (events.length === 0) return null;

  const badgeBack = assColor(CALLOUT_COLORS.background);
  const badgeText = assColor(CALLOUT_COLORS.text);
  const styles = [
    subtitleStyle(manifest.subtitleSettings, manifest.canvas),
    `Style: Badge,${manifest.subtitleSettings.fontName},${BADGE_FONT_PX},${badgeText},${badgeText},&HFF000000,${badgeBack},1,0,0,0,100,100,0,0,4,12,0,7,0,0,0,1`,
    "Style: Spot,Arial,10,&H00000000,&H00000000,&HFF000000,&HFF000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
  ];
  return `${[...assHeader(manifest.canvas, styles), ...events].join("\n")}\n`;
}

/** Spotlight focus in canvas-normalized coordinates (same math as the preview). */
function spotlightFocus(effect: ZoomEffect, content: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const view = zoomViewport(effect.target, effect.scale);
  return { x: content.x + view.x * content.w, y: content.y + view.y * content.h, w: view.w * content.w, h: view.h * content.h };
}
