import { describe, expect, it } from "vitest";
import type { BlurEffect, ZoomEffect } from "../types";
import { activeEffects, blurRectNorm, calloutPositionFor, contentRect, easeEnvelope, zoomFromRect, zoomScaleAt, zoomViewport } from "./effects";

const zoom: ZoomEffect = { id: "z", type: "zoom", startOffsetMs: 1000, durationMs: 2000, scale: 2, target: { x: 0.5, y: 0.5 }, spotlightMask: false };

describe("timing", () => {
  it("finds effects active at a scene offset", () => {
    expect(activeEffects([zoom], 999)).toHaveLength(0);
    expect(activeEffects([zoom], 1000)).toHaveLength(1);
    expect(activeEffects([zoom], 3000)).toHaveLength(0);
  });

  it("eases in and out over 300 ms and holds the peak", () => {
    expect(easeEnvelope(zoom, 0)).toBe(0);
    expect(easeEnvelope(zoom, 150)).toBeCloseTo(0.5);
    expect(easeEnvelope(zoom, 1000)).toBe(1);
    expect(easeEnvelope(zoom, 2000)).toBe(0);
    expect(zoomScaleAt(zoom, 1000)).toBe(2);
  });

  it("shortens the ramp for short effects", () => {
    expect(easeEnvelope({ durationMs: 300 }, 150)).toBe(1);
  });
});

describe("geometry", () => {
  it("clamps the zoom viewport inside the frame", () => {
    expect(zoomViewport({ x: 0.5, y: 0.5 }, 2)).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(zoomViewport({ x: 0.95, y: 0.02 }, 4)).toEqual({ x: 0.75, y: 0, w: 0.25, h: 0.25 });
  });

  it("maps fit modes to the content rect", () => {
    const canvas = { width: 1920, height: 1080 };
    expect(contentRect(canvas, 1920, 1080, "contain")).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const portrait = contentRect(canvas, 1080, 1920, "contain");
    expect(portrait.h).toBe(1);
    expect(portrait.w).toBeCloseTo(0.3164, 3);
    expect(contentRect(canvas, 1080, 1920, "cover").w).toBe(1);
    expect(contentRect(canvas, 1080, 1920, "fill")).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("normalizes blur rects in source pixels", () => {
    const blur: BlurEffect = { id: "b", type: "blur", startOffsetMs: 0, durationMs: 100, rect: { x: 960, y: 540, width: 1920, height: 100 }, blurStrength: 10 };
    expect(blurRectNorm(blur, 1920, 1080)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 100 / 1080 });
  });

  it("derives zoom from a drawn rectangle", () => {
    expect(zoomFromRect({ x: 0.25, y: 0.25, w: 0.5, h: 0.25 })).toEqual({ target: { x: 0.5, y: 0.375 }, scale: 2 });
    expect(zoomFromRect({ x: 0, y: 0, w: 0.01, h: 0.01 }).scale).toBe(8);
  });

  it("places callouts by quadrant", () => {
    expect(calloutPositionFor({ x: 0.8, y: 0.2 })).toBe("top-right");
    expect(calloutPositionFor({ x: 0.1, y: 0.9 })).toBe("bottom-left");
  });
});
