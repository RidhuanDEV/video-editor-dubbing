/**
 * Subtitles (04 §3.2–3.4). Cues are derived, never stored: narration text (with punctuation) is
 * aligned to the TTS WordBoundary timings, chunked, and exported as ASS (active-word highlight)
 * or SRT (per sentence). Without usable boundaries, timing falls back to character proportion
 * and the cue is marked imprecise.
 */
import type { CanvasSettings, SubtitleCue, SubtitleSettings, SubtitleWordCue, WordBoundary } from "../types";
import type { TimelineLayout } from "./timeline";

/** Contract type from 02 §2 (`word`, `startMs`, `endMs`). */
export type TimedWord = SubtitleWordCue;

export interface Cue extends SubtitleCue {
  readonly words: ReadonlyArray<TimedWord>;
  /** False when timing came from the proportional fallback. */
  readonly precise: boolean;
}

const CONJUNCTIONS: ReadonlySet<string> = new Set(["dan", "lalu", "kemudian", "dengan", "atau", "tetapi", "namun", "serta", "agar", "sehingga"]);
/** Boundary words merged at most this far to match one written token ("SUMBA-v2" → "SUMBA" + "v2"). */
const MAX_MERGE = 4;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function tokens(narration: string): ReadonlyArray<string> {
  return narration.split(/\s+/).filter((t) => t !== "");
}

/** Matches written tokens to spoken boundaries in order; null when the sequences disagree. */
export function alignWords(narration: string, boundaries: ReadonlyArray<WordBoundary>): ReadonlyArray<TimedWord> | null {
  const words: TimedWord[] = [];
  let b = 0;
  for (const token of tokens(narration)) {
    const key = normalize(token);
    if (key === "") {
      // Pure punctuation ("—"): attach to the previous word so the text stays intact.
      const previous = words.pop();
      if (previous) words.push({ ...previous, word: `${previous.word} ${token}` });
      continue;
    }
    let merged = "";
    let end = b;
    while (end < boundaries.length && end - b < MAX_MERGE && merged.length < key.length) {
      merged += normalize(boundaries[end]?.text ?? "");
      end += 1;
    }
    const first = boundaries[b];
    const last = boundaries[end - 1];
    if (merged !== key || !first || !last) return null;
    words.push({ word: token, startMs: first.startMs, endMs: last.endMs });
    b = end;
  }
  return words.length > 0 && b === boundaries.length ? words : null;
}

/** Fallback (04 §3.3): durations proportional to character count. */
export function proportionalWords(narration: string, audioMs: number): ReadonlyArray<TimedWord> {
  const list = tokens(narration);
  const total = list.reduce((sum, t) => sum + t.length, 0);
  let cursor = 0;
  return list.map((word) => {
    const startMs = Math.round((cursor / Math.max(total, 1)) * audioMs);
    cursor += word.length;
    return { word, startMs, endMs: Math.round((cursor / Math.max(total, 1)) * audioMs) };
  });
}

/** Groups words into cues of at most `maxChars`, preferring sentence ends, commas and conjunctions. */
export function chunkWords(words: ReadonlyArray<TimedWord>, maxChars: number): ReadonlyArray<ReadonlyArray<TimedWord>> {
  const chunks: TimedWord[][] = [];
  let current: TimedWord[] = [];
  let length = 0;
  const flush = (): void => {
    if (current.length > 0) chunks.push(current);
    current = [];
    length = 0;
  };
  for (const word of words) {
    const added = length === 0 ? word.word.length : length + 1 + word.word.length;
    const softBreak = length >= maxChars * 0.4 && CONJUNCTIONS.has(normalize(word.word));
    if (current.length > 0 && (added > maxChars || softBreak)) flush();
    current.push(word);
    length = length === 0 ? word.word.length : length + 1 + word.word.length;
    if (/[.?!]["')]*$/.test(word.word) || (/,$/.test(word.word) && length >= maxChars * 0.4)) flush();
  }
  flush();
  return chunks;
}

/** Timeline-absolute cues for every scene with synthesized narration. */
export function buildCues(
  layout: TimelineLayout,
  boundariesBySha: ReadonlyMap<string, ReadonlyArray<WordBoundary>>,
  settings: SubtitleSettings,
): ReadonlyArray<Cue> {
  const cues: Cue[] = [];
  for (const segment of layout.segments) {
    const { scene } = segment;
    if (scene.audioDurationMs === undefined || scene.narration.trim() === "") continue;
    const boundaries = scene.audioSha256 ? boundariesBySha.get(scene.audioSha256) : undefined;
    const aligned = boundaries ? alignWords(scene.narration, boundaries) : null;
    const words = aligned ?? proportionalWords(scene.narration, scene.audioDurationMs);
    for (const [index, chunk] of chunkWords(words, settings.maxCharsPerChunk).entries()) {
      const shifted = chunk.map((w) => ({ word: w.word, startMs: segment.startMs + w.startMs, endMs: segment.startMs + w.endMs }));
      const first = shifted[0];
      const last = shifted[shifted.length - 1];
      if (!first || !last) continue;
      cues.push({
        id: `${scene.id}:${index}`,
        startMs: first.startMs,
        endMs: Math.max(last.endMs, first.startMs + 1),
        text: shifted.map((w) => w.word).join(" "),
        words: shifted,
        precise: aligned !== null,
      });
    }
  }
  return cues;
}

/** Cue and active word index at a time (for the preview overlay). */
export function cueAt(cues: ReadonlyArray<Cue>, timeMs: number): { readonly cue: Cue; readonly activeWord: number } | null {
  const cue = cues.find((c) => timeMs >= c.startMs && timeMs < c.endMs);
  if (!cue) return null;
  let activeWord = -1;
  cue.words.forEach((w, i) => {
    if (timeMs >= w.startMs) activeWord = i;
  });
  return { cue, activeWord };
}

// ---------------------------------------------------------------------------
// ASS / SRT
// ---------------------------------------------------------------------------

/** `#RRGGBB[AA]` → ASS `&HAABBGGRR` (ASS alpha is inverted: 00 = opaque). */
export function assColor(hex: string): string {
  const rgb = hex.slice(1, 7);
  const alpha = hex.length === 9 ? 255 - parseInt(hex.slice(7, 9), 16) : 0;
  const [r, g, b] = [rgb.slice(0, 2), rgb.slice(2, 4), rgb.slice(4, 6)];
  return `&H${alpha.toString(16).padStart(2, "0")}${b}${g}${r}`.toUpperCase();
}

export function assTime(ms: number): string {
  const cs = Math.round(ms / 10);
  const h = Math.floor(cs / 360_000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Braces and backslashes would be read as ASS override tags. */
export function assText(text: string): string {
  return text.replace(/[{}]/g, (c) => (c === "{" ? "(" : ")")).replace(/\\/g, "/");
}

/** Script header with the given `Style:` lines; events follow `[Events]`. */
export function assHeader(canvas: Pick<CanvasSettings, "width" | "height">, styles: ReadonlyArray<string>): ReadonlyArray<string> {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${canvas.width}`,
    `PlayResY: ${canvas.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
}

/**
 * Subtitle style. BorderStyle 4 (libass): one box behind the whole line; style 3 boxes each run
 * separately, so the highlight override split the box and overlapping translucent boxes looked
 * darker. OutlineColour is fully transparent: Outline only pads the box, it must not halo glyphs.
 */
export function subtitleStyle(settings: SubtitleSettings, canvas: Pick<CanvasSettings, "height">): string {
  const primary = assColor(settings.primaryColor);
  const marginV = Math.round(canvas.height * 0.06);
  return `Style: Default,${settings.fontName},${settings.fontSize},${primary},${primary},&HFF000000,${assColor(settings.backColor)},0,0,0,0,100,100,0,0,4,${Math.round(settings.fontSize / 5)},0,2,60,60,${marginV},1`;
}

/**
 * One Dialogue per active word: the whole cue is shown and only the word being spoken is
 * coloured (`\k` karaoke would leave every past word highlighted).
 */
export function subtitleEvents(cues: ReadonlyArray<Cue>, settings: SubtitleSettings, layer = 0): ReadonlyArray<string> {
  const highlight = `{\\c${assColor(settings.highlightColor)}}`;
  return cues.flatMap((cue) =>
    cue.words.flatMap((word, index) => {
      const next = cue.words[index + 1];
      const end = next ? next.startMs : cue.endMs;
      if (end <= word.startMs) return [];
      const text = cue.words.map((w, i) => (i === index ? `${highlight}${assText(w.word)}{\\r}` : assText(w.word))).join(" ");
      return [`Dialogue: ${layer},${assTime(word.startMs)},${assTime(end)},Default,,0,0,0,,${text}`];
    }),
  );
}

export function toAss(cues: ReadonlyArray<Cue>, settings: SubtitleSettings, canvas: CanvasSettings): string {
  return `${[...assHeader(canvas, [subtitleStyle(settings, canvas)]), ...subtitleEvents(cues, settings)].join("\n")}\n`;
}

function srtTime(ms: number): string {
  const total = Math.round(ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor(total / 60_000) % 60;
  const s = Math.floor(total / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(total % 1000).padStart(3, "0")}`;
}

export function toSrt(cues: ReadonlyArray<Cue>): string {
  return cues.map((cue, i) => `${i + 1}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${cue.text}\n`).join("\n");
}
