import { describe, expect, it } from "vitest";
import { PEAKS_PER_SECOND, peakColumns } from "./waveforms";

describe("peakColumns", () => {
  const peaks = Array.from({ length: PEAKS_PER_SECOND * 2 }, (_, i) => (i < PEAKS_PER_SECOND ? 255 : 51));

  it("takes the max peak per column, normalized to 0–1", () => {
    expect(peakColumns(peaks, 0, 2, 2)).toEqual([1, 0.2]);
  });

  it("windows into the file and pads past its end with silence", () => {
    expect(peakColumns(peaks, 1, 2, 2)).toEqual([0.2, 0]);
  });

  it("returns nothing for degenerate sizes", () => {
    expect(peakColumns(peaks, 0, 2, 0)).toEqual([]);
    expect(peakColumns(peaks, 0, 0, 10)).toEqual([]);
  });
});
