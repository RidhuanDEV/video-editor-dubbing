import { beforeEach, describe, expect, it } from "vitest";
import { isBrowserShortcut } from "../lib/desktop";
import { useNotices } from "../lib/notices";
import type { ProjectManifest } from "../types";
import { removeScene, updateScene } from "./commands";
import { createManifest } from "./manifest";
import { useProjectStore } from "./store";
import { executeWithUndo } from "./undoable";

function manifestWithScenes(): ProjectManifest {
  const scene = {
    order: 0,
    narration: "Narasi",
    videoClipId: "asset",
    videoTrimStartMs: 0,
    videoTrimEndMs: 4000,
    playbackRate: 1,
    alignmentMode: "freeze-frame",
    effects: [],
  } satisfies Omit<ProjectManifest["scenes"][number], "id" | "title">;
  return { ...createManifest("Uji"), scenes: [{ ...scene, id: "a", title: "A" }, { ...scene, id: "b", title: "B" }] };
}

function current(): ProjectManifest {
  const project = useProjectStore.getState().project;
  if (!project) throw new Error("no project open");
  return project.manifest;
}

function lastAction(): (() => void) | undefined {
  return useNotices.getState().notices.at(-1)?.action?.run;
}

describe("executeWithUndo", () => {
  beforeEach(() => {
    useNotices.setState({ notices: [] });
    useProjectStore.getState().open({ root: "C:/p", manifest: manifestWithScenes(), readOnly: false });
  });

  it("deletes immediately and the toast action restores it", () => {
    executeWithUndo(removeScene(current(), "a"), "Scene dihapus.");
    expect(current().scenes.map((s) => s.id)).toEqual(["b"]);
    expect(useNotices.getState().notices.at(-1)?.action?.label).toBe("Urungkan");
    lastAction()?.();
    expect(current().scenes.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("does not undo a later, unrelated edit", () => {
    executeWithUndo(removeScene(current(), "a"), "Scene dihapus.");
    const undoDelete = lastAction();
    useProjectStore.getState().execute(updateScene(current(), "b", { title: "B2" }));
    undoDelete?.();
    expect(current().scenes.map((s) => s.title)).toEqual(["B2"]);
  });

  it("offers no undo when the project is read-only", () => {
    useProjectStore.getState().open({ root: "C:/p", manifest: manifestWithScenes(), readOnly: true });
    executeWithUndo(removeScene(current(), "a"), "Scene dihapus.");
    expect(current().scenes).toHaveLength(2);
    expect(useNotices.getState().notices).toHaveLength(0);
  });
});

describe("isBrowserShortcut", () => {
  const key = (k: string, mods: { ctrl?: boolean; alt?: boolean } = {}) => ({ key: k, ctrlKey: mods.ctrl === true, metaKey: false, altKey: mods.alt === true });

  it("blocks reload, print, find and history navigation", () => {
    expect(isBrowserShortcut(key("F5"))).toBe(true);
    expect(isBrowserShortcut(key("r", { ctrl: true }))).toBe(true);
    expect(isBrowserShortcut(key("P", { ctrl: true }))).toBe(true);
    expect(isBrowserShortcut(key("ArrowLeft", { alt: true }))).toBe(true);
  });

  it("leaves app shortcuts alone", () => {
    expect(isBrowserShortcut(key("s", { ctrl: true }))).toBe(false);
    expect(isBrowserShortcut(key("z", { ctrl: true }))).toBe(false);
    expect(isBrowserShortcut(key("ArrowLeft"))).toBe(false);
    expect(isBrowserShortcut(key("r"))).toBe(false);
  });
});
