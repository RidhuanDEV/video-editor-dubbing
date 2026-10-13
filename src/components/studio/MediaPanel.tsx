/**
 * Media tab (F-CORE-2, PRD 10 §4.2): imported recordings, music and images, with the missing-file
 * banner and relink. Right-click an item for its actions; files can also be dropped on the window.
 */
import { FileAudio, Film, Image as ImageIcon, Import, Link2, Music, SearchX, Trash2, Upload, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { formatTimecode, projectFileUrl } from "../../lib/format";
import { useJobProgress } from "../../lib/jobs";
import { removeAsset, updateScene } from "../../project/commands";
import { useEditor } from "../../project/editor";
import { fileNameOf, thumbnailPathFor } from "../../project/manifest";
import { addAsBgm, importMedia, relinkAsset, relinkMissingFromFolder, resolveMismatch, useMediaJobs } from "../../project/mediaActions";
import { beginMediaDrag } from "../../project/mediaDrag";
import { useProxies } from "../../project/proxies";
import { useSessionUi } from "../../project/session";
import { useProjectStore } from "../../project/store";
import { executeWithUndo } from "../../project/undoable";
import type { MediaAsset, MediaKind, ProjectManifest } from "../../types";
import { Dialog } from "../Dialog";
import { Button, ContextMenu, EmptyState, StatusText, type MenuItem } from "../ui";

const KIND_ICON: Readonly<Record<MediaKind, LucideIcon>> = { video: Film, audio: FileAudio, image: ImageIcon };
const KIND_LABEL: Readonly<Record<MediaKind, string>> = { video: "Video", audio: "Audio", image: "Gambar" };

function Thumbnail({ root, asset }: { readonly root: string; readonly asset: MediaAsset }) {
  const [failed, setFailed] = useState(false);
  const Icon = KIND_ICON[asset.kind];
  if (asset.kind === "audio" || failed) {
    return (
      <div className="flex aspect-video items-center justify-center bg-timeline text-fg-muted">
        <Icon size={24} strokeWidth={1.5} aria-hidden />
      </div>
    );
  }
  return <img src={projectFileUrl(root, thumbnailPathFor(asset.id))} alt="" className="aspect-video w-full bg-timeline object-cover" onError={() => setFailed(true)} draggable={false} />;
}

function AssetItem({ manifest, root, asset, missing, readOnly }: {
  readonly manifest: ProjectManifest;
  readonly root: string;
  readonly asset: MediaAsset;
  readonly missing: boolean;
  readonly readOnly: boolean;
}) {
  const execute = useProjectStore((s) => s.execute);
  const selection = useEditor((s) => s.selection);
  const proxy = useProxies((s) => s.byAsset.get(asset.id));
  const name = fileNameOf(asset.filePath);
  const inUse = manifest.scenes.some((s) => s.videoClipId === asset.id);
  const selectedScene = selection?.type === "scene" ? manifest.scenes.find((s) => s.id === selection.id) : undefined;
  const draggable = !readOnly && !missing && asset.kind !== "image";

  const items: MenuItem[] = [];
  if (asset.kind === "video" && selectedScene) {
    items.push({
      label: "Pakai untuk scene terpilih",
      icon: Film,
      disabled: readOnly || selectedScene.videoClipId === asset.id,
      onSelect: () => execute(updateScene(manifest, selectedScene.id, { videoClipId: asset.id, videoTrimStartMs: 0, videoTrimEndMs: Math.max(1, asset.durationMs ?? 1) })),
    });
  }
  if (asset.kind === "audio") items.push({ label: "Tambah sebagai musik latar", icon: Music, disabled: readOnly || asset.durationMs === undefined, onSelect: () => addAsBgm(asset) });
  if (missing) items.push({ label: "Hubungkan ulang…", icon: Link2, disabled: readOnly, onSelect: () => void relinkAsset(asset) });
  items.push({
    label: inUse ? "Hapus (dipakai scene)" : "Hapus dari proyek",
    icon: Trash2,
    danger: true,
    disabled: readOnly || inUse,
    onSelect: () => executeWithUndo(removeAsset(manifest, asset.id), `${name} dihapus dari proyek.`),
  });

  return (
    <ContextMenu items={items}>
      <li
        className={`overflow-hidden rounded-md border bg-surface transition-colors duration-150 hover:border-line ${missing ? "border-danger" : "border-line-subtle"} ${
          draggable ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        title={draggable ? `${asset.filePath}\nSeret ke scene atau timeline` : asset.filePath}
        onPointerDown={(e) => {
          if (e.button === 0 && draggable) beginMediaDrag(asset, e.clientX, e.clientY);
        }}
      >
        <Thumbnail root={root} asset={asset} />
        <div className="space-y-0.5 p-2">
          <p className="truncate text-caption font-medium">{name}</p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-caption text-fg-2">
            <span>{KIND_LABEL[asset.kind]}</span>
            {asset.durationMs !== undefined && <span className="font-mono tabular">{formatTimecode(asset.durationMs)}</span>}
            {inUse && <span className="text-accent">· dipakai</span>}
          </p>
          {missing && <StatusText tone="danger">File tidak ditemukan</StatusText>}
          {proxy?.state === "building" && <p className="text-caption text-fg-muted">Menyiapkan preview {proxy.percent}%</p>}
          {proxy?.state === "error" && <StatusText tone="warning">Preview gagal dibuat</StatusText>}
        </div>
      </li>
    </ContextMenu>
  );
}

export function MediaPanel({ manifest, root, readOnly }: { readonly manifest: ProjectManifest; readonly root: string; readonly readOnly: boolean }) {
  const missingIds = useSessionUi((s) => s.missingAssetIds);
  const running = useMediaJobs((s) => s.running);
  const mismatch = useMediaJobs((s) => s.mismatch);
  const progress = useJobProgress(running?.jobId ?? null);
  const missingCount = manifest.assets.filter((a) => missingIds.has(a.id)).length;

  const importButton = (
    <Button variant="primary" size="sm" icon={Import} loading={running?.kind === "import"} disabled={readOnly || running !== null} shortcut="Ctrl+I" tooltip="Pilih file media" onClick={() => void importMedia("dialog")}>
      Impor
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span className="text-caption text-fg-2">{manifest.assets.length} file</span>
        {running && (
          <span aria-live="polite" className="min-w-0 flex-1 truncate text-caption text-fg-muted">
            {progress ?? (running.kind === "import" ? "Menunggu pilihan file…" : "Menunggu pilihan folder…")}
          </span>
        )}
        <div className="ml-auto">{importButton}</div>
      </div>

      {missingCount > 0 && (
        <div role="alert" className="mx-2 mb-2 space-y-2 rounded-md border border-danger/50 bg-surface p-2.5">
          <StatusText tone="danger">{missingCount} file tidak ditemukan. Scene yang memakainya tidak bisa diputar atau diekspor.</StatusText>
          <Button size="sm" icon={SearchX} loading={running?.kind === "relink"} disabled={readOnly || running !== null} onClick={() => void relinkMissingFromFolder()}>
            Cari di folder…
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {manifest.assets.length === 0 ? (
          <EmptyState icon={Upload} title="Belum ada media" actions={importButton}>
            Impor rekaman layar (MP4, MOV, MKV…), musik latar, atau gambar — atau seret file ke jendela ini. File tidak disalin; jangan hapus file sumbernya.
          </EmptyState>
        ) : (
          <>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2" aria-label="Media">
              {manifest.assets.map((asset) => (
                <AssetItem key={asset.id} manifest={manifest} root={root} asset={asset} missing={missingIds.has(asset.id)} readOnly={readOnly} />
              ))}
            </ul>
            <p className="px-1 pt-3 text-caption text-fg-muted">Seret video ke scene atau timeline, musik ke track BGM. Klik kanan untuk aksi lain.</p>
          </>
        )}
      </div>

      <Dialog
        open={mismatch !== null}
        title="Durasi file berbeda"
        width="sm"
        onClose={() => void resolveMismatch(false)}
        actions={
          <>
            <Button onClick={() => void resolveMismatch(false)}>Batal</Button>
            <Button variant="primary" onClick={() => void resolveMismatch(true)}>
              Tetap hubungkan
            </Button>
          </>
        }
      >
        <p>
          Durasi <span className="font-medium">{mismatch?.media.fileName}</span> tidak sama dengan file aslinya. Potongan scene yang memakai file ini mungkin bergeser.
        </p>
      </Dialog>
    </div>
  );
}
