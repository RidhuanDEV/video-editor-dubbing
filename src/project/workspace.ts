/**
 * Studio workspace UI state (PRD 10 §4): which side tab, dialog and effect tool are active.
 * Never written to the manifest; reset when another project opens.
 */
import { create } from "zustand";

export type LeftTab = "script" | "media";
export type EffectTool = "select" | "zoom" | "blur" | "callout";
export type SettingsSection = "general" | "voice" | "video" | "shortcuts" | "about";

/** One modal at a time (08 §11: no stacked modals). */
export type DialogId = "export" | "settings" | "palette" | "addScene" | "pasteScript" | "addBgm" | "wizard" | null;

interface WorkspaceStore {
  readonly leftTab: LeftTab;
  readonly dialog: DialogId;
  readonly settingsSection: SettingsSection;
  readonly effectTool: EffectTool;
  readonly setLeftTab: (tab: LeftTab) => void;
  readonly openDialog: (dialog: Exclude<DialogId, null>) => void;
  readonly closeDialog: () => void;
  readonly openSettings: (section: SettingsSection) => void;
  readonly setEffectTool: (tool: EffectTool) => void;
}

export const useWorkspace = create<WorkspaceStore>()((set) => ({
  leftTab: "script",
  dialog: null,
  settingsSection: "general",
  effectTool: "select",
  setLeftTab: (leftTab) => set({ leftTab }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  openSettings: (settingsSection) => set({ dialog: "settings", settingsSection }),
  setEffectTool: (effectTool) => set({ effectTool }),
}));

export function resetWorkspace(): void {
  useWorkspace.setState({ leftTab: "script", dialog: null, effectTool: "select" });
}
