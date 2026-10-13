/** App command bar (PRD 10 §4.2): project menu, save state, undo/redo, command search, settings, export. */
import { ChevronDown, CircleDot, Clapperboard, FolderOpen, Lock, Redo2, Save, Search, Settings, Share, Undo2, X } from "lucide-react";
import { useEditor } from "../../project/editor";
import { closeProjectGuarded } from "../../project/exit";
import { openProject, saveProject } from "../../project/session";
import { isDirty, useProjectStore } from "../../project/store";
import { useWorkspace } from "../../project/workspace";
import { Button, DropdownMenu, IconButton, Kbd } from "../ui";

export function TitleBar() {
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore(isDirty);
  const undoLabel = useProjectStore((s) => s.past[s.past.length - 1]?.label ?? null);
  const redoLabel = useProjectStore((s) => s.future[0]?.label ?? null);
  const workspace = useWorkspace();

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle bg-panel px-2">
      <div className="flex items-center gap-2 pl-1">
        <Clapperboard size={18} strokeWidth={1.75} className="text-accent" aria-hidden />
        <span className="text-ui font-semibold">Script Studio</span>
      </div>

      {project && (
        <>
          <span className="h-5 w-px bg-line" aria-hidden />
          <DropdownMenu
            items={[
              { label: "Simpan", icon: Save, shortcut: "Ctrl+S", disabled: project.readOnly || !dirty, onSelect: () => void saveProject() },
              { label: "Buka proyek lain…", icon: FolderOpen, shortcut: "Ctrl+O", onSelect: () => void closeProjectGuarded(() => openProject()) },
              { label: "Pengaturan proyek", icon: Settings, onSelect: () => useEditor.getState().select(null) },
              { label: "Tutup proyek", icon: X, danger: true, onSelect: () => void closeProjectGuarded() },
            ]}
            trigger={
              <button type="button" className="inline-flex h-8 max-w-[360px] items-center gap-1.5 rounded-md px-2 text-ui hover:bg-hover" aria-label={`Menu proyek ${project.manifest.title}`}>
                <span className="truncate font-medium">{project.manifest.title}</span>
                <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-fg-2" aria-hidden />
              </button>
            }
          />
          {project.readOnly ? (
            <span className="inline-flex items-center gap-1 text-caption text-warning">
              <Lock size={14} strokeWidth={1.75} aria-hidden /> Baca saja
            </span>
          ) : dirty ? (
            <span className="inline-flex items-center gap-1 text-caption text-warning">
              <CircleDot size={12} strokeWidth={2} aria-hidden /> Belum disimpan
            </span>
          ) : (
            <span className="text-caption text-fg-muted">Tersimpan</span>
          )}
          <div className="ml-1 flex items-center" role="group" aria-label="Riwayat">
            <IconButton icon={Undo2} label={undoLabel ? `Urungkan: ${undoLabel}` : "Tidak ada yang bisa diurungkan"} shortcut="Ctrl+Z" disabled={!undoLabel} onClick={() => useProjectStore.getState().undo()} />
            <IconButton icon={Redo2} label={redoLabel ? `Ulangi: ${redoLabel}` : "Tidak ada yang bisa diulangi"} shortcut="Ctrl+Y" disabled={!redoLabel} onClick={() => useProjectStore.getState().redo()} />
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => workspace.openDialog("palette")}
        className="mx-auto inline-flex h-8 w-full max-w-[360px] items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-ui text-fg-muted transition-colors duration-150 hover:border-fg-muted hover:text-fg-2"
      >
        <Search size={14} strokeWidth={1.75} aria-hidden />
        <span className="flex-1 text-left">Cari perintah…</span>
        <Kbd>Ctrl+K</Kbd>
      </button>

      <IconButton icon={Settings} label="Pengaturan" shortcut="Ctrl+," onClick={() => workspace.openSettings("general")} />
      <Button
        variant="primary"
        icon={Share}
        disabled={!project}
        tooltip={project ? "Pilih format lalu render" : "Buka proyek terlebih dahulu"}
        shortcut="Ctrl+E"
        onClick={() => workspace.openDialog("export")}
      >
        Ekspor
      </Button>
    </header>
  );
}
