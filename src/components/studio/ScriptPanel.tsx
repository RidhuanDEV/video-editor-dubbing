/**
 * Script panel (PRD 10 §4.2): the script is the main editing surface (Descript-style). Each scene
 * card shows its narration; the selected card edits title and narration in place. Clicking a
 * card selects the scene and moves the playhead to it. The "Langkah berikutnya" card always
 * names the one next step.
 */
import { ArrowDown, ArrowUp, AudioLines, ClipboardPaste, FileText, Film, Import, Link2, Play, Plus, Trash2, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { formatTimecode } from "../../lib/format";
import { moveScene, removeScene, updateScene } from "../../project/commands";
import { useEditor } from "../../project/editor";
import { importMedia, relinkMissingFromFolder } from "../../project/mediaActions";
import { useMediaDrag } from "../../project/mediaDrag";
import type { Readiness, ReadinessAction } from "../../project/readiness";
import { useProjectStore } from "../../project/store";
import { estimateNarrationMs, formatSeconds, sceneSync } from "../../project/sync";
import { pendingSceneIds, synthesizeAll, synthesizeScene, useSynthesis } from "../../project/synthesis";
import type { TimelineLayout } from "../../project/timeline";
import { executeWithUndo } from "../../project/undoable";
import { useWorkspace } from "../../project/workspace";
import type { ProjectManifest, ScriptScene } from "../../types";
import { SyncBadge } from "../SyncBadge";
import { Button, ContextMenu, EmptyState, INPUT_CLASS, type MenuItem } from "../ui";

const ACTION_ICON: Readonly<Record<ReadinessAction, LucideIcon>> = {
  importMedia: Import,
  addScript: ClipboardPaste,
  relink: Link2,
  selectEmptyScene: FileText,
  synthesize: AudioLines,
};

/** Runs the fix for a readiness item. Shared with the status bar and the export dialog. */
export function runReadinessAction(action: ReadinessAction, manifest: ProjectManifest): void {
  const workspace = useWorkspace.getState();
  switch (action) {
    case "importMedia":
      workspace.setLeftTab("media");
      void importMedia("dialog");
      break;
    case "addScript":
      workspace.setLeftTab("script");
      workspace.openDialog("pasteScript");
      break;
    case "relink":
      workspace.setLeftTab("media");
      void relinkMissingFromFolder();
      break;
    case "selectEmptyScene": {
      workspace.setLeftTab("script");
      const empty = manifest.scenes.find((s) => s.narration.trim() === "");
      if (empty) useEditor.getState().select({ type: "scene", id: empty.id });
      break;
    }
    case "synthesize":
      void synthesizeAll();
      break;
  }
}

function NextStep({ readiness, manifest, readOnly }: { readonly readiness: Readiness; readonly manifest: ProjectManifest; readonly readOnly: boolean }) {
  const batch = useSynthesis((s) => s.batch);
  const next = readiness.next;
  if (!next || readOnly) return null;
  const Icon = ACTION_ICON[next.action];
  const busy = next.action === "synthesize" && batch !== null;
  return (
    <div className="m-2 rounded-md border border-accent/40 bg-accent-subtle/40 p-3" role="status">
      <p className="text-caption font-semibold text-accent">
        Langkah berikutnya · {readiness.done}/{readiness.total}
      </p>
      <p className="mt-0.5 text-ui">{next.label}</p>
      <Button size="sm" variant="primary" icon={Icon} className="mt-2" loading={busy} onClick={() => runReadinessAction(next.action, manifest)}>
        {busy && batch ? `Menyintesis ${batch.done + 1}/${batch.total}…` : next.actionLabel}
      </Button>
    </div>
  );
}

function SceneCard({ manifest, scene, index, startMs, selected, readOnly }: {
  readonly manifest: ProjectManifest;
  readonly scene: ScriptScene;
  readonly index: number;
  readonly startMs: number;
  readonly selected: boolean;
  readonly readOnly: boolean;
}) {
  const execute = useProjectStore((s) => s.execute);
  const synthesis = useSynthesis((s) => s.byScene.get(scene.id));
  const dropHere = useMediaDrag((s) => s.target === `scene:${scene.id}`);
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const select = (): void => {
    const editor = useEditor.getState();
    editor.select({ type: "scene", id: scene.id });
    editor.setPlaying(false);
    editor.seek(startMs, Number.MAX_SAFE_INTEGER);
  };
  const edit = (patch: Parameters<typeof updateScene>[2], field: string): void => execute(updateScene(manifest, scene.id, patch, `scene:${scene.id}:${field}`));
  const onNarrationKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void synthesizeScene(scene.id);
    }
  };

  const items: ReadonlyArray<MenuItem> = [
    {
      label: "Putar dari sini",
      icon: Play,
      onSelect: () => {
        select();
        useEditor.getState().setPlaying(true);
      },
    },
    { label: scene.audioDurationMs === undefined ? "Sintesis suara" : "Sintesis ulang", icon: AudioLines, disabled: readOnly || scene.narration.trim() === "", onSelect: () => void synthesizeScene(scene.id) },
    { label: "Pindah ke atas", icon: ArrowUp, disabled: readOnly || index === 0, onSelect: () => execute(moveScene(manifest, scene.id, -1)) },
    { label: "Pindah ke bawah", icon: ArrowDown, disabled: readOnly || index === manifest.scenes.length - 1, onSelect: () => execute(moveScene(manifest, scene.id, 1)) },
    { label: "Hapus scene", icon: Trash2, shortcut: "Delete", danger: true, disabled: readOnly, onSelect: () => executeWithUndo(removeScene(manifest, scene.id), `Scene ${index + 1} dihapus.`) },
  ];

  return (
    <ContextMenu items={items}>
      <li
        ref={ref}
        data-drop={`scene:${scene.id}`}
        className={`group rounded-md border transition-colors duration-150 ${selected ? "border-accent bg-selected" : "border-line-subtle bg-surface hover:border-line hover:bg-hover"} ${
          dropHere ? "outline-2 outline-offset-1 outline-accent" : ""
        }`}
      >
        <button type="button" className="flex w-full items-center gap-2 px-2.5 pt-2 text-left" aria-current={selected ? "true" : undefined} onClick={select}>
          <span className="font-mono text-caption tabular text-fg-2">{String(index + 1).padStart(2, "0")}</span>
          <span className="min-w-0 flex-1 truncate text-ui font-medium">{scene.title || "(tanpa judul)"}</span>
          <span className="font-mono text-caption tabular text-fg-muted">{formatTimecode(startMs)}</span>
        </button>
        {selected ? (
          <div className="space-y-2 px-2.5 pt-2 pb-2.5">
            <input
              aria-label={`Judul scene ${index + 1}`}
              className={INPUT_CLASS}
              value={scene.title}
              maxLength={255}
              placeholder="Judul scene"
              disabled={readOnly}
              onChange={(e) => edit({ title: e.target.value }, "title")}
            />
            <textarea
              aria-label={`Narasi scene ${index + 1}`}
              className={`${INPUT_CLASS} h-auto min-h-28 resize-y py-2 text-body`}
              value={scene.narration}
              placeholder="Tulis narasi yang akan dibacakan…"
              disabled={readOnly}
              // A narration edit drops the old audio; the badge then says "Belum ada suara".
              onChange={(e) => edit({ narration: e.target.value }, "narration")}
              onKeyDown={onNarrationKey}
              rows={Math.min(12, Math.max(4, Math.ceil(scene.narration.length / 48)))}
            />
            <div className="flex flex-wrap items-center gap-2">
              <SyncBadge sync={sceneSync(scene)} synthesis={synthesis} />
              <span className="text-caption text-fg-muted">
                {scene.narration.length} karakter · ±{formatSeconds(estimateNarrationMs(scene.narration))}
              </span>
            </div>
            {synthesis?.state === "error" && <p className="text-caption text-danger">{synthesis.error.message}</p>}
          </div>
        ) : (
          <button type="button" tabIndex={-1} className="block w-full px-2.5 pt-1 pb-2 text-left" onClick={select}>
            <span className={`line-clamp-2 block text-caption ${scene.narration.trim() === "" ? "text-fg-muted italic" : "text-fg-2"}`}>
              {scene.narration.trim() === "" ? "Narasi kosong" : scene.narration}
            </span>
            <span className="mt-1.5 block">
              <SyncBadge sync={sceneSync(scene)} synthesis={synthesis} />
            </span>
          </button>
        )}
      </li>
    </ContextMenu>
  );
}

export function ScriptPanel({ manifest, layout, readiness, readOnly }: {
  readonly manifest: ProjectManifest;
  readonly layout: TimelineLayout;
  readonly readiness: Readiness;
  readonly readOnly: boolean;
}) {
  const selection = useEditor((s) => s.selection);
  const batch = useSynthesis((s) => s.batch);
  const openDialog = useWorkspace((s) => s.openDialog);
  const dropList = useMediaDrag((s) => s.target === "scenes");
  const hasVideo = manifest.assets.some((a) => a.kind === "video");
  const pending = pendingSceneIds(manifest.scenes).length;

  if (manifest.scenes.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <NextStep readiness={readiness} manifest={manifest} readOnly={readOnly} />
        {hasVideo ? (
          <EmptyState
            icon={FileText}
            title="Belum ada naskah"
            actions={
              <>
                <Button variant="primary" icon={ClipboardPaste} disabled={readOnly} onClick={() => openDialog("pasteScript")}>
                  Tempel naskah
                </Button>
                <Button icon={Plus} disabled={readOnly} onClick={() => openDialog("addScene")}>
                  Scene kosong
                </Button>
              </>
            }
          >
            Tempel naskah lengkap; setiap paragraf menjadi satu scene dengan potongan rekaman sendiri.
          </EmptyState>
        ) : (
          <EmptyState icon={Film} title="Impor rekaman dulu">
            Setiap scene memakai potongan dari rekaman layar. Impor video di tab Media, atau seret file ke jendela ini.
          </EmptyState>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <NextStep readiness={readiness} manifest={manifest} readOnly={readOnly} />
      <ol data-drop="scenes" className={`min-h-0 flex-1 space-y-1.5 overflow-auto px-2 pb-2 ${dropList ? "bg-accent-subtle/30" : ""}`} aria-label="Daftar scene">
        {manifest.scenes.map((scene, index) => (
          <SceneCard
            key={scene.id}
            manifest={manifest}
            scene={scene}
            index={index}
            startMs={layout.segments[index]?.startMs ?? 0}
            selected={selection?.type === "scene" && selection.id === scene.id}
            readOnly={readOnly}
          />
        ))}
      </ol>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-line-subtle p-2">
        <Button size="sm" icon={Plus} disabled={readOnly} onClick={() => openDialog("addScene")}>
          Scene
        </Button>
        <Button size="sm" icon={ClipboardPaste} disabled={readOnly} onClick={() => openDialog("pasteScript")}>
          Tempel naskah
        </Button>
        {pending > 0 && (
          <Button size="sm" variant="ghost" icon={AudioLines} className="ml-auto" loading={batch !== null} disabled={readOnly} onClick={() => void synthesizeAll()}>
            {batch ? `${batch.done + 1}/${batch.total}` : `Sintesis ${pending}`}
          </Button>
        )}
      </div>
    </div>
  );
}
