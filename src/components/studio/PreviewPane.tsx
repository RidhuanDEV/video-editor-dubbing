/**
 * Preview with the effect toolbar (PRD 10 §4.1: effects are a visible mode of the preview, not a
 * separate page). While a tool is active or an effect is selected, the frame is shown unzoomed
 * with the drag gizmo; otherwise it plays like the export.
 */
import { BadgeCheck, Droplets, MousePointer2, ZoomIn, type LucideIcon } from "lucide-react";
import { contentRect } from "../../project/effects";
import { useEditor } from "../../project/editor";
import type { Cue } from "../../project/subtitles";
import { isTrackLocked, segmentAt, type TimelineLayout } from "../../project/timeline";
import { useWorkspace, type EffectTool } from "../../project/workspace";
import type { ProjectManifest } from "../../types";
import { IconButton } from "../ui";
import { EffectGizmo } from "./EffectGizmo";
import { Preview } from "./Preview";

const TOOLS: ReadonlyArray<{ readonly id: EffectTool; readonly label: string; readonly shortcut: string; readonly icon: LucideIcon; readonly hint: string }> = [
  { id: "select", label: "Pilih", shortcut: "V", icon: MousePointer2, hint: "" },
  { id: "zoom", label: "Zoom", shortcut: "Z", icon: ZoomIn, hint: "Seret area yang ingin diperbesar pada video." },
  { id: "blur", label: "Blur sensor", shortcut: "B", icon: Droplets, hint: "Seret area yang ingin disamarkan (password, data pribadi)." },
  { id: "callout", label: "Badge langkah", shortcut: "N", icon: BadgeCheck, hint: "Klik posisi badge pada video." },
];

export function PreviewPane({ manifest, root, layout, cues, readOnly }: {
  readonly manifest: ProjectManifest;
  readonly root: string;
  readonly layout: TimelineLayout;
  readonly cues: ReadonlyArray<Cue>;
  readonly readOnly: boolean;
}) {
  const tool = useWorkspace((s) => s.effectTool);
  const setTool = useWorkspace((s) => s.setEffectTool);
  const selection = useEditor((s) => s.selection);
  // Index selector: re-renders when the scene under the playhead changes, not every frame.
  const segmentIndex = useEditor((s) => segmentAt(layout, s.playheadMs)?.index ?? -1);
  const segment = layout.segments[segmentIndex] ?? null;
  const clip = segment ? manifest.assets.find((a) => a.id === segment.scene.videoClipId) : undefined;
  const sourceW = clip?.width ?? manifest.canvas.width;
  const sourceH = clip?.height ?? manifest.canvas.height;
  const locked = readOnly || isTrackLocked(manifest.tracks, "effects");
  const editing = tool !== "select" || selection?.type === "effect";
  const activeTool = TOOLS.find((t) => t.id === tool);
  const hint = !segment && tool !== "select" ? "Pindahkan playhead ke sebuah scene dulu." : editing && tool === "select" ? "Mengedit efek terpilih. Esc untuk selesai." : activeTool?.hint ?? "";

  const gizmo = editing ? (
    <EffectGizmo
      manifest={manifest}
      segment={segment}
      tool={tool}
      onToolDone={() => setTool("select")}
      content={contentRect(manifest.canvas, sourceW, sourceH, manifest.canvas.fit)}
      sourceW={sourceW}
      sourceH={sourceH}
    />
  ) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line-subtle px-2" role="toolbar" aria-label="Alat efek">
        {TOOLS.map((t) => (
          <IconButton
            key={t.id}
            icon={t.icon}
            label={t.label}
            shortcut={t.shortcut}
            pressed={tool === t.id}
            disabled={t.id !== "select" && (locked || !segment)}
            onClick={() => setTool(t.id)}
          />
        ))}
        <span className="ml-2 truncate text-caption text-fg-2" aria-live="polite">
          {locked && tool === "select" && selection?.type !== "effect" ? "Track efek terkunci atau proyek baca-saja." : hint}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <Preview manifest={manifest} root={root} layout={layout} cues={cues} editMode={editing} gizmo={gizmo} />
      </div>
    </div>
  );
}
