/**
 * Edge-TTS voice list, fetched once per app session. Offline or blocked: fall back to the
 * known Indonesian voices so the script panel stays usable (08 §8, offline state).
 */
import { useEffect } from "react";
import { create } from "zustand";
import type { VoiceInfo } from "../types";
import { ttsListVoices } from "./ipc";

export const FALLBACK_VOICES: ReadonlyArray<VoiceInfo> = [
  { shortName: "id-ID-GadisNeural", locale: "id-ID", gender: "Female", friendlyName: "Gadis (Indonesia)" },
  { shortName: "id-ID-ArdiNeural", locale: "id-ID", gender: "Male", friendlyName: "Ardi (Indonesia)" },
];

interface VoiceStore {
  readonly voices: ReadonlyArray<VoiceInfo>;
  readonly status: "idle" | "loading" | "online" | "offline";
}

const useVoiceStore = create<VoiceStore>()(() => ({ voices: FALLBACK_VOICES, status: "idle" }));

export function useVoices(): VoiceStore {
  const state = useVoiceStore();
  useEffect(() => {
    if (useVoiceStore.getState().status !== "idle") return;
    useVoiceStore.setState({ status: "loading" });
    void ttsListVoices().then((result) => {
      useVoiceStore.setState(
        result.ok && result.value.length > 0 ? { voices: result.value, status: "online" } : { voices: FALLBACK_VOICES, status: "offline" },
      );
    });
  }, []);
  return state;
}

/** Indonesian voices first, then the rest alphabetically by locale. */
export function sortVoices(voices: ReadonlyArray<VoiceInfo>): ReadonlyArray<VoiceInfo> {
  return [...voices].sort((a, b) => {
    const rank = (v: VoiceInfo): number => (v.locale === "id-ID" ? 0 : 1);
    return rank(a) - rank(b) || a.locale.localeCompare(b.locale) || a.shortName.localeCompare(b.shortName);
  });
}

/** `"+15%"` → 15; `"-3Hz"` → -3. Invalid input reads as 0. */
export function parseSigned(value: string): number {
  const match = /^([+-]\d+)/.exec(value);
  return match?.[1] ? Number(match[1]) : 0;
}

export function formatSigned(value: number, unit: "%" | "Hz"): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded}${unit}`;
}
