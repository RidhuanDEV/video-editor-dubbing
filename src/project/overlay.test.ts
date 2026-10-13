import { describe, expect, it } from "vitest";
import type { ProjectManifest, ScriptScene } from "../types";
import { createManifest } from "./manifest";
import { buildOverlayAss } from "./overlay";
import { layoutTimeline } from "./timeline";

const scene: ScriptScene = {
  id: "s",
  order: 0,
  title: "t",
  narration: "Halo",
  videoClipId: "v",
  videoTrimStartMs: 0,
  videoTrimEndMs: 4000,
  playbackRate: 1,
  alignmentMode: "freeze-frame",
  effects: [
    { id: "b", type: "callout", startOffsetMs: 1000, durationMs: 2000, label: "Langkah {1}", position: "top-right" },
    { id: "z", type: "zoom", startOffsetMs: 0, durationMs: 1500, scale: 2, target: { x: 0.5, y: 0.5 }, spotlightMask: true },
    { id: "n", type: "zoom", startOffsetMs: 0, durationMs: 1500, scale: 2, target: { x: 0.5, y: 0.5 }, spotlightMask: false },
  ],
};

function manifest(effects: ScriptScene["effects"]): ProjectManifest {
  return {
    ...createManifest("t"),
    assets: [{ id: "v", kind: "video", filePath: "v.mp4", width: 1920, height: 1080 }],
    scenes: [{ ...scene, effects }],
  };
}

describe("buildOverlayAss", () => {
  const m = manifest(scene.effects);
  const ass = buildOverlayAss(m, layoutTimeline(m), null) ?? "";
  const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));

  it("draws badges at the preview position with fixed colours and a fade", () => {
    expect(events.find((e) => e.includes(",Badge,"))).toBe("Dialogue: 1,0:00:01.00,0:00:03.00,Badge,,0,0,0,,{\\an9\\pos(1843,65)\\fad(300,300)}Langkah (1)");
    expect(ass).toContain("Style: Badge,Inter,36,&H00FFFFFF,&H00FFFFFF,&HFF000000,&H006E760F,");
  });

  it("dims everything outside the spotlight focus with four rectangles", () => {
    const spot = events.find((e) => e.includes(",Spot,")) ?? "";
    // 2x around the centre → focus 480..1440 × 270..810 on a 1920×1080 canvas, 60% dim (alpha 0x66).
    expect(spot).toContain("\\1a&H66&");
    expect(spot).toContain("m 0 0 l 1920 0 1920 270 0 270 m 0 810 l 1920 810 1920 1080 0 1080 m 0 270 l 480 270 480 810 0 810 m 1440 270 l 1920 270 1920 810 1440 810");
  });

  it("leaves real zooms to the FFmpeg filter", () => {
    expect(events).toHaveLength(2);
  });

  it("returns null when there is nothing to draw", () => {
    const plain = manifest([]);
    expect(buildOverlayAss(plain, layoutTimeline(plain), null)).toBeNull();
  });
});
