import { beforeEach, describe, expect, it } from "vitest";
import type { MediaAsset, ProjectManifest, ScriptScene } from "../types";
import FIXTURE from "./fixtures/project-1.0.0.json?raw";
import { autoChunk, splitSentences, titleFromNarration } from "./chunk";
import { buildScenes, effectiveVoice, insertScenes, moveScene, removeAsset, setDefaultVoice, updateScene } from "./commands";
import { createManifest, loadManifest, serializeManifest } from "./manifest";
import { COALESCE_WINDOW_MS, HISTORY_LIMIT, isDirty, useProjectStore } from "./store";
import { sceneDurationMs, sceneSync } from "./sync";

function scene(id: string, overrides: Partial<ScriptScene> = {}): ScriptScene {
  return {
    id,
    order: 0,
    title: id,
    narration: `Narasi ${id}`,
    videoClipId: "asset",
    videoTrimStartMs: 0,
    videoTrimEndMs: 4000,
    playbackRate: 1,
    alignmentMode: "freeze-frame",
    effects: [],
    ...overrides,
  };
}

function manifestWith(scenes: ReadonlyArray<ScriptScene>): ProjectManifest {
  return { ...createManifest("Uji"), scenes };
}

describe("loadManifest", () => {
  it("loads the 1.0.0 example project", () => {
    const result = loadManifest(FIXTURE);
    expect(result.ok && !result.readOnly && result.manifest.scenes.length).toBe(1);
  });

  it("round-trips through serializeManifest", () => {
    const manifest = createManifest("Baru");
    const result = loadManifest(serializeManifest(manifest));
    expect(result.ok && result.manifest).toEqual(manifest);
  });

  it("opens a newer schema read-only", () => {
    const result = loadManifest(FIXTURE.replace('"schemaVersion": "1.0.0"', '"schemaVersion": "1.4.0"'));
    expect(result.ok && result.readOnly).toBe(true);
  });

  it("rejects older versions without a migrator, invalid JSON and invalid content", () => {
    expect(loadManifest(FIXTURE.replace('"1.0.0"', '"0.9.0"')).ok).toBe(false);
    expect(loadManifest("{not json").ok).toBe(false);
    expect(loadManifest(FIXTURE.replace('"sceneGapMs": 300', '"sceneGapMs": -1')).ok).toBe(false);
  });
});

describe("commands", () => {
  it("clears stale audio when narration or voice changes, not when the title changes", () => {
    const withAudio = scene("a", { audioDurationMs: 1000, audioCachePath: "cache/tts/x.mp3", audioSha256: "f".repeat(64) });
    const manifest = manifestWith([withAudio]);
    const renamed = updateScene(manifest, "a", { title: "Baru" })?.apply(manifest);
    expect(renamed?.scenes[0]?.audioDurationMs).toBe(1000);
    const edited = updateScene(manifest, "a", { narration: "Teks baru" })?.apply(manifest);
    expect(edited?.scenes[0]?.audioDurationMs).toBeUndefined();
    expect(edited && "audioSha256" in (edited.scenes[0] ?? {})).toBe(false);
  });

  it("keeps order in sync with array position", () => {
    const manifest = manifestWith([scene("a"), scene("b", { order: 1 }), scene("c", { order: 2 })]);
    const moved = moveScene(manifest, "c", -2)?.apply(manifest);
    expect(moved?.scenes.map((s) => `${s.id}${s.order}`)).toEqual(["c0", "a1", "b2"]);
    expect(moveScene(manifest, "a", -1)).toBeNull();
  });

  it("refuses to remove an asset used by a scene", () => {
    const asset: MediaAsset = { id: "asset", kind: "video", filePath: "x.mp4" };
    const manifest = { ...manifestWith([scene("a")]), assets: [asset] };
    expect(removeAsset(manifest, "asset")).toBeNull();
  });

  it("default voice change invalidates only inheriting scenes", () => {
    const audio = { audioDurationMs: 1000, audioCachePath: "cache/tts/x.mp3", audioSha256: "f".repeat(64) };
    const manifest = manifestWith([scene("inherit", audio), scene("own", { ...audio, voiceOverride: { voiceId: "id-ID-ArdiNeural" } })]);
    const next = setDefaultVoice(manifest, { ...manifest.defaultVoice, voiceId: "en-US-AriaNeural" }).apply(manifest);
    expect(next.scenes.map((s) => s.audioDurationMs)).toEqual([undefined, 1000]);
    expect(effectiveVoice(next, next.scenes[1] ?? scene("x")).voiceId).toBe("id-ID-ArdiNeural");
  });
});

describe("store history", () => {
  beforeEach(() => {
    useProjectStore.getState().open({ root: "C:/p", manifest: manifestWith([scene("a")]), readOnly: false });
  });

  it("undoes and redoes", () => {
    const store = useProjectStore.getState();
    store.execute(insertScenes(store.project?.manifest ?? createManifest("x"), [scene("b")]));
    expect(useProjectStore.getState().project?.manifest.scenes).toHaveLength(2);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project?.manifest.scenes).toHaveLength(1);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project?.manifest.scenes).toHaveLength(2);
  });

  it("coalesces typing in one field into a single step", () => {
    const type = (text: string, at: number): void => {
      const manifest = useProjectStore.getState().project?.manifest ?? createManifest("x");
      useProjectStore.getState().execute(updateScene(manifest, "a", { narration: text }, "a:narration"), at);
    };
    type("H", 1000);
    type("Ha", 1100);
    type("Hal", 1200);
    type("Halo", 1200 + COALESCE_WINDOW_MS + 1);
    expect(useProjectStore.getState().past).toHaveLength(2);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project?.manifest.scenes[0]?.narration).toBe("Hal");
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project?.manifest.scenes[0]?.narration).toBe("Narasi a");
  });

  it("caps history and tracks dirtiness", () => {
    expect(isDirty(useProjectStore.getState())).toBe(false);
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) {
      const manifest = useProjectStore.getState().project?.manifest ?? createManifest("x");
      useProjectStore.getState().execute(updateScene(manifest, "a", { title: `t${i}` }));
    }
    const state = useProjectStore.getState();
    expect(state.past).toHaveLength(HISTORY_LIMIT);
    expect(isDirty(state)).toBe(true);
    state.markSaved(state.revision, "2026-10-12T10:00:00.000Z");
    expect(isDirty(useProjectStore.getState())).toBe(false);
  });

  it("does not record synthesized audio as an undo step", () => {
    useProjectStore.getState().setSceneAudio("a", { audioDurationMs: 900, audioCachePath: "cache/tts/a.mp3", audioSha256: "a".repeat(64) });
    expect(useProjectStore.getState().past).toHaveLength(0);
    expect(useProjectStore.getState().project?.manifest.scenes[0]?.audioDurationMs).toBe(900);
  });
});

describe("autoChunk", () => {
  it("splits on blank lines and keeps short paragraphs whole", () => {
    expect(autoChunk("Halo semua.\n\n  Kedua.  Masih kedua.\n")).toEqual(["Halo semua.", "Kedua. Masih kedua."]);
  });

  it("splits long paragraphs on sentence ends but protects abbreviations", () => {
    const long =
      "Data dari PT. Sumba Logistik dicatat oleh petugas dkk. dengan teliti. Apakah Anda sudah login? " +
      "Klik tombol Simpan di pojok kanan bawah halaman untuk menyimpan semua perubahan yang sudah dibuat!";
    expect(long.length).toBeGreaterThan(140);
    expect(autoChunk(long)).toEqual([
      "Data dari PT. Sumba Logistik dicatat oleh petugas dkk. dengan teliti.",
      "Apakah Anda sudah login?",
      "Klik tombol Simpan di pojok kanan bawah halaman untuk menyimpan semua perubahan yang sudah dibuat!",
    ]);
  });

  it("ends sentences after numbers but not after list markers", () => {
    expect(splitSentences("Lihat No. 5. Lalu lanjut.")).toEqual(["Lihat No. 5.", "Lalu lanjut."]);
    expect(splitSentences("Data tahun 2024. Berikutnya.")).toEqual(["Data tahun 2024.", "Berikutnya."]);
    expect(splitSentences("1. Buka menu. 2. Klik Simpan.")).toEqual(["1. Buka menu.", "2. Klik Simpan."]);
  });

  it("derives short titles", () => {
    expect(titleFromNarration("Buka halaman login.")).toBe("Buka halaman login");
    expect(titleFromNarration("a".repeat(30) + " " + "b".repeat(30)).endsWith("…")).toBe(true);
  });
});

describe("sceneSync", () => {
  it("reports each status from 04 §1.2", () => {
    expect(sceneSync(scene("a")).kind).toBe("pending");
    expect(sceneSync(scene("a", { audioDurationMs: 4050 })).kind).toBe("synced");
    expect(sceneSync(scene("a", { audioDurationMs: 4420 }))).toEqual({ kind: "freeze", padMs: 420 });
    expect(sceneSync(scene("a", { audioDurationMs: 3000 }))).toEqual({ kind: "videoLonger", extraMs: 1000 });
    expect(sceneSync(scene("a", { audioDurationMs: 4420, alignmentMode: "natural-pause" }))).toEqual({ kind: "audioCut", overMs: 420 });
  });

  it("accounts for playback rate and gap", () => {
    expect(sceneSync(scene("a", { playbackRate: 2, audioDurationMs: 2000 })).kind).toBe("synced");
    expect(sceneDurationMs(scene("a", { audioDurationMs: 3000, alignmentMode: "ripple-cut" }), 300)).toBe(3300);
    expect(sceneDurationMs(scene("a", { audioDurationMs: 5000 }), 300)).toBe(5300);
  });
});

describe("buildScenes", () => {
  it("splits the clip evenly and keeps every trim valid", () => {
    const asset: MediaAsset = { id: "v", kind: "video", filePath: "v.mp4", durationMs: 10_000 };
    const scenes = buildScenes(asset, ["a", "b", "c"], (n) => n.toUpperCase());
    expect(scenes.map((s) => [s.videoTrimStartMs, s.videoTrimEndMs, s.title])).toEqual([
      [0, 3333, "A"],
      [3333, 6666, "B"],
      [6666, 10_000, "C"],
    ]);
    const tiny = buildScenes({ ...asset, durationMs: 2 }, ["a", "b", "c", "d"], (n) => n);
    expect(tiny.every((s) => s.videoTrimEndMs > s.videoTrimStartMs)).toBe(true);
  });
});
