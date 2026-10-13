import { describe, expect, it } from "vitest";
import type { ScriptScene } from "../types";
import { createManifest } from "./manifest";
import { alignWords, assColor, buildCues, chunkWords, cueAt, proportionalWords, toAss, toSrt, type TimedWord } from "./subtitles";
import { layoutTimeline } from "./timeline";

// Real boundaries from the live Edge-TTS test (id-ID-GadisNeural).
const NARRATION = "Selamat datang di tutorial aplikasi SUMBA. Klik tombol Simpan untuk melanjutkan.";
const BOUNDARIES = [
  ["Selamat", 100, 650], ["datang", 650, 1100], ["di", 1100, 1225], ["tutorial", 1225, 1825], ["aplikasi", 1825, 2650],
  ["SUMBA", 2650, 3300], ["Klik", 4137, 4475], ["tombol", 4475, 4850], ["Simpan", 4850, 5375], ["untuk", 5375, 5887],
  ["melanjutkan", 5887, 6787],
].map(([text, startMs, endMs]) => ({ text: String(text), startMs: Number(startMs), endMs: Number(endMs) }));

function words(texts: ReadonlyArray<string>): ReadonlyArray<TimedWord> {
  return texts.map((word, i) => ({ word, startMs: i * 100, endMs: i * 100 + 90 }));
}

describe("alignWords", () => {
  it("keeps written punctuation while taking spoken timings", () => {
    const aligned = alignWords(NARRATION, BOUNDARIES);
    expect(aligned?.[5]).toEqual({ word: "SUMBA.", startMs: 2650, endMs: 3300 });
    expect(aligned).toHaveLength(11);
  });

  it("merges several spoken words into one written token", () => {
    const aligned = alignWords("Buka SUMBA-v2 sekarang", [
      { text: "Buka", startMs: 0, endMs: 100 },
      { text: "SUMBA", startMs: 100, endMs: 300 },
      { text: "v2", startMs: 300, endMs: 400 },
      { text: "sekarang", startMs: 400, endMs: 800 },
    ]);
    expect(aligned?.[1]).toEqual({ word: "SUMBA-v2", startMs: 100, endMs: 400 });
  });

  it("gives up when the sequences disagree", () => {
    expect(alignWords("Halo dunia", [{ text: "Hai", startMs: 0, endMs: 100 }])).toBeNull();
    expect(alignWords("Halo", [])).toBeNull();
  });

  it("falls back to character-proportional timing", () => {
    expect(proportionalWords("ab abcd", 600)).toEqual([
      { word: "ab", startMs: 0, endMs: 200 },
      { word: "abcd", startMs: 200, endMs: 600 },
    ]);
  });
});

describe("chunkWords", () => {
  it("breaks at sentence ends and never exceeds the limit", () => {
    const chunks = chunkWords(alignWords(NARRATION, BOUNDARIES) ?? [], 30);
    expect(chunks.map((c) => c.map((w) => w.word).join(" "))).toEqual([
      "Selamat datang di tutorial",
      "aplikasi SUMBA.",
      "Klik tombol Simpan untuk",
      "melanjutkan.",
    ]);
  });

  it("prefers breaking before a conjunction once the line is long enough", () => {
    const chunks = chunkWords(words(["Pilih", "menu", "Kendaraan", "lalu", "klik", "Tambah"]), 40);
    expect(chunks.map((c) => c.map((w) => w.word).join(" "))).toEqual(["Pilih menu Kendaraan", "lalu klik Tambah"]);
  });
});

describe("buildCues + exports", () => {
  const scene: ScriptScene = {
    id: "s1",
    order: 0,
    title: "Intro",
    narration: NARRATION,
    videoClipId: "v",
    videoTrimStartMs: 0,
    videoTrimEndMs: 8000,
    playbackRate: 1,
    alignmentMode: "freeze-frame",
    effects: [],
    audioDurationMs: 7632,
    audioCachePath: `cache/tts/${"a".repeat(64)}.mp3`,
    audioSha256: "a".repeat(64),
  };
  const base = createManifest("t");
  const manifest = { ...base, scenes: [{ ...scene, order: 0 }, { ...scene, id: "s2", order: 1, audioSha256: "b".repeat(64) }] };
  const layout = layoutTimeline(manifest);
  const cues = buildCues(layout, new Map([["a".repeat(64), BOUNDARIES]]), base.subtitleSettings);

  it("offsets cues by scene start and flags the fallback", () => {
    const second = layout.segments[1]?.startMs ?? 0;
    expect(cues[0]).toMatchObject({ startMs: 100, precise: true });
    expect(cues.find((c) => c.id.startsWith("s2"))).toMatchObject({ startMs: second, precise: false });
  });

  it("finds the active word", () => {
    expect(cueAt(cues, 1150)).toMatchObject({ activeWord: 2 });
    expect(cueAt(cues, 50)).toBeNull();
  });

  it("writes ASS with only the active word highlighted", () => {
    const ass = toAss(cues.slice(0, 1), base.subtitleSettings, base.canvas);
    expect(ass).toContain("PlayResX: 1920");
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events).toHaveLength(cues[0]?.words.length ?? 0);
    expect(events[1]).toContain("Selamat {\\c&H0000A8F5}datang{\\r} di");
    expect(events[0]?.startsWith("Dialogue: 0,0:00:00.10,0:00:00.65,")).toBe(true);
  });

  it("writes SRT per cue", () => {
    expect(toSrt(cues.slice(0, 1))).toBe(`1\n00:00:00,100 --> 00:00:03,300\n${cues[0]?.text}\n`);
  });

  it("converts colours with inverted alpha", () => {
    expect(assColor("#F5A800")).toBe("&H0000A8F5");
    expect(assColor("#000000A0")).toBe("&H5F000000");
  });
});
