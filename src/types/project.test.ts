import { describe, expect, it } from "vitest";
import { ProjectManifestSchema, SceneEffectSchema, ScriptSceneSchema, type ProjectManifest } from "./project";

const SCENE: ProjectManifest["scenes"][number] = {
  id: "scene-1",
  order: 0,
  title: "Login",
  narration: "Buka halaman login.",
  videoClipId: "asset-1",
  videoTrimStartMs: 0,
  videoTrimEndMs: 4000,
  playbackRate: 1,
  alignmentMode: "freeze-frame",
  effects: [],
};

const MANIFEST: ProjectManifest = {
  schemaVersion: "1.0.0",
  id: "6f1c2b9e-4a63-4f0e-9d2a-0c8f5b7e1a24",
  title: "Tutorial SUMBA",
  createdAt: "2026-10-12T08:00:00Z",
  updatedAt: "2026-10-12T08:00:00Z",
  defaultVoice: { engine: "edge-tts", voiceId: "id-ID-GadisNeural", rate: "+0%", pitch: "+0Hz", volume: "+0%" },
  canvas: { width: 1920, height: 1080, fps: 30, background: "#1f2933", padding: 0, fit: "contain", aspectRatio: "16:9" },
  assets: [{ id: "asset-1", kind: "video", filePath: "D:\\rekaman\\login.mp4", durationMs: 4000, proxyPath: "proxy/asset-1.mp4" }],
  scenes: [SCENE],
  bgmTracks: [],
  subtitleSettings: {
    enabled: true,
    fontName: "Inter",
    fontSize: 24,
    primaryColor: "#FFFFFF",
    highlightColor: "#F5A800",
    backColor: "#00000080",
    maxCharsPerChunk: 80,
  },
  markers: [],
  tracks: [{ kind: "video", muted: false, solo: false, locked: false }],
  sceneGapMs: 300,
  loudness: { enabled: true, targetLufs: -14 },
};

describe("ProjectManifestSchema", () => {
  it("accepts a valid manifest", () => {
    expect(ProjectManifestSchema.safeParse(MANIFEST).success).toBe(true);
  });

  it("rejects an unknown schema version", () => {
    expect(ProjectManifestSchema.safeParse({ ...MANIFEST, schemaVersion: "2.0.0" }).success).toBe(false);
  });

  it.each(["../outside.mp4", "proxy/../../x.mp4", "C:\\abs\\x.mp4", "/abs/x.mp4"])(
    "rejects proxy path escaping the project folder: %s",
    (proxyPath) => {
      const asset = { ...MANIFEST.assets[0], proxyPath };
      expect(ProjectManifestSchema.safeParse({ ...MANIFEST, assets: [asset] }).success).toBe(false);
    },
  );

  it("rejects prosody values with trailing garbage", () => {
    const defaultVoice = { ...MANIFEST.defaultVoice, rate: "+0%' volume='+100%" };
    expect(ProjectManifestSchema.safeParse({ ...MANIFEST, defaultVoice }).success).toBe(false);
  });
});

describe("ScriptSceneSchema", () => {
  it("requires trim end after trim start", () => {
    const result = ScriptSceneSchema.safeParse({ ...SCENE, videoTrimStartMs: 4000, videoTrimEndMs: 4000 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["videoTrimEndMs"]);
  });
});

describe("SceneEffectSchema", () => {
  it("discriminates on type", () => {
    const zoom = { id: "e1", type: "zoom", startOffsetMs: 0, durationMs: 500, scale: 1.5, target: { x: 0.5, y: 0.5 }, spotlightMask: false };
    expect(SceneEffectSchema.safeParse(zoom).success).toBe(true);
    expect(SceneEffectSchema.safeParse({ ...zoom, type: "blur" }).success).toBe(false);
  });

  it("keeps zoom target normalized", () => {
    const zoom = { id: "e1", type: "zoom", startOffsetMs: 0, durationMs: 500, scale: 1.5, target: { x: 1.2, y: 0.5 }, spotlightMask: false };
    expect(SceneEffectSchema.safeParse(zoom).success).toBe(false);
  });
});
