/**
 * Status bar (PRD 10 §4.2): project readiness, background jobs (synthesis, previews, export),
 * the encoder in use and the save state. Every item opens the place where it can be acted on.
 */
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { CheckCircle2, Cpu, Loader2, TriangleAlert, Zap } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useEngine } from "../../lib/engine";
import { formatEta, useExportJob } from "../../project/exportJob";
import { projectReadiness } from "../../project/readiness";
import { useProxies } from "../../project/proxies";
import { useSessionUi } from "../../project/session";
import { isDirty, useProjectStore } from "../../project/store";
import { useSynthesis } from "../../project/synthesis";
import { useWorkspace } from "../../project/workspace";
import type { VideoEncoderId } from "../../types";
import { Tooltip } from "../ui";

const ENCODER_LABEL: Readonly<Record<VideoEncoderId, string>> = {
  h264_nvenc: "NVENC",
  h264_qsv: "Quick Sync",
  h264_amf: "AMF",
  h264_videotoolbox: "VideoToolbox",
  libopenh264: "OpenH264 (CPU)",
  av1_nvenc: "NVENC",
  av1_qsv: "Quick Sync",
  av1_amf: "AMF",
  libsvtav1: "SVT-AV1 (CPU)",
};

function Item({ children, onClick, tooltip }: { readonly children: ReactNode; readonly onClick?: () => void; readonly tooltip: string }) {
  const content = onClick ? (
    <button type="button" onClick={onClick} className="inline-flex h-6 items-center gap-1.5 rounded-sm px-1.5 hover:bg-hover hover:text-fg">
      {children}
    </button>
  ) : (
    <span className="inline-flex h-6 items-center gap-1.5 px-1.5">{children}</span>
  );
  return (
    <Tooltip content={tooltip} side="top">
      {content}
    </Tooltip>
  );
}

function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    getVersion()
      .then(setVersion)
      .catch((error: Error) => console.warn("version unavailable", error.message));
  }, []);
  return version;
}

export function StatusBar() {
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore(isDirty);
  const missing = useSessionUi((s) => s.missingAssetIds);
  const batch = useSynthesis((s) => s.batch);
  const proxies = useProxies((s) => s.byAsset);
  const job = useExportJob((s) => s.job);
  const encoders = useEngine((s) => s.encoders);
  const workspace = useWorkspace();
  const version = useAppVersion();
  const manifest = project?.manifest;
  const readiness = useMemo(() => (manifest ? projectReadiness(manifest, missing) : null), [manifest, missing]);
  const building = [...proxies.values()].filter((p) => p.state === "building");
  const buildingPercent = building[0]?.state === "building" ? building[0].percent : 0;

  const encoder = (() => {
    if (encoders.state === "detecting") return { icon: Loader2, spin: true, text: "Mendeteksi encoder…", tip: "Menguji encoder GPU dan CPU (sekali per sesi)" };
    if (encoders.state === "error") return { icon: TriangleAlert, spin: false, text: "Encoder bermasalah", tip: encoders.error.message };
    if (encoders.state === "done") {
      const av1 = encoders.report.av1.selected;
      const h264 = encoders.report.h264.selected;
      const hardware = encoders.report.av1.candidates.some((c) => c.encoder === av1 && c.hardware);
      return {
        icon: hardware ? Zap : Cpu,
        spin: false,
        text: `AV1: ${av1 ? ENCODER_LABEL[av1] : "—"} · H.264: ${h264 ? ENCODER_LABEL[h264] : "—"}`,
        tip: "Encoder yang dipakai ekspor. Klik untuk detail.",
      };
    }
    return { icon: Cpu, spin: false, text: "Encoder", tip: "Belum dideteksi" };
  })();
  const EncoderIcon = encoder.icon;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-1 border-t border-line-subtle bg-panel px-2 text-caption text-fg-2">
      {readiness && (
        <Item tooltip={readiness.next ? `Berikutnya: ${readiness.next.label}` : "Semua pemeriksaan lolos"} onClick={() => workspace.openDialog("export")}>
          {readiness.next ? (
            <TriangleAlert size={13} strokeWidth={2} className={readiness.canExport ? "text-warning" : "text-danger"} aria-hidden />
          ) : (
            <CheckCircle2 size={13} strokeWidth={2} className="text-success" aria-hidden />
          )}
          {readiness.next ? `Kesiapan ${readiness.done}/${readiness.total}` : "Siap ekspor"}
        </Item>
      )}

      {batch && (
        <Item tooltip="Membuat suara narasi satu per satu">
          <Loader2 size={13} className="animate-spin" aria-hidden />
          Menyintesis {batch.done + 1}/{batch.total}
        </Item>
      )}
      {building.length > 0 && (
        <Item tooltip="Membuat versi ringan rekaman untuk preview yang lancar">
          <Loader2 size={13} className="animate-spin" aria-hidden />
          Menyiapkan preview {buildingPercent}%{building.length > 1 ? ` (+${building.length - 1})` : ""}
        </Item>
      )}
      {job.state === "running" && (
        <Item tooltip="Buka detail ekspor" onClick={() => workspace.openDialog("export")}>
          <Loader2 size={13} className="animate-spin text-accent" aria-hidden />
          <span className="text-fg">
            Ekspor {Math.round(job.progress?.percentage ?? 0)}%{job.progress?.stage === "encode" ? ` · sisa ${formatEta(job.progress.etaSeconds)}` : ""}
          </span>
        </Item>
      )}

      <div className="ml-auto flex items-center gap-1">
        <Item tooltip={encoder.tip} onClick={() => workspace.openSettings("video")}>
          <EncoderIcon size={13} className={encoder.spin ? "animate-spin" : undefined} aria-hidden />
          {encoder.text}
        </Item>
        {project && !project.readOnly && (
          <Item tooltip={dirty ? "Autosave tiap 30 dtk sebagai cadangan; Ctrl+S untuk menyimpan" : "Semua perubahan tersimpan di folder proyek"}>
            {dirty ? "Belum disimpan" : `Disimpan ${new Date(project.manifest.updatedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`}
          </Item>
        )}
        {version && <span className="px-1.5 text-fg-muted">v{version}</span>}
      </div>
    </footer>
  );
}
