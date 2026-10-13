// @vitest-environment jsdom
/**
 * Automated accessibility check (PRD 10 §7, 08 §9): renders the start screen and the full Studio
 * with a sample project and runs axe. Colour contrast is excluded here (jsdom has no layout);
 * it is covered by tests/tokens-contrast.test.ts.
 */
import axe from "axe-core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createManifest } from "../project/manifest";
import { useProjectStore } from "../project/store";
import type { MediaAsset, ProjectManifest, ScriptScene } from "../types";
import { StartScreen } from "./shell/StartScreen";
import { StatusBar } from "./shell/StatusBar";
import { TitleBar } from "./shell/TitleBar";
import { Studio } from "./studio/Studio";
import { TooltipProvider } from "./ui";

// jsdom lacks these browser APIs; the components only need them to exist.
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  Object.assign(globalThis, { ResizeObserver: NoopResizeObserver, IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(window, { __TAURI_INTERNALS__: { convertFileSrc: (path: string) => `data:,${encodeURIComponent(path)}` } });
  Object.assign(Element.prototype, { scrollIntoView: () => undefined });
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

/** Renders and lets pending effects/promises (e.g. the recent-projects load) settle. */
async function render(node: ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  host = container;
  document.body.append(container);
  const created = createRoot(container);
  root = created;
  await act(async () => created.render(<TooltipProvider>{node}</TooltipProvider>));
  return container;
}

async function violations(container: HTMLElement): Promise<ReadonlyArray<string>> {
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return result.violations
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`);
}

const video: MediaAsset = { id: "v1", kind: "video", filePath: "C:/rec/login.mp4", durationMs: 20_000, width: 1920, height: 1080 };

function scene(id: string, order: number, narration: string): ScriptScene {
  return { id, order, title: `Scene ${order + 1}`, narration, videoClipId: "v1", videoTrimStartMs: 0, videoTrimEndMs: 5000, playbackRate: 1, alignmentMode: "freeze-frame", effects: [] };
}

function sampleManifest(): ProjectManifest {
  return { ...createManifest("A11y"), assets: [video], scenes: [scene("s1", 0, "Buka portal."), scene("s2", 1, "")] };
}

describe("accessibility (axe)", () => {
  it("start screen has no violations", async () => {
    const container = await render(
      <>
        <TitleBar />
        <StartScreen />
        <StatusBar />
      </>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it("studio has no violations", async () => {
    act(() => useProjectStore.getState().open({ root: "C:/p/A.smbproj", manifest: sampleManifest(), readOnly: false }));
    const project = useProjectStore.getState().project;
    if (!project) throw new Error("project not open");
    const container = await render(
      <>
        <TitleBar />
        <Studio project={project} />
        <StatusBar />
      </>,
    );
    expect(await violations(container)).toEqual([]);
  });
});
