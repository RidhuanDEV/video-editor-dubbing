import { describe, expect, it } from "vitest";
import type { MediaAsset, ProjectManifest, ScriptScene } from "../types";
import { createManifest } from "./manifest";
import { projectReadiness } from "./readiness";

const video: MediaAsset = { id: "v1", kind: "video", filePath: "C:/rec.mp4", durationMs: 10_000, width: 1920, height: 1080 };

function scene(id: string, overrides: Partial<ScriptScene> = {}): ScriptScene {
  return {
    id,
    order: 0,
    title: id,
    narration: "Halo",
    videoClipId: "v1",
    videoTrimStartMs: 0,
    videoTrimEndMs: 4000,
    playbackRate: 1,
    alignmentMode: "freeze-frame",
    effects: [],
    ...overrides,
  };
}

function manifest(assets: ReadonlyArray<MediaAsset>, scenes: ReadonlyArray<ScriptScene>): ProjectManifest {
  return { ...createManifest("Uji"), assets, scenes };
}

describe("projectReadiness", () => {
  it("starts with importing media, and hides scene checks until scenes exist", () => {
    const r = projectReadiness(manifest([], []), new Set());
    expect(r.next?.action).toBe("importMedia");
    expect(r.items.map((i) => i.id)).toEqual(["media", "scenes"]);
    expect(r.canExport).toBe(false);
  });

  it("asks for a script once media exists", () => {
    expect(projectReadiness(manifest([video], []), new Set()).next?.action).toBe("addScript");
  });

  it("blocks export on missing clips, not on missing narration audio", () => {
    const scenes = [scene("a"), scene("b", { audioDurationMs: 900, audioCachePath: "cache/tts/x.mp3", audioSha256: "x" })];
    const missing = projectReadiness(manifest([video], scenes), new Set(["v1"]));
    expect(missing.next?.action).toBe("relink");
    expect(missing.canExport).toBe(false);

    const ok = projectReadiness(manifest([video], scenes), new Set());
    expect(ok.canExport).toBe(true);
    expect(ok.next?.action).toBe("synthesize");
    expect(ok.next?.actionLabel).toBe("Sintesis 1 scene");
    expect(ok.done).toBe(4);
    expect(ok.total).toBe(5);
  });

  it("points at empty narration before synthesis", () => {
    const r = projectReadiness(manifest([video], [scene("a", { narration: "  " })]), new Set());
    expect(r.next?.action).toBe("selectEmptyScene");
  });
});
