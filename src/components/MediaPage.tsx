/** Media pool (F-CORE-2): import, metadata, thumbnails, missing-file banner and relink (02 §4). */
import { Film, FileAudio, Image as ImageIcon, Import, Link2, SearchX, Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { formatTimecode, projectFileUrl } from "../lib/format";
import { mediaImport, mediaRelinkFile, mediaRelinkFolder } from "../lib/ipc";
import { newJobId, useJobProgress } from "../lib/jobs";
import { notify } from "../lib/notices";
import { addAssets, relinkAssets, removeAsset } from "../project/commands";
import { assetFromProbe, fileNameOf, thumbnailPathFor } from "../project/manifest";
import { refreshMissingAssets, useSessionUi } from "../project/session";
import { useProjectStore } from "../project/store";
import type { MediaAsset, MediaKind, RelinkCandidate } from "../types";
import { Dialog } from "./Dialog";
import { Button, IconButton, StatusText } from "./ui";

const KIND_ICON: Readonly<Record<MediaKind, LucideIcon>> = { video: Film, audio: FileAudio, image: ImageIcon };
const KIND_LABEL: Readonly<Record<MediaKind, string>> = { video: "Video", audio: "Audio", image: "Gambar" };

function Thumbnail({ root, asset }: { readonly root: string; readonly asset: MediaAsset }) {
  const [failed, setFailed] = useState(false);
  const Icon = KIND_ICON[asset.kind];
  if (asset.kind === "audio" || failed) {
    return (
      <div className="flex aspect-video items-center justify-center bg-timeline text-fg-muted">
        <Icon size={28} strokeWidth={1.5} aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={projectFileUrl(root, thumbnailPathFor(asset.id))}
      alt=""
      className="aspect-video w-full bg-timeline object-cover"
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}

function AssetCard({
  root,
  asset,
  missing,
  inUse,
  onRelink,
  onRemove,
}: {
  readonly root: string;
  readonly asset: MediaAsset;
  readonly missing: boolean;
  readonly inUse: boolean;
  readonly onRelink: () => void;
  readonly onRemove: () => void;
}) {
  const Icon = KIND_ICON[asset.kind];
  const name = fileNameOf(asset.filePath);
  return (
    <li className={`overflow-hidden rounded-md border bg-surface ${missing ? "border-danger" : "border-line-subtle"}`}>
      <Thumbnail root={root} asset={asset} />
      <div className="space-y-1 p-2.5">
        <p className="truncate text-[13px] font-medium" title={asset.filePath}>
          {name}
        </p>
        <p className="flex items-center gap-1.5 text-[12px] text-fg-2">
          <Icon size={14} strokeWidth={1.75} aria-hidden />
          <span>{KIND_LABEL[asset.kind]}</span>
          {asset.durationMs !== undefined && <span className="font-mono tabular">· {formatTimecode(asset.durationMs)}</span>}
          {asset.width !== undefined && asset.height !== undefined && (
            <span className="font-mono tabular">
              · {asset.width}×{asset.height}
            </span>
          )}
        </p>
        {missing && <StatusText tone="danger">File tidak ditemukan</StatusText>}
        <div className="flex justify-end gap-1 pt-1">
          {missing && <IconButton icon={Link2} label={`Hubungkan ulang ${name}`} onClick={onRelink} />}
          <IconButton
            icon={Trash2}
            label={inUse ? "Dipakai oleh scene, tidak dapat dihapus" : `Hapus ${name} dari proyek`}
            onClick={onRemove}
            disabled={inUse}
            className="disabled:opacity-40"
          />
        </div>
      </div>
    </li>
  );
}

export function MediaPage() {
  const project = useProjectStore((s) => s.project);
  const execute = useProjectStore((s) => s.execute);
  const missingIds = useSessionUi((s) => s.missingAssetIds);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"import" | "relink" | null>(null);
  const [mismatch, setMismatch] = useState<RelinkCandidate | null>(null);
  const progress = useJobProgress(jobId);

  if (!project) return null;
  const { manifest, root, readOnly } = project;
  const missingAssets = manifest.assets.filter((a) => missingIds.has(a.id));
  const usedIds = new Set(manifest.scenes.map((s) => s.videoClipId));

  const runImport = async (): Promise<void> => {
    const id = newJobId();
    setJobId(id);
    setBusy("import");
    const result = await mediaImport(id);
    setBusy(null);
    if (!result.ok) return notify("error", result.error.message);
    const imported = result.value.flatMap((o) => (o.status === "imported" ? [assetFromProbe(o.media)] : []));
    for (const failure of result.value) {
      if (failure.status === "failed") notify("error", `${failure.fileName}: ${failure.message}`);
    }
    if (imported.length > 0) {
      execute(addAssets(imported));
      notify("success", `${imported.length} media diimpor.`);
    }
  };

  const applyRelink = async (candidates: ReadonlyArray<RelinkCandidate>): Promise<void> => {
    const current = useProjectStore.getState().project?.manifest;
    if (!current || candidates.length === 0) return;
    execute(relinkAssets(current, candidates.map((c) => assetFromProbe(c.media))));
    await refreshMissingAssets();
  };

  const relinkFolder = async (): Promise<void> => {
    const id = newJobId();
    setJobId(id);
    setBusy("relink");
    const result = await mediaRelinkFolder(
      id,
      missingAssets.map((a) => ({ id: a.id, fileName: fileNameOf(a.filePath), durationMs: a.durationMs ?? null })),
    );
    setBusy(null);
    if (!result.ok) return notify("error", result.error.message);
    const accepted = result.value.filter((c) => c.durationMatches);
    const rejected = result.value.length - accepted.length;
    await applyRelink(accepted);
    const stillMissing = missingAssets.length - accepted.length;
    notify(
      stillMissing === 0 ? "success" : "warning",
      `${accepted.length} file terhubung ulang.${rejected > 0 ? ` ${rejected} file bernama sama dilewati karena durasinya berbeda.` : ""}${
        stillMissing > 0 ? ` ${stillMissing} file masih hilang.` : ""
      }`,
    );
  };

  const relinkOne = async (asset: MediaAsset): Promise<void> => {
    const result = await mediaRelinkFile(asset.id, asset.durationMs ?? null);
    if (!result.ok) return notify("error", result.error.message);
    if (!result.value) return;
    if (result.value.durationMatches) await applyRelink([result.value]);
    else setMismatch(result.value);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line-subtle bg-panel px-4 py-2">
        <h1 className="panel-title">Media pool</h1>
        <span className="text-[12px] text-fg-2">{manifest.assets.length} file</span>
        <div className="ml-auto flex items-center gap-3">
          {busy !== null && (
            <span aria-live="polite" className="text-[12px] text-fg-2">
              {progress ?? (busy === "import" ? "Menunggu pilihan file…" : "Menunggu pilihan folder…")}
            </span>
          )}
          <Button variant="primary" icon={Import} onClick={() => void runImport()} loading={busy === "import"} disabled={readOnly || busy !== null}>
            Impor media
          </Button>
        </div>
      </div>

      {missingAssets.length > 0 && (
        <div role="alert" className="flex items-center gap-3 border-b border-danger/40 bg-surface px-4 py-2">
          <StatusText tone="danger">{missingAssets.length} file tidak ditemukan. Scene yang memakainya tidak dapat diputar atau diekspor.</StatusText>
          <Button className="ml-auto" icon={SearchX} onClick={() => void relinkFolder()} loading={busy === "relink"} disabled={readOnly || busy !== null}>
            Hubungkan ulang dari folder
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {manifest.assets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-[14px] leading-[22px]">Belum ada media. Impor rekaman layar untuk mulai menyusun scene.</p>
            <p className="text-[12px] text-fg-2">File tidak disalin: proyek menyimpan lokasinya, jadi jangan hapus file sumber.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3" aria-label="Media">
            {manifest.assets.map((asset) => (
              <AssetCard
                key={asset.id}
                root={root}
                asset={asset}
                missing={missingIds.has(asset.id)}
                inUse={usedIds.has(asset.id) || readOnly}
                onRelink={() => void relinkOne(asset)}
                onRemove={() => execute(removeAsset(manifest, asset.id))}
              />
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={mismatch !== null}
        title="Durasi file berbeda"
        width="sm"
        onClose={() => setMismatch(null)}
        actions={
          <>
            <Button onClick={() => setMismatch(null)}>Batal</Button>
            <Button
              variant="primary"
              onClick={() => {
                const candidate = mismatch;
                setMismatch(null);
                if (candidate) void applyRelink([candidate]);
              }}
            >
              Tetap hubungkan
            </Button>
          </>
        }
      >
        <p>
          Durasi <span className="font-medium">{mismatch?.media.fileName}</span> tidak sama dengan file aslinya. Potongan scene yang memakai
          file ini mungkin bergeser.
        </p>
      </Dialog>
    </div>
  );
}
