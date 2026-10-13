/**
 * Start screen (PRD 10 §4.1, §4.3): recent projects, new project (step 1 of the guided setup:
 * title + aspect ratio, then the folder dialog), open a folder, or drop a .smbproj on the window.
 */
import { Clapperboard, Clock, FolderOpen, FolderX, Monitor, Plus, Smartphone, Square, Trash2 } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { recentProjects, recentProjectsForget } from "../../lib/ipc";
import { createProject, openProject, openRecentProject, useSessionUi } from "../../project/session";
import { useWorkspace } from "../../project/workspace";
import type { AspectRatio, RecentProject } from "../../types";
import { Button, ContextMenu, Field, INPUT_CLASS, RadioCards } from "../ui";

const ASPECTS = [
  { value: "16:9", label: "16:9 Lanskap", detail: "YouTube, presentasi", icon: Monitor },
  { value: "9:16", label: "9:16 Potret", detail: "Shorts, TikTok, Reels", icon: Smartphone },
  { value: "1:1", label: "1:1 Persegi", detail: "Feed media sosial", icon: Square },
] satisfies ReadonlyArray<{ readonly value: AspectRatio; readonly label: string; readonly detail: string; readonly icon: typeof Monitor }>;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} hari lalu` : new Date(iso).toLocaleDateString("id-ID");
}

function RecentList() {
  const [items, setItems] = useState<ReadonlyArray<RecentProject> | null>(null);
  const busy = useSessionUi((s) => s.busy);
  const load = (): void => {
    void recentProjects().then((result) => setItems(result.ok ? result.value : []));
  };
  useEffect(load, []);
  const forget = (path: string): void => {
    void recentProjectsForget(path).then(load);
  };

  if (items === null) return <div className="h-40 animate-pulse rounded-lg bg-surface" role="status" aria-label="Memuat proyek terbaru" />;
  if (items.length === 0) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-center">
        <Clock size={20} strokeWidth={1.5} className="text-fg-muted" aria-hidden />
        <p className="text-ui text-fg-2">Belum ada proyek terbaru.</p>
        <p className="text-caption text-fg-muted">Proyek yang Anda buat atau buka muncul di sini.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-1" aria-label="Proyek terbaru">
      {items.map((item) => (
        <ContextMenu key={item.path} items={[{ label: "Hapus dari daftar", icon: Trash2, danger: true, onSelect: () => forget(item.path) }]}>
          <li>
            <button
              type="button"
              disabled={busy || !item.available}
              onClick={() => void openRecentProject(item.path)}
              className="group flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left transition-colors duration-150 hover:border-line hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
              title={item.path}
            >
              {item.available ? (
                <Clapperboard size={18} strokeWidth={1.5} className="shrink-0 text-accent" aria-hidden />
              ) : (
                <FolderX size={18} strokeWidth={1.5} className="shrink-0 text-fg-muted" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui font-medium">{item.title || "(tanpa judul)"}</span>
                <span className="block truncate text-caption text-fg-muted">{item.available ? item.path : "Folder tidak ditemukan (dipindah atau dihapus)"}</span>
              </span>
              <span className="shrink-0 text-caption text-fg-muted">{relativeTime(item.openedAt)}</span>
            </button>
          </li>
        </ContextMenu>
      ))}
    </ul>
  );
}

export function StartScreen() {
  const titleId = useId();
  const [title, setTitle] = useState("");
  const [aspect, setAspect] = useState<AspectRatio>("16:9");
  const busy = useSessionUi((s) => s.busy);
  const trimmed = title.trim();

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (trimmed === "") return;
    void createProject(trimmed, aspect).then((created) => {
      if (created) useWorkspace.getState().openDialog("wizard");
    });
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto grid max-w-[1040px] gap-8 px-8 py-12 lg:grid-cols-[1fr_420px]">
        <section className="space-y-4" aria-label="Proyek terbaru">
          <div>
            <h1 className="text-title font-semibold">Selamat datang</h1>
            <p className="text-ui text-fg-2">Buat video tutorial dari rekaman layar dan naskah: tulis, beri suara, poles, ekspor.</p>
          </div>
          <div className="flex items-center justify-between">
            <h2 className="panel-title">Proyek terbaru</h2>
            <Button size="sm" variant="ghost" icon={FolderOpen} loading={busy} shortcut="Ctrl+O" tooltip="Pilih folder .smbproj" onClick={() => void openProject()}>
              Buka folder…
            </Button>
          </div>
          <RecentList />
          <p className="text-caption text-fg-muted">Tip: seret folder proyek (.smbproj) ke jendela ini untuk membukanya.</p>
        </section>

        <form onSubmit={submit} className="h-fit space-y-4 rounded-lg border border-line-subtle bg-panel p-5" aria-label="Proyek baru">
          <div>
            <h2 className="text-body font-semibold">Proyek baru</h2>
            <p className="text-caption text-fg-2">Langkah 1 dari 3 · berikutnya: impor rekaman, lalu naskah & suara.</p>
          </div>
          <Field id={titleId} label="Judul proyek">
            <input id={titleId} className={INPUT_CLASS} value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} placeholder="mis. Tutorial Login SUMBA" autoFocus />
          </Field>
          <div className="space-y-1.5">
            <p className="text-caption font-medium text-fg-2">Bentuk video</p>
            <RadioCards label="Rasio kanvas" value={aspect} onChange={setAspect} options={ASPECTS} />
          </div>
          <Button type="submit" variant="primary" icon={Plus} className="w-full" disabled={trimmed === ""} loading={busy}>
            Pilih folder & buat proyek
          </Button>
          <p className="text-caption text-fg-muted">Folder proyek berisi naskah, cache suara, dan preview. Rekaman asli tidak disalin.</p>
        </form>
      </div>
    </div>
  );
}
