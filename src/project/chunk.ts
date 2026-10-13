/**
 * Auto-chunking of a long script into scenes (04 §3.1):
 * 1. A blank line separates scenes.
 * 2. A paragraph longer than 140 characters is split after `.`, `?`, `!`.
 * 3. Common abbreviations ("PT.", "No.", "dkk.", "yg.") never end a sentence.
 */

export const MAX_PARAGRAPH_CHARS = 140;

const ABBREVIATIONS: ReadonlySet<string> = new Set([
  "pt", "cv", "tbk", "no", "dkk", "yg", "dll", "dsb", "dst", "dr", "drs", "ir", "prof", "h", "hj", "jl", "kab", "kec",
  "kel", "tel", "telp", "hlm", "sdr", "bpk", "ibu", "st", "mr", "mrs", "vs", "etc", "e.g", "i.e", "a.n", "u.p",
]);

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * True when the `.` belongs to an abbreviation, an initial ("A."), or a list marker ("1." as the
 * very first token). A number at the end of a sentence ("tahun 2024.") does end it.
 */
function endsWithAbbreviation(sentence: string): boolean {
  const tokens = sentence.trimEnd().split(" ");
  const word = (tokens[tokens.length - 1] ?? "").replace(/\.$/, "").toLowerCase();
  const isListMarker = tokens.length === 1 && /^\d+$/.test(word);
  return ABBREVIATIONS.has(word) || /^[a-z]$/i.test(word) || isListMarker;
}

export function splitSentences(paragraph: string): ReadonlyArray<string> {
  const sentences: string[] = [];
  let current = "";
  const tokens = paragraph.split(/(?<=[.?!])\s+/);
  for (const token of tokens) {
    current = current === "" ? token : `${current} ${token}`;
    const endsSentence = /[?!]$/.test(token) || (token.endsWith(".") && !endsWithAbbreviation(current));
    if (endsSentence) {
      sentences.push(current);
      current = "";
    }
  }
  if (current !== "") sentences.push(current);
  return sentences;
}

export function autoChunk(script: string): ReadonlyArray<string> {
  return script
    .split(/\r?\n\s*\r?\n/)
    .map(collapse)
    .filter((paragraph) => paragraph !== "")
    .flatMap((paragraph) => (paragraph.length > MAX_PARAGRAPH_CHARS ? splitSentences(paragraph) : [paragraph]));
}

/** First words of a chunk as a scene title. */
export function titleFromNarration(narration: string, maxChars = 48): string {
  const text = collapse(narration).replace(/[.?!]+$/, "");
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
