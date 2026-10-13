/** Naskah page: scene list, scene editor, project voice, add scene and auto-chunk (03 §2.A). */
import { ArrowDown, ArrowUp, AudioLines, ListPlus, Plus, Trash2, WandSparkles } from "lucide-react";
import { useId, useState } from "react";
import { notify } from "../lib/notices";
import { autoChunk, titleFromNarration } from "../project/chunk";
import { buildScenes, insertScenes, moveScene, removeScene, setDefaultVoice } from "../project/commands";
import { fileNameOf } from "../project/manifest";
import { useProjectStore } from "../project/store";
import { sceneDurationMs, sceneSync } from "../project/sync";
import { synthesizeMissing, useSynthesis } from "../project/synthesis";
import { formatTimecode } from "../lib/format";
import type { MediaAsset } from "../types";
import { Dialog } from "./Dialog";
import { SceneEditor, VoiceFields } from "./SceneEditor";
import { SyncBadge } from "./SyncBadge";
import { Button, Field, IconButton, INPUT_CLASS } from "./ui";

function AssetSelect({ id, videos, value, onChange }: { readonly id: string; readonly videos: ReadonlyArray<MediaAsset>; readonly value: string; readonly onChange: (id: string) => void }) {
  return (
    <select id={id} className={`${INPUT_CLASS} pr-8`} value={value} onChange={(e) => onChange(e.target.value)}>
      {videos.map((v) => (
        <option key={v.id} value={v.id}>
          {fileNameOf(v.filePath)}
          {v.durationMs !== undefined ? ` (${formatTimecode(v.durationMs)})` : ""}
        </option>
      ))}
    </select>
  );
}

type DialogKind = "add" | "chunk" | null;

export function ScriptPage({ onGoToMedia }: { readonly onGoToMedia: () => void }) {
  const ids = { addAsset: useId(), chunkAsset: useId(), title: useId(), script: useId(), voice: useId() };
  const project = useProjectStore((s) => s.project);
  const execute = useProjectStore((s) => s.execute);
  const synthesis = useSynthesis((s) => s.byScene);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [assetId, setAssetId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [script, setScript] = useState("");
  const [batch, setBatch] = useState<{ readonly done: number; readonly total: number } | null>(null);

  if (!project) return null;
  const { manifest, readOnly } = project;
  const videos = manifest.assets.filter((a) => a.kind === "video");
  const selected = manifest.scenes.find((s) => s.id === selectedId) ?? manifest.scenes[0];
  const chosenAsset = videos.find((v) => v.id === assetId) ?? videos[0];
  const chunks = autoChunk(script);
  const totalMs = manifest.scenes.reduce((sum, s) => sum + sceneDurationMs(s, manifest.sceneGapMs), 0);
  const pendingCount = manifest.scenes.filter((s) => s.audioDurationMs === undefined && s.narration.trim() !== "").length;

  const openDialog = (kind: Exclude<DialogKind, null>): void => {
    if (videos.length === 0) {
      notify("info", "Impor video terlebih dahulu: setiap scene harus tertaut ke sebuah klip.");
      onGoToMedia();
      return;
    }
    setAssetId(videos[0]?.id ?? "");
    setDialog(kind);
  };

  const addScene = (): void => {
    if (!chosenAsset) return;
    const scenes = buildScenes(chosenAsset, [""], () => newTitle.trim() || `Scene ${manifest.scenes.length + 1}`);
    const index = selected ? manifest.scenes.indexOf(selected) + 1 : manifest.scenes.length;
    execute(insertScenes(manifest, scenes, index));
    setSelectedId(scenes[0]?.id ?? null);
    setNewTitle("");
    setDialog(null);
  };

  const createFromScript = (): void => {
    if (!chosenAsset || chunks.length === 0) return;
    const scenes = buildScenes(chosenAsset, chunks, (n) => titleFromNarration(n));
    execute(insertScenes(manifest, scenes));
    setSelectedId(scenes[0]?.id ?? null);
    setScript("");
    setDialog(null);
    notify("success", `${scenes.length} scene dibuat. Potongan klip dibagi rata; sesuaikan di tiap scene.`);
  };

  const synthesizeAll = async (): Promise<void> => {
    setBatch({ done: 0, total: pendingCount });
    const succeeded = await synthesizeMissing((done, total) => setBatch({ done, total }));
    setBatch(null);
    notify(succeeded === pendingCount ? "success" : "warning", `${succeeded} dari ${pendingCount} scene berhasil disintesis.`);
  };

  return (
    <div className="grid h-full grid-cols-[340px_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-line-subtle bg-panel" aria-label="Daftar scene">
        <div className="flex items-center gap-2 border-b border-line-subtle px-3 py-2">
          <h1 className="panel-title">Scene</h1>
          <span className="font-mono text-[12px] tabular text-fg-2">
            {manifest.scenes.length} · {formatTimecode(totalMs)}
          </span>
          <div className="ml-auto flex gap-1">
            <IconButton icon={WandSparkles} label="Auto-chunk naskah panjang" onClick={() => openDialog("chunk")} disabled={readOnly} />
            <IconButton icon={Plus} label="Tambah scene" onClick={() => openDialog("add")} disabled={readOnly} />
          </div>
        </div>

        {manifest.scenes.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-[14px] leading-[22px]">Belum ada scene.</p>
            <p className="text-[12px] text-fg-2">Tempel naskah lengkap untuk dipecah otomatis, atau tambah scene satu per satu.</p>
            <Button icon={ListPlus} onClick={() => openDialog("chunk")} disabled={readOnly}>
              Pecah naskah otomatis
            </Button>
          </div>
        ) : (
          <ol className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
            {manifest.scenes.map((scene, index) => {
              const active = scene.id === selected?.id;
              return (
                <li key={scene.id}>
                  <div
                    className={`group rounded-md border p-2.5 ${active ? "border-accent bg-selected" : "border-line-subtle bg-surface hover:bg-hover"}`}
                  >
                    <button
                      type="button"
                      className="block w-full text-left"
                      aria-current={active ? "true" : undefined}
                      onClick={() => setSelectedId(scene.id)}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="font-mono text-[12px] tabular text-fg-2">{String(index + 1).padStart(2, "0")}</span>
                        <span className="truncate text-[13px] font-medium">{scene.title || "(tanpa judul)"}</span>
                      </span>
                      <span className="mt-1 line-clamp-2 block text-[12px] text-fg-2">{scene.narration || "Narasi kosong"}</span>
                    </button>
                    <div className="mt-1.5 flex items-center gap-1">
                      <SyncBadge sync={sceneSync(scene)} synthesis={synthesis.get(scene.id)} />
                      <div className="ml-auto flex opacity-60 group-hover:opacity-100 focus-within:opacity-100">
                        <IconButton icon={ArrowUp} label="Pindah ke atas" disabled={readOnly || index === 0} onClick={() => execute(moveScene(manifest, scene.id, -1))} />
                        <IconButton
                          icon={ArrowDown}
                          label="Pindah ke bawah"
                          disabled={readOnly || index === manifest.scenes.length - 1}
                          onClick={() => execute(moveScene(manifest, scene.id, 1))}
                        />
                        <IconButton icon={Trash2} label="Hapus scene (bisa di-undo)" disabled={readOnly} onClick={() => execute(removeScene(manifest, scene.id))} />
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="space-y-3 border-t border-line-subtle p-3">
          <h2 className="panel-title">Suara default proyek</h2>
          <VoiceFields idPrefix={ids.voice} voice={manifest.defaultVoice} disabled={readOnly} onChange={(voice) => execute(setDefaultVoice(manifest, voice))} />
          <Button icon={AudioLines} className="w-full justify-center" disabled={readOnly || pendingCount === 0 || batch !== null} loading={batch !== null} onClick={() => void synthesizeAll()}>
            {batch ? `Menyintesis ${batch.done + 1}/${batch.total}…` : `Sintesis semua yang belum (${pendingCount})`}
          </Button>
        </div>
      </aside>

      <section className="min-h-0 overflow-auto" aria-label="Editor scene">
        {selected ? (
          <SceneEditor key={selected.id} scene={selected} />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-[13px] text-fg-2">Pilih atau buat scene untuk mulai menulis naskah.</div>
        )}
      </section>

      <Dialog
        open={dialog === "add"}
        title="Tambah scene"
        width="sm"
        onClose={() => setDialog(null)}
        actions={
          <>
            <Button onClick={() => setDialog(null)}>Batal</Button>
            <Button variant="primary" onClick={addScene} disabled={!chosenAsset}>
              Tambah scene
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field id={ids.title} label="Judul (opsional)">
            <input id={ids.title} className={INPUT_CLASS} value={newTitle} maxLength={255} onChange={(e) => setNewTitle(e.target.value)} />
          </Field>
          <Field id={ids.addAsset} label="Klip video" hint="Scene memakai seluruh durasi klip; potong di editor scene.">
            <AssetSelect id={ids.addAsset} videos={videos} value={chosenAsset?.id ?? ""} onChange={setAssetId} />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={dialog === "chunk"}
        title="Pecah naskah otomatis"
        width="lg"
        onClose={() => setDialog(null)}
        actions={
          <>
            <Button onClick={() => setDialog(null)}>Batal</Button>
            <Button variant="primary" onClick={createFromScript} disabled={!chosenAsset || chunks.length === 0}>
              Buat {chunks.length} scene
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field
            id={ids.script}
            label="Naskah lengkap"
            hint="Baris kosong memisahkan scene. Paragraf lebih dari 140 karakter dipecah per kalimat; singkatan seperti PT. dan No. tidak dipecah."
          >
            <textarea
              id={ids.script}
              className={`${INPUT_CLASS} h-56 resize-y py-2 text-[14px] leading-[22px]`}
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
          </Field>
          <Field id={ids.chunkAsset} label="Klip video untuk semua scene" hint="Durasi klip dibagi rata ke setiap scene sebagai titik awal.">
            <AssetSelect id={ids.chunkAsset} videos={videos} value={chosenAsset?.id ?? ""} onChange={setAssetId} />
          </Field>
          {chunks.length > 0 && (
            <ol className="max-h-48 space-y-1 overflow-auto rounded-sm border border-line-subtle bg-surface p-2 text-[12px]" aria-label="Pratinjau scene">
              {chunks.map((chunk, index) => (
                <li key={`${index}-${chunk.slice(0, 16)}`} className="flex gap-2">
                  <span className="font-mono tabular text-fg-2">{String(index + 1).padStart(2, "0")}</span>
                  <span>{chunk}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Dialog>
    </div>
  );
}
