/**
 * Workspace pages before a project can be opened (project format lands in Phase 2).
 * Edit shows the target layout (08 §7) with empty states; other pages state when they arrive.
 */
import { Captions, Film, Import, Mic, Music, Sparkles, type LucideIcon } from "lucide-react";
import type { TrackKind } from "../types";
import { PAGES, type PageId } from "./AppShell";
import { Button } from "./ui";

const PLANNED_PHASE: Readonly<Record<PageId, string>> = {
  media: "Media pool, metadata, dan relink dibangun di Fase 2.",
  script: "Panel naskah, pilihan suara, dan sintesis per scene dibangun di Fase 2.",
  edit: "Timeline multi-track dan preview dibangun di Fase 3.",
  effects: "Zoom, blur, dan subtitle dibangun di Fase 4.",
  audio: "Mixer, ducking, dan loudness dibangun di Fase 4–5.",
  deliver: "Preset ekspor dan antrean render dibangun di Fase 5.",
};

const TRACKS: ReadonlyArray<{ readonly kind: TrackKind; readonly label: string; readonly icon: LucideIcon; readonly color: string }> = [
  { kind: "subtitle", label: "Subtitle", icon: Captions, color: "text-track-subtitle" },
  { kind: "effects", label: "Efek", icon: Sparkles, color: "text-track-effects" },
  { kind: "narration", label: "Narasi", icon: Mic, color: "text-track-narration" },
  { kind: "bgm", label: "BGM", icon: Music, color: "text-track-bgm" },
  { kind: "video", label: "Video", icon: Film, color: "text-track-video" },
];

function EmptyState({ page }: { readonly page: PageId }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-[14px] leading-[22px] text-fg">Belum ada klip. Impor video atau seret file ke sini.</p>
      <p className="text-[12px] text-fg-2">{PLANNED_PHASE[page]}</p>
      <Button icon={Import} disabled title="Tersedia di Fase 2">
        Impor video
      </Button>
    </div>
  );
}

function EditLayout() {
  return (
    <div className="grid h-full grid-cols-[280px_1fr_300px] grid-rows-[1fr_220px] gap-px bg-line-subtle">
      <aside className="bg-panel" aria-label="Naskah dan media">
        <h2 className="panel-title border-b border-line-subtle px-3 py-3">Naskah</h2>
        <p className="p-3 text-[12px] text-fg-2">Belum ada scene.</p>
      </aside>

      <section className="flex flex-col items-center justify-center gap-3 bg-app p-4" aria-label="Preview">
        <div className="flex aspect-video w-full max-w-[720px] items-center justify-center rounded-sm border border-line-subtle bg-timeline">
          <EmptyState page="edit" />
        </div>
        <p className="font-mono text-[12px] tabular text-fg-2">00:00.000 / 00:00.000</p>
      </section>

      <aside className="bg-panel" aria-label="Inspector">
        <h2 className="panel-title border-b border-line-subtle px-3 py-3">Inspector</h2>
        <p className="p-3 text-[12px] text-fg-2">Pilih scene atau klip untuk melihat propertinya.</p>
      </aside>

      <section className="col-span-3 bg-timeline" aria-label="Timeline">
        {TRACKS.map(({ kind, label, icon: Icon, color }) => (
          <div key={kind} className="flex h-10 items-center border-b border-line-subtle">
            <div className="flex h-full w-[160px] items-center gap-2 border-r border-line-subtle bg-panel px-3">
              <Icon size={16} strokeWidth={1.75} className={color} aria-hidden />
              <span className="text-[13px] font-medium">{label}</span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

export function WorkspacePage({ page }: { readonly page: PageId }) {
  if (page === "edit") return <EditLayout />;
  const label = PAGES.find((p) => p.id === page)?.label ?? page;
  return (
    <section className="h-full" aria-label={label}>
      <EmptyState page={page} />
    </section>
  );
}
