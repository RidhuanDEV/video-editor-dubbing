/**
 * Voice lists per TTS engine, fetched once per app session. When a list cannot be loaded
 * (offline, no consent yet, Azure not configured) the known Indonesian voices keep the script
 * panel usable (08 §8, offline state).
 */
import { useEffect } from "react";
import { create } from "zustand";
import type { VoiceEngine, VoiceInfo } from "../types";
import { ttsListVoices } from "./ipc";

export const FALLBACK_VOICES: ReadonlyArray<VoiceInfo> = [
  { shortName: "id-ID-GadisNeural", locale: "id-ID", gender: "Female", friendlyName: "Gadis (Indonesia)" },
  { shortName: "id-ID-ArdiNeural", locale: "id-ID", gender: "Male", friendlyName: "Ardi (Indonesia)" },
];

export type VoiceListStatus = "idle" | "loading" | "online" | "offline";

interface VoiceList {
  readonly voices: ReadonlyArray<VoiceInfo>;
  readonly status: VoiceListStatus;
}

const IDLE: VoiceList = { voices: FALLBACK_VOICES, status: "idle" };

const useVoiceStore = create<{ readonly byEngine: Readonly<Partial<Record<VoiceEngine, VoiceList>>> }>()(() => ({ byEngine: {} }));

function setList(engine: VoiceEngine, list: VoiceList): void {
  useVoiceStore.setState((state) => ({ byEngine: { ...state.byEngine, [engine]: list } }));
}

/** Forget a list so it reloads (e.g. after Azure settings or Edge consent changed). */
export function invalidateVoices(engine: VoiceEngine): void {
  setList(engine, IDLE);
}

export function useVoices(engine: VoiceEngine): VoiceList {
  const list = useVoiceStore((s) => s.byEngine[engine]) ?? IDLE;
  useEffect(() => {
    if ((useVoiceStore.getState().byEngine[engine] ?? IDLE).status !== "idle") return;
    setList(engine, { voices: FALLBACK_VOICES, status: "loading" });
    void ttsListVoices(engine).then((result) => {
      setList(engine, result.ok && result.value.length > 0 ? { voices: result.value, status: "online" } : { voices: FALLBACK_VOICES, status: "offline" });
    });
  }, [engine, list.status]);
  return list;
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
