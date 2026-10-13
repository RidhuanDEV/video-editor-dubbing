/**
 * Edit page (03 §5.1 default page) and Efek page: same preview + timeline layout. In "effects"
 * mode the preview shows the unzoomed frame with the effect gizmo and the effects panel.
 */
import { Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { notify } from "../../lib/notices";
import { addBgmTrack, removeBgmTrack, removeEffect, removeScene, updateBgmTrack } from "../../project/commands";
import { useEditor } from "../../project/editor";
import { fileNameOf } from "../../project/manifest";
import { useProjectStore } from "../../project/store";
import { useCues } from "../../project/subtitleData";
import { contentRect } from "../../project/effects";
import { EMPTY_LAYOUT, isTrackLocked, layoutTimeline, segmentAt } from "../../project/timeline";
import type { AudioTrackConfig, ProjectManifest } from "../../types";
import { Dialog } from "../Dialog";
import { SceneEditor } from "../SceneEditor";
import { Button, Field, INPUT_CLASS } from "../ui";
import { EffectGizmo, type EffectTool } from "./EffectGizmo";
import { EffectsPanel } from "./EffectsPanel";
import { Preview } from "./Preview";
import { splitAtPlayhead, Timeline } from "./Timeline";

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/** Transport and editing keys (03 §3, §5.5); ignored while typing in a field. */
function useEditShortcuts(manifest: ProjectManifest | null, durationMs: number): void {
  useEffect(() => {
    if (!manifest) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
      const editor = useEditor.getState();
      const frameMs = 1000 / manifest.canvas.fps;
      const seekBy = (deltaMs: number): void => {
        editor.setPlaying(false);
        editor.seek(editor.playheadMs + deltaMs, durationMs);
      };
      switch (event.key) {
        case " ":
          editor.setPlaying(!editor.playing && durationMs > 0);
          break;
        case "k":
        case "K":
          editor.setPlaying(false);
          break;
        case "l":
        case "L":
          editor.setPlaying(durationMs > 0);
          break;
        case "j":
        case "J":
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
        case "C":
          splitAtPlayhead(manifest);
          break;
        case "Delete":
        case "Backspace": {
          // The scene track is magnetic, so Delete and Shift+Delete both ripple.
          const selection = editor.selection;
          const store = useProjectStore.getState();
          if (selection?.type === "scene" && !isTrackLocked(manifest.tracks, "video")) store.execute(removeScene(manifest, selection.id));
          else if (selection?.type === "bgm" && !isTrackLocked(manifest.tracks, "bgm")) store.execute(removeBgmTrack(manifest, selection.id));
          else if (selection?.type === "effect" && !isTrackLocked(manifest.tracks, "effects")) store.execute(removeEffect(manifest, selection.sceneId, selection.id));
          else return;
          editor.select(null);
          break;
        }
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manifest, durationMs]);
}

export function BgmInspector({ manifest, track }: { readonly manifest: ProjectManifest; readonly track: AudioTrackConfig }) {
  const ids = { volume: useId(), duck: useId() };
  const execute = useProjectStore((s) => s.execute);
  const readOnly = useProjectStore((s) => s.project?.readOnly ?? true);
  const locked = isTrackLocked(manifest.tracks, "bgm") || readOnly;
  const set = (patch: Parameters<typeof updateBgmTrack>[2], key: string): void =>
    execute(updateBgmTrack(manifest, track.id, patch, "Ubah BGM", `bgm:${track.id}:${key}`));
  return (
    <div className="space-y-4 p-4">
      <h3 className="panel-title">BGM</h3>
      <p className="truncate text-[13px] font-medium" title={track.filePath}>
        {track.label}
      </p>
      <Field id={ids.volume} label={`Volume ${Math.round(track.volume * 100)}%`}>
        <input
          id={ids.volume}
          type="range"
          min={0}
          max={100}
          value={Math.round(track.volume * 100)}
          disabled={locked}
          onChange={(e) => set({ volume: e.target.valueAsNumber / 100 }, "volume")}
          className="w-full accent-[var(--accent)]"
        />
      </Field>
      <label className="flex min-h-6 items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          className="size-4 accent-[var(--accent)]"
          checked={track.autoDuck}
          disabled={locked}
          onChange={(e) => set({ autoDuck: e.target.checked }, "autoDuck")}
        />
        Ducking otomatis saat narasi
      </label>
      {track.autoDuck && (
        <Field id={ids.duck} label={`Volume saat ducking ${Math.round(track.duckVolume * 100)}%`} hint="Di preview hanya pendekatan; ekspor memakai sidechain FFmpeg.">
          <input
            id={ids.duck}
            type="range"
            min={0}
            max={100}
            value={Math.round(track.duckVolume * 100)}
            disabled={locked}
            onChange={(e) => set({ duckVolume: e.target.valueAsNumber / 100 }, "duck")}
            className="w-full accent-[var(--accent)]"
          />
        </Field>
      )}
      <Button
        icon={Trash2}
        disabled={locked}
        onClick={() => {
          execute(removeBgmTrack(manifest, track.id));
          useEditor.getState().select(null);
        }}
      >
        Hapus BGM (bisa di-undo)
      </Button>
    </div>
  );
}

export function EditPage({ mode, onOpenEffects }: { readonly mode: "edit" | "effects"; readonly onOpenEffects: () => void }) {
  const assetFieldId = useId();
  const [tool, setTool] = useState<EffectTool>("select");
  const project = useProjectStore((s) => s.project);
  const execute = useProjectStore((s) => s.execute);
  const selection = useEditor((s) => s.selection);
  const [bgmDialog, setBgmDialog] = useState(false);
  const [bgmAssetId, setBgmAssetId] = useState("");
  const manifest = project?.manifest;
  const layout = useMemo(() => (manifest ? layoutTimeline(manifest) : EMPTY_LAYOUT), [manifest]);
  const cues = useCues(layout);
  // Index selector: re-renders when the scene under the playhead changes, not every frame.
  const segmentIndex = useEditor((s) => segmentAt(layout, s.playheadMs)?.index ?? -1);
  useEditShortcuts(manifest ?? null, layout.durationMs);

  if (!project || !manifest) return null;
  const segment = layout.segments[segmentIndex] ?? null;
  const clip = segment ? manifest.assets.find((a) => a.id === segment.scene.videoClipId) : undefined;
  const sourceW = clip?.width ?? manifest.canvas.width;
  const sourceH = clip?.height ?? manifest.canvas.height;
  const gizmo =
    mode === "effects" ? (
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
  const audioAssets = manifest.assets.filter((a) => a.kind === "audio" && a.durationMs !== undefined);
  const selectedScene = selection?.type === "scene" ? manifest.scenes.find((s) => s.id === selection.id) : undefined;
  const selectedBgm = selection?.type === "bgm" ? manifest.bgmTracks.find((t) => t.id === selection.id) : undefined;
  const chosenAudio = audioAssets.find((a) => a.id === bgmAssetId) ?? audioAssets[0];

  const openBgmDialog = (): void => {
    if (audioAssets.length === 0) {
      notify("info", "Impor file musik (MP3/WAV/M4A) di halaman Media terlebih dahulu.");
      return;
    }
    setBgmAssetId(audioAssets[0]?.id ?? "");
    setBgmDialog(true);
  };

  const addBgm = (): void => {
    if (!chosenAudio) return;
    execute(addBgmTrack(chosenAudio, useEditor.getState().playheadMs, fileNameOf(chosenAudio.filePath)));
    setBgmDialog(false);
  };

  return (
    <div className="grid h-full grid-cols-[1fr_360px] grid-rows-[minmax(0,1fr)_260px] gap-px bg-line-subtle">
      <section className="min-h-0 bg-app" aria-label="Preview">
        <Preview manifest={manifest} root={project.root} layout={layout} cues={cues} editMode={mode === "effects"} gizmo={gizmo} />
      </section>

      <aside className="min-h-0 overflow-auto bg-panel" aria-label="Inspector">
        {mode === "effects" ? (
          <EffectsPanel manifest={manifest} segment={segment} tool={tool} onTool={setTool} />
        ) : selection?.type === "effect" ? (
          <div className="space-y-3 p-4 text-[13px]">
            <p className="text-fg-2">Efek diedit di halaman Efek, lengkap dengan gizmo di preview.</p>
            <Button onClick={onOpenEffects}>Buka halaman Efek</Button>
          </div>
        ) : selectedScene ? (
          <SceneEditor key={selectedScene.id} scene={selectedScene} />
        ) : selectedBgm ? (
          <BgmInspector manifest={manifest} track={selectedBgm} />
        ) : (
          <p className="p-4 text-[13px] text-fg-2">Pilih klip di timeline untuk melihat propertinya.</p>
        )}
      </aside>

      <section className="col-span-2 min-h-0" aria-label="Timeline">
        <Timeline manifest={manifest} cues={cues} onAddBgm={openBgmDialog} />
      </section>

      <Dialog
        open={bgmDialog}
        title="Tambah BGM"
        width="sm"
        onClose={() => setBgmDialog(false)}
        actions={
          <>
            <Button onClick={() => setBgmDialog(false)}>Batal</Button>
            <Button variant="primary" onClick={addBgm} disabled={!chosenAudio}>
              Tambah di playhead
            </Button>
          </>
        }
      >
        <Field id={assetFieldId} label="File audio" hint="BGM ditempatkan mulai posisi playhead dan dapat digeser di timeline.">
          <select id={assetFieldId} className={`${INPUT_CLASS} pr-8`} value={chosenAudio?.id ?? ""} onChange={(e) => setBgmAssetId(e.target.value)}>
            {audioAssets.map((a) => (
              <option key={a.id} value={a.id}>
                {fileNameOf(a.filePath)}
              </option>
            ))}
          </select>
        </Field>
      </Dialog>
    </div>
  );
}
