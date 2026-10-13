/**
 * Project store: the open manifest plus command history (F-CORE-1). History is per session and
 * never persisted (03 §5.4); crash recovery uses the autosave instead.
 */
import { create } from "zustand";
import type { ProjectManifest, ScriptScene } from "../types";
import { coalesce, type Command } from "./commands";

export const HISTORY_LIMIT = 100;
/** Edits to the same field within this window form one undo step. */
export const COALESCE_WINDOW_MS = 1500;

export interface OpenProject {
  readonly root: string;
  readonly manifest: ProjectManifest;
  readonly readOnly: boolean;
}

export type SceneAudio = Required<Pick<ScriptScene, "audioDurationMs" | "audioCachePath" | "audioSha256">>;

interface ProjectStore {
  readonly project: OpenProject | null;
  readonly past: ReadonlyArray<Command>;
  readonly future: ReadonlyArray<Command>;
  /** Incremented on every manifest change; dirty when it differs from `savedRevision`. */
  readonly revision: number;
  readonly savedRevision: number;
  readonly lastEdit: { readonly key: string; readonly at: number } | null;

  readonly open: (project: OpenProject, options?: { readonly dirty?: boolean }) => void;
  readonly close: () => void;
  readonly execute: (command: Command | null, now?: number) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  /** Attaches synthesized audio. Not undoable: synthesis is a side effect, not an edit. */
  readonly setSceneAudio: (sceneId: string, audio: SceneAudio) => void;
  /** Records a generated preview proxy. Not undoable: it is a cache, not an edit. */
  readonly setAssetProxy: (assetId: string, proxyPath: string) => void;
  readonly markSaved: (revision: number, updatedAt: string) => void;
}

const EMPTY_HISTORY: Pick<ProjectStore, "past" | "future" | "lastEdit"> = { past: [], future: [], lastEdit: null };

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  project: null,
  ...EMPTY_HISTORY,
  revision: 0,
  savedRevision: 0,

  open: (project, options) =>
    set((state) => {
      const revision = state.revision + 1;
      return { project, ...EMPTY_HISTORY, revision, savedRevision: options?.dirty === true ? revision - 1 : revision };
    }),

  close: () => set((state) => ({ project: null, ...EMPTY_HISTORY, revision: state.revision + 1, savedRevision: state.revision + 1 })),

  execute: (command, now = Date.now()) => {
    const { project, past, lastEdit } = get();
    if (!command || !project || project.readOnly) return;
    const manifest = command.apply(project.manifest);
    const previous = past[past.length - 1];
    const merges =
      command.coalesceKey !== undefined &&
      previous !== undefined &&
      lastEdit !== null &&
      lastEdit.key === command.coalesceKey &&
      now - lastEdit.at <= COALESCE_WINDOW_MS;
    const nextPast = merges ? [...past.slice(0, -1), coalesce(previous, command)] : [...past, command].slice(-HISTORY_LIMIT);
    set((state) => ({
      project: { ...project, manifest },
      past: nextPast,
      future: [],
      lastEdit: command.coalesceKey === undefined ? null : { key: command.coalesceKey, at: now },
      revision: state.revision + 1,
    }));
  },

  undo: () => {
    const { project, past, future } = get();
    const command = past[past.length - 1];
    if (!project || !command) return;
    set((state) => ({
      project: { ...project, manifest: command.revert(project.manifest) },
      past: past.slice(0, -1),
      future: [command, ...future],
      lastEdit: null,
      revision: state.revision + 1,
    }));
  },

  redo: () => {
    const { project, past, future } = get();
    const [command, ...rest] = future;
    if (!project || !command) return;
    set((state) => ({
      project: { ...project, manifest: command.apply(project.manifest) },
      past: [...past, command],
      future: rest,
      lastEdit: null,
      revision: state.revision + 1,
    }));
  },

  setSceneAudio: (sceneId, audio) => {
    const { project } = get();
    if (!project) return;
    const scenes = project.manifest.scenes.map((s) => (s.id === sceneId ? { ...s, ...audio } : s));
    set((state) => ({ project: { ...project, manifest: { ...project.manifest, scenes } }, revision: state.revision + 1 }));
  },

  setAssetProxy: (assetId, proxyPath) => {
    const { project } = get();
    if (!project) return;
    const assets = project.manifest.assets.map((a) => (a.id === assetId ? { ...a, proxyPath } : a));
    set((state) => ({ project: { ...project, manifest: { ...project.manifest, assets } }, revision: state.revision + 1 }));
  },

  markSaved: (revision, updatedAt) => {
    const { project } = get();
    if (!project) return;
    // Only the timestamp changes; a concurrent edit after the save keeps the store dirty.
    set({ project: { ...project, manifest: { ...project.manifest, updatedAt } }, savedRevision: revision });
  },
}));

export function isDirty(state: Pick<ProjectStore, "revision" | "savedRevision">): boolean {
  return state.revision !== state.savedRevision;
}
