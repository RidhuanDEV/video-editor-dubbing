/** Workspace frame: top bar, page content, DaVinci-style page bar at the bottom (PRD 08 §7). */
import {
  AudioLines,
  Clapperboard,
  Cpu,
  FileText,
  FolderOpen,
  Monitor,
  Moon,
  Scissors,
  Share,
  Sparkles,
  Sun,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ThemeState } from "../lib/theme";
import type { ThemePreference, VideoEncoderId } from "../types";
import { Button, IconButton } from "./ui";

export type PageId = "media" | "script" | "edit" | "effects" | "audio" | "deliver";
export type ViewId = PageId | "engine";

export const PAGES: ReadonlyArray<{ readonly id: PageId; readonly label: string; readonly icon: LucideIcon }> = [
  { id: "media", label: "Media", icon: FolderOpen },
  { id: "script", label: "Naskah", icon: FileText },
  { id: "edit", label: "Edit", icon: Scissors },
  { id: "effects", label: "Efek", icon: Sparkles },
  { id: "audio", label: "Audio", icon: AudioLines },
  { id: "deliver", label: "Ekspor", icon: Share },
];

const THEME_OPTIONS: ReadonlyArray<{ readonly value: ThemePreference; readonly label: string; readonly icon: LucideIcon }> = [
  { value: "system", label: "Tema mengikuti sistem", icon: Monitor },
  { value: "light", label: "Tema terang", icon: Sun },
  { value: "dark", label: "Tema gelap", icon: Moon },
];

const ENCODER_LABEL: Readonly<Record<VideoEncoderId, string>> = {
  h264_nvenc: "NVENC",
  h264_qsv: "Quick Sync",
  h264_amf: "AMF",
  h264_videotoolbox: "VideoToolbox",
  libopenh264: "OpenH264 (CPU)",
};

interface AppShellProps {
  readonly view: ViewId;
  readonly onNavigate: (view: ViewId) => void;
  readonly theme: ThemeState;
  readonly encoder: VideoEncoderId | null;
  readonly children: ReactNode;
}

export function AppShell({ view, onNavigate, theme, encoder, children }: AppShellProps) {
  return (
    <div className="flex h-full flex-col bg-app text-fg">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line-subtle bg-panel px-3">
        <div className="flex items-center gap-2">
          <Clapperboard size={20} strokeWidth={1.75} className="text-accent" aria-hidden />
          <span className="text-[13px] font-semibold">Script Studio</span>
          <span className="text-[12px] text-fg-muted">— Proyek belum dibuka</span>
        </div>

        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Pilihan tema (Ctrl+Shift+L)">
          {THEME_OPTIONS.map((option) => (
            <IconButton
              key={option.value}
              icon={option.icon}
              label={option.label}
              pressed={theme.preference === option.value}
              onClick={() => theme.setPreference(option.value)}
            />
          ))}
        </div>

        <Button
          variant={view === "engine" ? "secondary" : "ghost"}
          icon={Cpu}
          onClick={() => onNavigate("engine")}
          aria-current={view === "engine" ? "page" : undefined}
        >
          <span className="tabular">Encoder: {encoder ? ENCODER_LABEL[encoder] : "belum dideteksi"}</span>
        </Button>

        <Button variant="primary" icon={Share} disabled title="Tersedia di Fase 5">
          Ekspor video
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">{children}</main>

      <nav aria-label="Halaman workspace" className="flex h-11 shrink-0 items-center justify-center gap-1 border-t border-line-subtle bg-panel">
        {PAGES.map(({ id, label, icon: Icon }) => {
          const active = view === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(id)}
              className={`inline-flex h-8 items-center gap-2 rounded-md border-b-2 px-3 text-[13px] font-medium transition-colors duration-150 ${
                active ? "border-accent text-fg" : "border-transparent text-fg-2 hover:bg-hover hover:text-fg"
              }`}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden />
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
