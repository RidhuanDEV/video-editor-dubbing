/** Ghost that follows the pointer while a media item is dragged, with what a drop will do. */
import { FileAudio, Film } from "lucide-react";
import { fileNameOf } from "../../project/manifest";
import { useMediaDrag } from "../../project/mediaDrag";

function describe(target: string | null, kind: "video" | "audio" | "image"): string {
  if (target === null) return kind === "audio" ? "Lepas di track BGM" : "Lepas di scene atau timeline";
  if (target.startsWith("scene:")) return "Ganti klip scene ini";
  if (target === "scenes") return "Buat scene baru";
  return "Tambah sebagai musik latar di sini";
}

export function MediaDragLayer() {
  const { asset, x, y, target } = useMediaDrag();
  if (!asset) return null;
  const Icon = asset.kind === "audio" ? FileAudio : Film;
  return (
    <div className="pointer-events-none fixed z-[60] flex items-center gap-2 rounded-md border border-line bg-raised px-2.5 py-1.5 text-caption shadow-raised" style={{ left: x + 14, top: y + 10 }} aria-hidden>
      <Icon size={14} className="text-fg-2" />
      <span className="max-w-[200px] truncate font-medium">{fileNameOf(asset.filePath)}</span>
      <span className={target ? "text-accent" : "text-fg-muted"}>· {describe(target, asset.kind)}</span>
    </div>
  );
}
