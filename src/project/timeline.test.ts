import { describe, expect, it } from "vitest";
import type { ProjectManifest, ScriptScene } from "../types";
import { addBgmTrack, setTrackState, splitScene, trimSceneClip } from "./commands";
import { createManifest } from "./manifest";
import { audibleTracks, layoutTimeline, segmentAt, snapCandidates, snapMs, splitPointAt, videoPositionAt } from "./timeline";

function scene(id: string, overrides: Partial<ScriptScene> = {}): ScriptScene {
  return {
    id,
    order: 0,
    title: id,
    narration: id,
    videoClipId: "v",
    videoTrimStartMs: 0,
    videoTrimEndMs: 4000,
    playbackRate: 1,
    alignmentMode: "freeze-frame",
    effects: [],
    ...overrides,
  };
}

function manifest(scenes: ReadonlyArray<ScriptScene>): ProjectManifest {
  return { ...createManifest("t"), sceneGapMs: 300, scenes };
}

describe("layoutTimeline", () => {
  // a: 4 s clip + 5 s audio → freeze 1 s; b: 4 s clip from 10 s, 2 s audio, ripple → 2 s video.
  const m = manifest([
    scene("a", { audioDurationMs: 5000 }),
    scene("b", { videoTrimStartMs: 10_000, videoTrimEndMs: 14_000, audioDurationMs: 2000, alignmentMode: "ripple-cut" }),
  ]);
  const layout = layoutTimeline(m);

  it("places scenes back to back with gaps", () => {
    expect(layout.segments.map((s) => [s.startMs, s.videoEndMs, s.audioEndMs, s.endMs])).toEqual([
      [0, 4000, 5000, 5300],
      [5300, 7300, 7300, 7600],
    ]);
    expect(layout.durationMs).toBe(7600);
  });

  it("finds segments and source positions, including the freeze region", () => {
    expect(segmentAt(layout, 5299)?.scene.id).toBe("a");
    expect(segmentAt(layout, 5300)?.scene.id).toBe("b");
    expect(videoPositionAt(layout, 1000)).toMatchObject({ sourceMs: 1000, frozen: false });
    expect(videoPositionAt(layout, 4500)).toMatchObject({ sourceMs: 4000, frozen: true });
    expect(videoPositionAt(layout, 6300)).toMatchObject({ sourceMs: 11_000, frozen: false });
  });

  it("applies playback rate to source time", () => {
    const fast = layoutTimeline(manifest([scene("f", { playbackRate: 2 })]));
    expect(fast.segments[0]?.videoEndMs).toBe(2000);
    expect(videoPositionAt(fast, 1000)?.sourceMs).toBe(2000);
  });

  it("refuses splits in the freeze region or too close to an edge", () => {
    expect(splitPointAt(layout, 2000)).toEqual({ sceneId: "a", sourceMs: 2000 });
    expect(splitPointAt(layout, 4500)).toBeNull();
    expect(splitPointAt(layout, 50)).toBeNull();
  });
});

describe("snapping", () => {
  it("snaps to the nearest candidate within the threshold", () => {
    expect(snapMs(1040, [0, 1000, 1100], 50)).toEqual({ valueMs: 1000, snappedTo: 1000 });
    expect(snapMs(1300, [0, 1000], 50)).toEqual({ valueMs: 1300, snappedTo: null });
  });

  it("offers narration ends as targets", () => {
    const layout = layoutTimeline(manifest([scene("a", { audioDurationMs: 3100 })]));
    expect(snapCandidates(layout, 0)).toContain(3100);
  });
});

describe("timeline commands", () => {
  it("splits a scene: left keeps narration and audio, right continues the clip", () => {
    const m = manifest([scene("a", { audioDurationMs: 3000, audioCachePath: "cache/tts/a.mp3", audioSha256: "a".repeat(64) })]);
    const next = splitScene(m, "a", 1500)?.apply(m);
    expect(next?.scenes.map((s) => [s.videoTrimStartMs, s.videoTrimEndMs, s.narration, s.audioDurationMs, s.order])).toEqual([
      [0, 1500, "a", 3000, 0],
      [1500, 4000, "", undefined, 1],
    ]);
  });

  it("split is reversible", () => {
    const m = manifest([scene("a"), scene("b")]);
    const command = splitScene(m, "a", 2000);
    const applied = command?.apply(m);
    expect(applied && command?.revert(applied).scenes.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("trims keep audio (the narration is unchanged)", () => {
    const m = manifest([scene("a", { audioDurationMs: 3000, audioCachePath: "cache/tts/a.mp3", audioSha256: "a".repeat(64) })]);
    const next = trimSceneClip(m, "a", 500, 3500)?.apply(m);
    expect(next?.scenes[0]).toMatchObject({ videoTrimStartMs: 500, videoTrimEndMs: 3500, audioDurationMs: 3000 });
  });

  it("solo overrides mute for audibility", () => {
    const m = manifest([]);
    const soloed = setTrackState(m, "bgm", { solo: true }).apply(m);
    expect([...audibleTracks(soloed.tracks)]).toEqual(["bgm"]);
    const muted = setTrackState(m, "narration", { muted: true }).apply(m);
    expect(audibleTracks(muted.tracks).has("narration")).toBe(false);
  });

  it("adds BGM only from audio assets with a known duration", () => {
    const m = manifest([]);
    expect(addBgmTrack({ id: "x", kind: "video", filePath: "v.mp4", durationMs: 1000 }, 0, "v")).toBeNull();
    const next = addBgmTrack({ id: "y", kind: "audio", filePath: "bgm.mp3", durationMs: 60_000 }, -50, "bgm")?.apply(m);
    expect(next?.bgmTracks[0]).toMatchObject({ startOffsetMs: 0, durationMs: 60_000, autoDuck: true });
  });
});
