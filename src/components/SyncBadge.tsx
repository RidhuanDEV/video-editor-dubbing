/** Scene sync status (04 §1.2, 08 §7): always icon + text, never color alone. */
import { AlertCircle, CheckCircle2, Clock3, Info, Loader2, PauseCircle, type LucideIcon } from "lucide-react";
import type { SynthesisStatus } from "../project/synthesis";
import type { SceneSync } from "../project/sync";

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function describe(sync: SceneSync, synthesis: SynthesisStatus | undefined): { icon: LucideIcon; text: string; className: string } {
  if (synthesis?.state === "loading") return { icon: Loader2, text: "Menyintesis…", className: "text-fg-2" };
  if (synthesis?.state === "error") return { icon: AlertCircle, text: "Gagal sintesis", className: "text-danger" };
  switch (sync.kind) {
    case "pending":
      return { icon: Clock3, text: "Belum ada suara", className: "text-fg-2" };
    case "synced":
      return { icon: CheckCircle2, text: "Sinkron", className: "text-success" };
    case "freeze":
      return { icon: PauseCircle, text: `Freeze +${seconds(sync.padMs)}`, className: "text-warning" };
    case "videoLonger":
      return { icon: Info, text: `Video lebih panjang ${seconds(sync.extraMs)}`, className: "text-info" };
    case "audioCut":
      return { icon: AlertCircle, text: `Audio terpotong ${seconds(sync.overMs)}`, className: "text-danger" };
  }
}

export function SyncBadge({ sync, synthesis }: { readonly sync: SceneSync; readonly synthesis: SynthesisStatus | undefined }) {
  const { icon: Icon, text, className } = describe(sync, synthesis);
  return (
    <span className={`inline-flex items-center gap-1 text-caption ${className}`}>
      <Icon size={14} strokeWidth={1.75} aria-hidden className={synthesis?.state === "loading" ? "animate-spin" : undefined} />
      <span className="tabular">{text}</span>
    </span>
  );
}
