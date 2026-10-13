/**
 * Studio (PRD 10 §4.1–4.2): the single workspace that replaces the six pages. Script/Media on
 * the left, preview with effect tools in the centre, contextual inspector on the right, timeline
 * below. Panels are resizable and remember their size.
 */
import { FileText, FolderOpen } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { useEditor } from "../../project/editor";
import { projectReadiness } from "../../project/readiness";
import { useSessionUi } from "../../project/session";
import type { OpenProject } from "../../project/store";
import { useCues } from "../../project/subtitleData";
import { layoutTimeline } from "../../project/timeline";
import { useWorkspace, type EffectTool } from "../../project/workspace";
import type { ProjectManifest } from "../../types";
import { Tabs } from "../ui";
import { ExportDialog } from "./ExportDialog";
import { Inspector } from "./Inspector";
import { MediaDragLayer } from "./MediaDragLayer";
import { MediaPanel } from "./MediaPanel";
import { PreviewPane } from "./PreviewPane";
import { AddBgmDialog, AddSceneDialog, PasteScriptDialog } from "./ScriptDialogs";
import { ScriptPanel } from "./ScriptPanel";
import { SetupWizard } from "./SetupWizard";
import { deleteSelection, splitAtPlayhead, Timeline } from "./Timeline";

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/** Keys pressed inside an overlay (dialog, menu, list) belong to that overlay, e.g. Esc closes it. */
function isInOverlay(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('[role="dialog"],[role="menu"],[role="listbox"],[cmdk-root]') !== null;
}

/** A focused control handles Space/Enter itself (e.g. a button press), so playback must not. */
function isControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "BUTTON" || target.getAttribute("role") !== null);
}

const TOOL_KEYS: Readonly<Record<string, EffectTool>> = { v: "select", z: "zoom", b: "blur", n: "callout" };

/** Transport, editing and tool keys (03 §3, §5.5); ignored while typing in a field or in a dialog. */
function useStudioShortcuts(manifest: ProjectManifest, durationMs: number): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (isTypingTarget(event.target) || isInOverlay(event.target) || useWorkspace.getState().dialog !== null) return;
      const editor = useEditor.getState();
      const frameMs = 1000 / manifest.canvas.fps;
      const seekBy = (deltaMs: number): void => {
        editor.setPlaying(false);
        editor.seek(editor.playheadMs + deltaMs, durationMs);
      };
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const tool = TOOL_KEYS[key];
      if (tool && !event.shiftKey) {
        useWorkspace.getState().setEffectTool(tool);
        event.preventDefault();
        return;
      }
      switch (key) {
        case " ":
          if (isControl(event.target)) return;
          editor.setPlaying(!editor.playing && durationMs > 0);
          break;
        case "k":
          editor.setPlaying(false);
          break;
        case "l":
          editor.setPlaying(durationMs > 0);
          break;
        case "j":
          seekBy(-1000);
          break;
        case "ArrowLeft":
          seekBy(-frameMs * (event.shiftKey ? 10 : 1));
          break;
        case "ArrowRight":
          seekBy(frameMs * (event.shiftKey ? 10 : 1));
          break;
        case "Home":
          seekBy(-editor.playheadMs);
          break;
        case "End":
          seekBy(durationMs - editor.playheadMs);
          break;
        case "c":
          splitAtPlayhead(manifest);
          break;
        case "Escape": {
          const workspace = useWorkspace.getState();
          if (workspace.effectTool !== "select") workspace.setEffectTool("select");
          else if (editor.selection !== null) editor.select(null);
          else return;
          break;
        }
        case "Delete":
        case "Backspace":
          // The scene track is magnetic, so Delete and Shift+Delete both ripple.
          if (!deleteSelection(manifest)) return;
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manifest, durationMs]);
}

const HANDLE_H = "relative w-px bg-line-subtle transition-colors duration-150 after:absolute after:inset-y-0 after:-left-1 after:w-2 hover:bg-accent data-[separator=active]:bg-accent";
const HANDLE_V = "relative h-px bg-line-subtle transition-colors duration-150 after:absolute after:inset-x-0 after:-top-1 after:h-2 hover:bg-accent data-[separator=active]:bg-accent";

export function Studio({ project }: { readonly project: OpenProject }) {
  const { manifest, root, readOnly } = project;
  const leftTab = useWorkspace((s) => s.leftTab);
  const setLeftTab = useWorkspace((s) => s.setLeftTab);
  const missing = useSessionUi((s) => s.missingAssetIds);
  const layout = useMemo(() => layoutTimeline(manifest), [manifest]);
  const cues = useCues(layout);
  const readiness = useMemo(() => projectReadiness(manifest, missing), [manifest, missing]);
  // Panel sizes are a per-user convenience (localStorage), not project data.
  const outer = useDefaultLayout({ id: "studio-rows" });
  const inner = useDefaultLayout({ id: "studio-columns" });
  useStudioShortcuts(manifest, layout.durationMs);

  const segmentOf = (sceneId: string) => layout.segments.find((s) => s.scene.id === sceneId) ?? null;

  return (
    <>
      <Group orientation="vertical" id="studio-rows" defaultLayout={outer.defaultLayout} onLayoutChanged={outer.onLayoutChanged} className="h-full">
        <Panel id="workspace" minSize="35%">
          <Group orientation="horizontal" id="studio-columns" defaultLayout={inner.defaultLayout} onLayoutChanged={inner.onLayoutChanged} className="h-full">
            <Panel id="left" defaultSize="24%" minSize={260} maxSize="40%" collapsible collapsedSize={0} className="bg-panel">
              <Tabs
                label="Naskah dan media"
                value={leftTab}
                onChange={setLeftTab}
                tabs={[
                  { value: "script", label: "Naskah", icon: FileText, badge: manifest.scenes.length },
                  { value: "media", label: "Media", icon: FolderOpen, badge: manifest.assets.length },
                ]}
                panels={{
                  script: <ScriptPanel manifest={manifest} layout={layout} readiness={readiness} readOnly={readOnly} />,
                  media: <MediaPanel manifest={manifest} root={root} readOnly={readOnly} />,
                }}
              />
            </Panel>
            <Separator className={HANDLE_H} />
            <Panel id="center" minSize="30%">
              <PreviewPane manifest={manifest} root={root} layout={layout} cues={cues} readOnly={readOnly} />
            </Panel>
            <Separator className={HANDLE_H} />
            <Panel id="right" defaultSize="24%" minSize={280} maxSize="40%" collapsible collapsedSize={0} className="bg-panel">
              <Inspector manifest={manifest} root={root} readOnly={readOnly} segment={segmentOf} />
            </Panel>
          </Group>
        </Panel>
        <Separator className={HANDLE_V} />
        <Panel id="timeline" defaultSize="30%" minSize={160} maxSize="60%">
          <Timeline manifest={manifest} cues={cues} onAddBgm={() => useWorkspace.getState().openDialog("addBgm")} />
        </Panel>
      </Group>

      <AddSceneDialog manifest={manifest} />
      <PasteScriptDialog manifest={manifest} />
      <AddBgmDialog manifest={manifest} />
      <ExportDialog manifest={manifest} readiness={readiness} readOnly={readOnly} layout={layout} cues={cues} />
      <SetupWizard manifest={manifest} />
      <MediaDragLayer />
    </>
  );
}
