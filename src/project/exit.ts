/**
 * Leaving a project or the app with unsaved changes asks Save / Don't save / Cancel first.
 * Shared by the project menu, the command palette, shortcuts and the window close button.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { create } from "zustand";
import { closeProject, saveProject } from "./session";
import { isDirty, useProjectStore } from "./store";

type PendingExit = { readonly kind: "closeProject"; readonly then: (() => Promise<boolean>) | null } | { readonly kind: "closeWindow" };

export const useExit = create<{ readonly pending: PendingExit | null }>()(() => ({ pending: null }));

export function hasUnsavedChanges(): boolean {
  const state = useProjectStore.getState();
  return state.project !== null && isDirty(state);
}

async function finish(exit: PendingExit): Promise<void> {
  if (exit.kind === "closeWindow") {
    await getCurrentWindow().destroy();
    return;
  }
  await closeProject();
  await exit.then?.();
}

/** Closes the project (then runs `then`, e.g. open another), asking first if there are unsaved changes. */
export async function closeProjectGuarded(then?: () => Promise<boolean>): Promise<void> {
  const exit: PendingExit = { kind: "closeProject", then: then ?? null };
  if (hasUnsavedChanges()) useExit.setState({ pending: exit });
  else await finish(exit);
}

/** Called when the window close button is pressed with unsaved changes. */
export function requestWindowClose(): void {
  useExit.setState({ pending: { kind: "closeWindow" } });
}

export async function resolveExit(choice: "cancel" | "discard" | "save"): Promise<void> {
  const exit = useExit.getState().pending;
  useExit.setState({ pending: null });
  if (!exit || choice === "cancel") return;
  // A failed save keeps the project open (the error toast explains why).
  if (choice === "save" && !(await saveProject())) return;
  await finish(exit);
}
