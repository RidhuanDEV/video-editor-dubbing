/** Pages not built yet: each states which phase delivers it. */
import { PAGES, type PageId } from "./AppShell";

export type PlaceholderPageId = Exclude<PageId, "media" | "script" | "edit">;

const PLANNED_PHASE: Readonly<Record<PlaceholderPageId, string>> = {
  effects: "Zoom, blur, dan subtitle dibangun di Fase 4.",
  audio: "Mixer, ducking, dan loudness dibangun di Fase 4–5.",
  deliver: "Preset ekspor dan antrean render dibangun di Fase 5.",
};

export function WorkspacePage({ page }: { readonly page: PlaceholderPageId }) {
  const label = PAGES.find((p) => p.id === page)?.label ?? page;
  return (
    <section className="flex h-full items-center justify-center" aria-label={label}>
      <p className="p-8 text-center text-[13px] text-fg-2">{PLANNED_PHASE[page]}</p>
    </section>
  );
}
