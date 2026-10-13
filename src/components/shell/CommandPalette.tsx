/**
 * Command palette (03 §5.5 Ctrl+K): every main action plus "go to scene N", searchable. The
 * list is built from the current state so unavailable commands simply are not offered.
 */
import { Command } from "cmdk";
import {
  AudioLines,
  ClipboardPaste,
  Film,
  FolderOpen,
  Import,
  Keyboard,
  Moon,
  Music,
  Pause,
  Play,
  Plus,
  Save,
  Scissors,
  Settings,
  Share,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useMemo } from "react";
import type { ThemeState } from "../../lib/theme";
import { useEditor } from "../../project/editor";
import { closeProjectGuarded } from "../../project/exit";
import { importMedia } from "../../project/mediaActions";
import { openProject, saveProject } from "../../project/session";
import { isDirty, useProjectStore } from "../../project/store";
import { pendingSceneIds, synthesizeAll } from "../../project/synthesis";
import { layoutTimeline } from "../../project/timeline";
import { useWorkspace } from "../../project/workspace";
import { splitAtPlayhead } from "../studio/Timeline";

interface PaletteCommand {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly shortcut?: string;
  readonly keywords?: ReadonlyArray<string>;
  readonly run: () => void;
}

function useCommands(theme: ThemeState): ReadonlyArray<PaletteCommand> {
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore(isDirty);
  const playing = useEditor((s) => s.playing);
  const workspace = useWorkspace();

  return useMemo(() => {
    const commands: PaletteCommand[] = [];
    const nextTheme = theme.resolved === "dark" ? "light" : "dark";
    if (project) {
      const { manifest, readOnly } = project;
      const editable = !readOnly;
      const pending = pendingSceneIds(manifest.scenes).length;
      commands.push(
        { id: "export", group: "Proyek", label: "Ekspor video…", icon: Share, shortcut: "Ctrl+E", run: () => workspace.openDialog("export") },
        ...(editable && dirty ? [{ id: "save", group: "Proyek", label: "Simpan", icon: Save, shortcut: "Ctrl+S", run: () => void saveProject() }] : []),
        { id: "project", group: "Proyek", label: "Pengaturan proyek (kanvas, suara, subtitle, audio)", icon: SlidersHorizontal, run: () => useEditor.getState().select(null) },
        { id: "close", group: "Proyek", label: "Tutup proyek", icon: X, run: () => void closeProjectGuarded() },
      );
      if (editable) {
        commands.push(
          { id: "import", group: "Tambah", label: "Impor media…", icon: Import, shortcut: "Ctrl+I", keywords: ["video", "rekaman", "musik"], run: () => void importMedia("dialog") },
          { id: "paste", group: "Tambah", label: "Tempel naskah…", icon: ClipboardPaste, keywords: ["script", "auto-chunk"], run: () => workspace.openDialog("pasteScript") },
          { id: "scene", group: "Tambah", label: "Tambah scene…", icon: Plus, run: () => workspace.openDialog("addScene") },
          { id: "bgm", group: "Tambah", label: "Tambah musik latar…", icon: Music, keywords: ["bgm", "audio"], run: () => workspace.openDialog("addBgm") },
        );
        if (pending > 0) commands.push({ id: "synth", group: "Suara", label: `Sintesis ${pending} scene yang belum bersuara`, icon: AudioLines, keywords: ["tts", "narasi"], run: () => void synthesizeAll() });
      }
      commands.push(
        {
          id: "play",
          group: "Pemutaran",
          label: playing ? "Jeda" : "Putar",
          icon: playing ? Pause : Play,
          shortcut: "Spasi",
          run: () => useEditor.getState().setPlaying(!playing),
        },
        ...(editable ? [{ id: "split", group: "Pemutaran", label: "Potong scene di playhead", icon: Scissors, shortcut: "C", run: () => splitAtPlayhead(manifest) }] : []),
      );
      const layout = layoutTimeline(manifest);
      layout.segments.forEach((segment) =>
        commands.push({
          id: `scene-${segment.scene.id}`,
          group: "Pergi ke scene",
          label: `${String(segment.index + 1).padStart(2, "0")} · ${segment.scene.title || "(tanpa judul)"}`,
          icon: Film,
          keywords: [segment.scene.narration.slice(0, 120)],
          run: () => {
            const editor = useEditor.getState();
            editor.select({ type: "scene", id: segment.scene.id });
            editor.seek(segment.startMs, layout.durationMs);
            workspace.setLeftTab("script");
          },
        }),
      );
    } else {
      commands.push({ id: "open", group: "Proyek", label: "Buka proyek…", icon: FolderOpen, shortcut: "Ctrl+O", run: () => void openProject() });
    }
    commands.push(
      { id: "settings", group: "Aplikasi", label: "Pengaturan", icon: Settings, shortcut: "Ctrl+,", run: () => workspace.openSettings("general") },
      { id: "voice", group: "Aplikasi", label: "Pengaturan suara (Edge-TTS, Azure)", icon: AudioLines, run: () => workspace.openSettings("voice") },
      { id: "shortcuts", group: "Aplikasi", label: "Daftar pintasan keyboard", icon: Keyboard, run: () => workspace.openSettings("shortcuts") },
      { id: "theme", group: "Aplikasi", label: `Ganti ke tema ${nextTheme === "dark" ? "gelap" : "terang"}`, icon: Moon, shortcut: "Ctrl+Shift+L", run: () => theme.setPreference(nextTheme) },
    );
    return commands;
  }, [project, dirty, playing, theme, workspace]);
}

export function CommandPalette({ theme }: { readonly theme: ThemeState }) {
  const open = useWorkspace((s) => s.dialog === "palette");
  const close = useWorkspace((s) => s.closeDialog);
  const commands = useCommands(theme);
  const groups = [...new Set(commands.map((c) => c.group))];

  return (
    <D.Root open={open} onOpenChange={(next) => !next && close()}>
      <D.Portal>
        <D.Overlay className="animate-fade fixed inset-0 z-40 bg-black/40" />
        <D.Content aria-describedby={undefined} className="animate-pop fixed top-[14vh] left-1/2 z-40 w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-raised text-fg shadow-raised">
          <D.Title className="sr-only">Cari perintah</D.Title>
          <Command loop>
            <Command.Input autoFocus placeholder="Ketik perintah atau nama scene…" className="h-12 w-full border-b border-line-subtle bg-transparent px-4 text-body outline-none placeholder:text-fg-muted" />
            <Command.List className="max-h-[360px] overflow-auto p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-ui text-fg-2">Tidak ada perintah yang cocok.</Command.Empty>
              {groups.map((group) => (
                <Command.Group
                  key={group}
                  heading={group}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-muted"
                >
                  {commands
                    .filter((c) => c.group === group)
                    .map(({ id, label, icon: Icon, shortcut, keywords, run }) => (
                      <Command.Item
                        key={id}
                        value={`${group} ${label}`}
                        keywords={keywords ? [...keywords] : []}
                        onSelect={() => {
                          close();
                          run();
                        }}
                        className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-ui select-none data-[selected=true]:bg-hover"
                      >
                        <Icon size={16} strokeWidth={1.75} className="text-fg-2" aria-hidden />
                        <span className="flex-1 truncate">{label}</span>
                        {shortcut && <span className="font-mono text-caption text-fg-muted">{shortcut}</span>}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
