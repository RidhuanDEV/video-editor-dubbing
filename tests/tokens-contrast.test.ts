/**
 * WCAG contrast of the design tokens in both themes (08 §9: checked in CI, build fails below
 * the threshold). Reads tokens.css directly so the test follows the real values.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Read from disk: Vitest replaces CSS imports (even `?raw`) with an empty module.
const TOKENS = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

type Theme = "dark" | "light";

function tokensFor(theme: Theme): ReadonlyMap<string, string> {
  // The dark block is `:root, [data-theme="dark"] { … }`, the light one `[data-theme="light"] { … }`.
  const marker = theme === "dark" ? '[data-theme="dark"] {' : '[data-theme="light"] {';
  const start = TOKENS.indexOf(marker);
  const body = TOKENS.slice(start + marker.length, TOKENS.indexOf("}", start));
  const map = new Map<string, string>();
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, value] = match;
    if (name && value) map.set(name, value);
  }
  return map;
}

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const BACKGROUNDS = ["bg-app", "bg-panel", "bg-surface", "bg-raised", "bg-hover"];

/** [foreground, background(s), minimum ratio]. Text is AA 4.5:1; focus/borders of controls 3:1. */
const PAIRS: ReadonlyArray<readonly [string, ReadonlyArray<string>, number]> = [
  ["text-primary", [...BACKGROUNDS, "bg-selected"], 4.5],
  ["text-secondary", [...BACKGROUNDS, "bg-selected"], 4.5],
  ["text-muted", ["bg-app", "bg-panel", "bg-surface", "bg-raised"], 4.5],
  ["on-accent", ["accent", "accent-hover"], 4.5],
  ["accent", ["bg-app", "bg-panel", "bg-surface", "accent-subtle"], 4.5],
  ["success", ["bg-panel", "bg-surface", "bg-raised"], 4.5],
  ["warning", ["bg-panel", "bg-surface", "bg-raised"], 4.5],
  ["danger", ["bg-panel", "bg-surface", "bg-raised"], 4.5],
  ["info", ["bg-panel", "bg-surface", "bg-raised"], 4.5],
  ["focus-ring", ["bg-app", "bg-panel", "bg-surface"], 3],
];

describe.each<Theme>(["dark", "light"])("%s theme contrast", (theme) => {
  const tokens = tokensFor(theme);
  const cases = PAIRS.flatMap(([fg, bgs, min]) => bgs.map((bg): [string, string, number] => [fg, bg, min]));

  it.each(cases)("%s on %s ≥ %d:1", (fg, bg, min) => {
    const a = tokens.get(fg);
    const b = tokens.get(bg);
    expect(a, `--${fg} missing`).toBeDefined();
    expect(b, `--${bg} missing`).toBeDefined();
    expect(contrast(a ?? "#000000", b ?? "#000000")).toBeGreaterThanOrEqual(min);
  });
});
