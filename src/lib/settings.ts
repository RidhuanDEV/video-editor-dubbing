/**
 * App settings mirror (Rust is the source of truth) and the Edge-TTS consent flow (ADR D6):
 * Edge-TTS is unofficial, so the first use asks for explicit consent, which Rust also enforces.
 */
import { isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { create } from "zustand";
import type { SettingsView } from "../types";
import { settingsGet, settingsSetEdgeConsent } from "./ipc";
import { notify } from "./notices";

interface SettingsStore {
  readonly settings: SettingsView | null;
  /** Resolver of the open consent dialog; null when no dialog is shown. */
  readonly pendingConsent: ((accepted: boolean) => void) | null;
}

export const useSettings = create<SettingsStore>()(() => ({ settings: null, pendingConsent: null }));

export function setSettings(settings: SettingsView): void {
  useSettings.setState({ settings });
}

/** Loads settings once on startup. */
export function useSettingsLoader(): void {
  useEffect(() => {
    if (!isTauri()) return;
    void settingsGet().then((result) => {
      if (result.ok) setSettings(result.value);
      else notify("error", `Pengaturan tidak terbaca: ${result.error.message}`);
    });
  }, []);
}

/** Opens the consent dialog; resolves true once consent is stored. */
export function requestEdgeConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    useSettings.getState().pendingConsent?.(false);
    useSettings.setState({
      pendingConsent: (accepted) => {
        useSettings.setState({ pendingConsent: null });
        if (!accepted) {
          resolve(false);
          return;
        }
        void settingsSetEdgeConsent(true).then((result) => {
          if (result.ok) setSettings(result.value);
          else notify("error", result.error.message);
          resolve(result.ok);
        });
      },
    });
  });
}
