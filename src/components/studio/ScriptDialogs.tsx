/** Studio dialogs for adding content: one scene, a whole pasted script, background music. */
import { Import } from "lucide-react";
import { useId, useState } from "react";
import { autoChunk, titleFromNarration } from "../../project/chunk";
import { buildScenes, insertScenes } from "../../project/commands";
import { useEditor } from "../../project/editor";
import { fileNameOf } from "../../project/manifest";
import { addAsBgm, importMedia } from "../../project/mediaActions";
import { useProjectStore } from "../../project/store";
import { synthesizeAll } from "../../project/synthesis";
import { useWorkspace } from "../../project/workspace";
import type { MediaAsset, ProjectManifest } from "../../types";
import { Dialog } from "../Dialog";
import { Button, Checkbox, Field, INPUT_CLASS, Select } from "../ui";
import { clipOption } from "./fields";

/** Shown instead of a clip picker when no video is imported yet: scenes need a clip. */
function NeedsVideo({ onImported }: { readonly onImported: (asset: MediaAsset) => void }) {
  return (
    <div className="space-y-2 rounded-md border border-line-subtle bg-surface p-3">
      <p className="text-ui">Setiap scene memakai potongan rekaman. Impor rekaman layar dulu.</p>
      <Button
        icon={Import}
        onClick={() =>
          void importMedia("dialog").then((assets) => {
            const video = assets.find((a) => a.kind === "video");
            if (video) onImported(video);
          })
        }
      >
        Impor video
      </Button>
    </div>
  );
}

/** Splits a pasted script into scenes over one recording (also used by the setup wizard). */
export function PasteScriptFields({ manifest, script, onScript, assetId, onAsset, idPrefix }: {
  readonly manifest: ProjectManifest;
  readonly script: string;
  readonly onScript: (script: string) => void;
  readonly assetId: string;
  readonly onAsset: (id: string) => void;
  readonly idPrefix: string;
}) {
  const videos = manifest.assets.filter((a) => a.kind === "video");
  const chunks = autoChunk(script);
  return (
    <div className="space-y-3">
      <Field
        id={`${idPrefix}-script`}
        label="Naskah lengkap"
        hint="Baris kosong memisahkan scene. Paragraf lebih dari 140 karakter dipecah per kalimat; singkatan seperti PT. dan No. tidak dipecah."
      >
        <textarea id={`${idPrefix}-script`} className={`${INPUT_CLASS} h-48 resize-y py-2 text-body`} value={script} onChange={(e) => onScript(e.target.value)} />
      </Field>
      {videos.length === 0 ? (
        <NeedsVideo onImported={(video) => onAsset(video.id)} />
      ) : (
        <Field id={`${idPrefix}-clip`} label="Rekaman untuk scene ini" hint="Durasi rekaman dibagi rata ke setiap scene sebagai titik awal; sesuaikan di timeline.">
          <Select id={`${idPrefix}-clip`} value={assetId || (videos[0]?.id ?? "")} options={videos.map(clipOption)} onChange={onAsset} />
        </Field>
      )}
      {chunks.length > 0 && (
        <ol className="max-h-40 space-y-1 overflow-auto rounded-sm border border-line-subtle bg-surface p-2 text-caption" aria-label="Pratinjau scene">
          {chunks.map((chunk, index) => (
            <li key={`${index}-${chunk.slice(0, 16)}`} className="flex gap-2">
              <span className="font-mono tabular text-fg-2">{String(index + 1).padStart(2, "0")}</span>
              <span>{chunk}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Creates the scenes from a pasted script on the current manifest; returns how many were added. */
export function createScenesFromScript(script: string, assetId: string): number {
  const manifest = useProjectStore.getState().project?.manifest;
  if (!manifest) return 0;
  const asset = manifest.assets.find((a) => a.id === assetId) ?? manifest.assets.find((a) => a.kind === "video");
  const chunks = autoChunk(script);
  if (!asset || chunks.length === 0) return 0;
  const scenes = buildScenes(asset, chunks, (n) => titleFromNarration(n));
  useProjectStore.getState().execute(insertScenes(manifest, scenes));
  const first = scenes[0];
  if (first) useEditor.getState().select({ type: "scene", id: first.id });
  return scenes.length;
}

export function PasteScriptDialog({ manifest }: { readonly manifest: ProjectManifest }) {
  const idPrefix = useId();
  const open = useWorkspace((s) => s.dialog === "pasteScript");
  const close = useWorkspace((s) => s.closeDialog);
  const [script, setScript] = useState("");
  const [assetId, setAssetId] = useState("");
  const [synthesize, setSynthesize] = useState(true);
  const chunks = autoChunk(script);
  const hasVideo = manifest.assets.some((a) => a.kind === "video");

  const submit = (): void => {
    if (createScenesFromScript(script, assetId) === 0) return;
    setScript("");
    close();
    if (synthesize) void synthesizeAll();
  };

  return (
    <Dialog
      open={open}
      title="Tempel naskah"
      width="lg"
      onClose={close}
      actions={
        <>
          <Button onClick={close}>Batal</Button>
          <Button variant="primary" onClick={submit} disabled={!hasVideo || chunks.length === 0}>
            Buat {chunks.length} scene
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <PasteScriptFields manifest={manifest} script={script} onScript={setScript} assetId={assetId} onAsset={setAssetId} idPrefix={idPrefix} />
        <Checkbox checked={synthesize} onChange={setSynthesize}>
          Langsung buat suara untuk semua scene baru
        </Checkbox>
      </div>
    </Dialog>
  );
}

export function AddSceneDialog({ manifest }: { readonly manifest: ProjectManifest }) {
  const ids = { title: useId(), clip: useId() };
  const open = useWorkspace((s) => s.dialog === "addScene");
  const close = useWorkspace((s) => s.closeDialog);
  const execute = useProjectStore((s) => s.execute);
  const selection = useEditor((s) => s.selection);
  const [title, setTitle] = useState("");
  const [assetId, setAssetId] = useState("");
  const videos = manifest.assets.filter((a) => a.kind === "video");
  const asset = videos.find((v) => v.id === assetId) ?? videos[0];

  const submit = (): void => {
    if (!asset) return;
    const scenes = buildScenes(asset, [""], () => title.trim() || `Scene ${manifest.scenes.length + 1}`);
    const selectedIndex = selection?.type === "scene" ? manifest.scenes.findIndex((s) => s.id === selection.id) : -1;
    execute(insertScenes(manifest, scenes, selectedIndex >= 0 ? selectedIndex + 1 : manifest.scenes.length));
    const first = scenes[0];
    if (first) useEditor.getState().select({ type: "scene", id: first.id });
    setTitle("");
    close();
  };

  return (
    <Dialog
      open={open}
      title="Tambah scene"
      width="sm"
      onClose={close}
      actions={
        <>
          <Button onClick={close}>Batal</Button>
          <Button variant="primary" onClick={submit} disabled={!asset}>
            Tambah scene
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field id={ids.title} label="Judul (opsional)">
          <input id={ids.title} className={INPUT_CLASS} value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {asset ? (
          <Field id={ids.clip} label="Rekaman" hint="Scene memakai seluruh rekaman; potong di timeline. Ditambahkan setelah scene terpilih.">
            <Select id={ids.clip} value={asset.id} options={videos.map(clipOption)} onChange={setAssetId} />
          </Field>
        ) : (
          <NeedsVideo onImported={(video) => setAssetId(video.id)} />
        )}
      </div>
    </Dialog>
  );
}

export function AddBgmDialog({ manifest }: { readonly manifest: ProjectManifest }) {
  const fieldId = useId();
  const open = useWorkspace((s) => s.dialog === "addBgm");
  const close = useWorkspace((s) => s.closeDialog);
  const [assetId, setAssetId] = useState("");
  const audio = manifest.assets.filter((a) => a.kind === "audio" && a.durationMs !== undefined);
  const chosen = audio.find((a) => a.id === assetId) ?? audio[0];

  return (
    <Dialog
      open={open}
      title="Tambah musik latar"
      width="sm"
      onClose={close}
      actions={
        <>
          <Button onClick={close}>Batal</Button>
          <Button
            variant="primary"
            disabled={!chosen}
            onClick={() => {
              if (chosen) addAsBgm(chosen);
              close();
            }}
          >
            Tambah di playhead
          </Button>
        </>
      }
    >
      {audio.length === 0 ? (
        <div className="space-y-2">
          <p>Belum ada file musik di proyek (MP3, WAV, M4A, …).</p>
          <Button
            icon={Import}
            onClick={() =>
              void importMedia("dialog").then((assets) => {
                const music = assets.find((a) => a.kind === "audio");
                if (music) setAssetId(music.id);
              })
            }
          >
            Impor musik
          </Button>
        </div>
      ) : (
        <Field id={fieldId} label="File musik" hint="Mulai di posisi playhead; geser dan potong di timeline. Volume otomatis dikecilkan saat ada narasi.">
          <Select id={fieldId} value={chosen?.id ?? ""} options={audio.map((a) => ({ value: a.id, label: fileNameOf(a.filePath) }))} onChange={setAssetId} />
        </Field>
      )}
    </Dialog>
  );
}
