/** Shown while files from Explorer are dragged over the window: says what a drop will do. */
import { FolderOpen, Import } from "lucide-react";
import { useFileDragOver } from "../../project/mediaActions";
import { useProjectStore } from "../../project/store";

export function FileDropOverlay() {
  const over = useFileDragOver((s) => s.over);
  const hasProject = useProjectStore((s) => s.project !== null);
  if (!over) return null;
  const Icon = hasProject ? Import : FolderOpen;
  return (
    <div className="animate-fade pointer-events-none fixed inset-3 z-[60] flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-accent bg-app/85" aria-hidden>
      <Icon size={36} strokeWidth={1.5} className="text-accent" />
      <p className="text-title font-semibold">{hasProject ? "Lepas untuk mengimpor media" : "Lepas folder proyek (.smbproj) untuk membukanya"}</p>
      <p className="text-ui text-fg-2">{hasProject ? "Video, musik, dan gambar masuk ke tab Media." : "Buat proyek dulu untuk mengimpor rekaman."}</p>
    </div>
  );
}
