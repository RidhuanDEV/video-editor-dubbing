import { describe, expect, it } from "vitest";
import type { MediaAsset } from "../types";
import { accepts } from "./mediaDrag";

const video: MediaAsset = { id: "v", kind: "video", filePath: "C:/a.mp4", durationMs: 1000 };
const audio: MediaAsset = { id: "a", kind: "audio", filePath: "C:/a.mp3", durationMs: 1000 };
const image: MediaAsset = { id: "i", kind: "image", filePath: "C:/a.png" };

describe("media drop targets", () => {
  it("routes videos to scenes and audio to the BGM lane only", () => {
    expect(accepts("scene:s1", video)).toBe(true);
    expect(accepts("scenes", video)).toBe(true);
    expect(accepts("bgm-lane", video)).toBe(false);
    expect(accepts("bgm-lane", audio)).toBe(true);
    expect(accepts("scene:s1", audio)).toBe(false);
    expect(accepts("scenes", image)).toBe(false);
  });

  it("rejects audio without a known duration (BGM length needs it)", () => {
    expect(accepts("bgm-lane", { id: "a2", kind: "audio", filePath: "C:/b.mp3" })).toBe(false);
  });
});
