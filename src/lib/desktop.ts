/**
 * Turns off browser behaviour that has no place in a desktop app (PRD 10 §5.3): reload, print,
 * find, history navigation and the WebView context menu outside text fields. Production only, so
 * F5 and the inspector keep working during development. Page zoom is already off (Tauri default).
 */
import { isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA");
}

/** Keys the WebView would otherwise handle: reload, print, find, caret browsing, back/forward. */
export function isBrowserShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;
  if (key === "f5" || key === "f3" || key === "f7") return true;
  if (mod && (key === "r" || key === "p" || key === "f" || key === "g" || key === "u")) return true;
  return event.altKey && (key === "arrowleft" || key === "arrowright");
}

export function useDesktopGuards(): void {
  useEffect(() => {
    if (!isTauri() || !import.meta.env.PROD) return;
    const onContextMenu = (event: MouseEvent): void => {
      // Text fields keep the native cut/copy/paste menu.
      if (!isEditable(event.target)) event.preventDefault();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isBrowserShortcut(event)) event.preventDefault();
    };
    // Mouse back/forward buttons would navigate the WebView away from the app.
    const onMouseUp = (event: MouseEvent): void => {
      if (event.button === 3 || event.button === 4) event.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);
}
