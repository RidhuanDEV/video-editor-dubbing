import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";
import { THEME_PREFERENCES, isThemePreference, resolveTheme, type ResolvedTheme, type ThemePreference } from "../types";

/** Must match the key read by the pre-paint script in index.html. */
const STORAGE_KEY = "theme-preference";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset["theme"] = theme;
  if (isTauri()) {
    // Keeps the native title bar in sync; failure only affects window chrome, so it is not fatal.
    getCurrentWindow()
      .setTheme(theme)
      .catch((error: Error) => console.warn("setTheme failed", error.message));
  }
}

export interface ThemeState {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly setPreference: (preference: ThemePreference) => void;
}

export function useTheme(): ThemeState {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState<boolean>(() => window.matchMedia(DARK_QUERY).matches);
  const resolved = resolveTheme(preference, systemDark);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => applyTheme(resolved), [resolved]);

  const setPreference = useCallback((next: ThemePreference): void => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable: preference still applies for this session.
    }
  }, []);

  const cyclePreference = useCallback((): void => {
    const index = THEME_PREFERENCES.indexOf(preference);
    setPreference(THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length] ?? "system");
  }, [preference, setPreference]);

  // Ctrl/Cmd + Shift + L cycles the theme (08 §4).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        cyclePreference();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cyclePreference]);

  return { preference, resolved, setPreference };
}
