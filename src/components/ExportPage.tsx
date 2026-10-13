/** Ekspor page (05 §4–5, 08 §8 progress): preset, preflight, subtitle options, progress, cancel. */
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CircleStop, Film, Music, Smartphone, Upload, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { exportCancel, exportStart } from "../lib/ipc";
import { newJobId } from "../lib/jobs";
import { notify } from "../lib/notices";
import { serializeManifest } from "../project/manifest";
import { buildOverlayAss } from "../project/overlay";
import { useSessionUi } from "../project/session";
import { useProjectStore } from "../project/store";
import { useCues } from "../project/subtitleData";
import { toSrt } from "../project/subtitles";
import { formatTimecode } from "../lib/format";
import { EMPTY_LAYOUT, layoutTimeline } from "../project/timeline";
import { RENDER_PROGRESS_EVENT, RenderProgressSchema, type AppError, type PresetId, type RenderProgress } from "../types";
import { Button, Card, StatusText } from "./ui";

interface PresetInfo {
  readonly id: PresetId;
  readonly label: string;
  readonly detail: string;
  readonly icon: LucideIcon;
  /** null = audio only (no aspect requirement). */
  readonly size: { readonly width: number; readonly height: number } | null;
  readonly recommendedLufs: number;
}

const PRESETS: ReadonlyArray<PresetInfo> = [
  { id: "youtube1080", label: "YouTube 1080p", detail: "1920×1080 · 30 fps · 8 Mbps", icon: Film, size: { width: 1920, height: 1080 }, recommendedLufs: -14 },
  { id: "youtube4k", label: "YouTube 4K", detail: "3840×2160 · 30 fps · 35 Mbps · file besar", icon: Film, size: { width: 3840, height: 2160 }, recommendedLufs: -14 },
  { id: "shorts", label: "Shorts / TikTok", detail: "1080×1920 · 30 fps · butuh kanvas 9:16", icon: Smartphone, size: { width: 1080, height: 1920 }, recommendedLufs: -14 },
  { id: "whatsapp", label: "WhatsApp ringan", detail: "1280×720 · 25 fps · 2 Mbps", icon: Smartphone, size: { width: 1280, height: 720 }, recommendedLufs: -16 },
  { id: "audioOnly", label: "Audio saja", detail: "M4A (AAC 192 kbps)", icon: Music, size: null, recommendedLufs: -16 },
];

type ExportState =
  | { readonly state: "idle" }
  | { readonly state: "running"; readonly jobId: string; readonly progress: RenderProgress | null }
  | { readonly state: "done"; readonly path: string }
  | { readonly state: "error"; readonly error: AppError };

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "menghitung…";
  const s = Math.max(0, Math.round(seconds));
  return s >= 60 ? `${Math.floor(s / 60)} m ${s % 60} d` : `${s} dtk`;
}

export function ExportPage() {
  const project = useProjectStore((s) => s.project);
  const missingIds = useSessionUi((s) => s.missingAssetIds);
  const manifest = project?.manifest;
  const layout = useMemo(() => (manifest ? layoutTimeline(manifest) : EMPTY_LAYOUT), [manifest]);
  const cues = useCues(layout);
  const [preset, setPreset] = useState<PresetId>("youtube1080");
  const [burnSubtitles, setBurnSubtitles] = useState(manifest?.subtitleSettings.enabled ?? true);
  const [writeSrt, setWriteSrt] = useState(false);
  const [job, setJob] = useState<ExportState>({ state: "idle" });
  const runningJobId = job.state === "running" ? job.jobId : null;

  useEffect(() => {
    if (runningJobId === null || !isTauri()) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    listen(RENDER_PROGRESS_EVENT, (event) => {
      const parsed = RenderProgressSchema.safeParse(event.payload);
      if (active && parsed.success && parsed.data.jobId === runningJobId) {
        setJob((current) => (current.state === "running" ? { ...current, progress: parsed.data } : current));
      }
    })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch((error: Error) => console.warn("render progress listener failed", error.message));
    return () => {
      active = false;
      unlisten?.();
    };
  }, [runningJobId]);

  if (!project || !manifest) return null;

  const canvasAspect = manifest.canvas.width / manifest.canvas.height;
  const aspectOk = (info: PresetInfo): boolean => info.size === null || Math.abs(canvasAspect - info.size.width / info.size.height) / (info.size.width / info.size.height) < 0.01;
  const usedMissing = manifest.scenes.filter((s) => missingIds.has(s.videoClipId)).length;
  const unsynthesized = manifest.scenes.filter((s) => s.audioDurationMs === undefined && s.narration.trim() !== "").length;
  const chosen = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];
  const blocked = manifest.scenes.length === 0 || usedMissing > 0 || !chosen || !aspectOk(chosen);
  const running = job.state === "running";

  const start = async (): Promise<void> => {
    if (!chosen) return;
    const jobId = newJobId();
    const overlay = chosen.size ? buildOverlayAss(manifest, layout, burnSubtitles && manifest.subtitleSettings.enabled ? cues : null) : null;
    setJob({ state: "running", jobId, progress: null });
    const result = await exportStart(jobId, {
      manifestJson: serializeManifest(manifest),
      title: manifest.title,
      preset,
      overlayAss: overlay,
      srt: writeSrt && cues.length > 0 ? toSrt(cues) : null,
    });
    if (!result.ok) {
      if (result.error.kind === "cancelled") {
        setJob({ state: "idle" });
        notify("info", "Ekspor dibatalkan. Tidak ada file setengah jadi yang tersisa.");
      } else {
        setJob({ state: "error", error: result.error });
      }
      return;
    }
    if (result.value === null) {
      setJob({ state: "idle" });
      return;
    }
    setJob({ state: "done", path: result.value });
    notify("success", "Ekspor selesai.");
  };

  const cancel = (): void => {
    if (job.state === "running") void exportCancel(job.jobId);
  };

  const progress = job.state === "running" ? job.progress : null;
  return (
    <div className="mx-auto grid max-w-[1100px] gap-4 p-4 lg:grid-cols-[1fr_380px]">
      <Card title="Preset">
        <div role="radiogroup" aria-label="Preset ekspor" className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((info) => {
            const ok = aspectOk(info);
            const selected = preset === info.id;
            const Icon = info.icon;
            return (
              <button
                key={info.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!ok || running}
                onClick={() => setPreset(info.id)}
                className={`flex items-start gap-3 rounded-md border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected ? "border-accent bg-selected" : "border-line-subtle bg-surface hover:bg-hover"
                }`}
              >
                <Icon size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-fg-2" aria-hidden />
                <span>
                  <span className="block text-[13px] font-medium">{info.label}</span>
                  <span className="block text-[12px] text-fg-2">{ok ? info.detail : "Rasio kanvas proyek tidak cocok"}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="space-y-2 border-t border-line-subtle pt-3">
          <label className="flex min-h-6 items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={burnSubtitles && manifest.subtitleSettings.enabled}
              disabled={!manifest.subtitleSettings.enabled || chosen?.size === null || running}
              onChange={(e) => setBurnSubtitles(e.target.checked)}
            />
            Tanam subtitle ke video (burn-in){!manifest.subtitleSettings.enabled && " — subtitle dimatikan di halaman Efek"}
          </label>
          <label className="flex min-h-6 items-center gap-2 text-[13px]">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={writeSrt} disabled={running} onChange={(e) => setWriteSrt(e.target.checked)} />
            Simpan juga file subtitle .srt di samping hasil
          </label>
          <p className="text-[12px] text-fg-2">
            Loudness:{" "}
            {manifest.loudness.enabled ? `${manifest.loudness.targetLufs} LUFS (dua pass)` : "tidak dinormalisasi"}
            {chosen && manifest.loudness.enabled && chosen.recommendedLufs !== manifest.loudness.targetLufs && ` · disarankan ${chosen.recommendedLufs} LUFS untuk preset ini (ubah di halaman Audio)`}
          </p>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Pemeriksaan">
          <ul className="space-y-1.5 text-[13px]">
            <li>
              <StatusText tone={manifest.scenes.length > 0 ? "success" : "danger"}>
                {manifest.scenes.length} scene · {formatTimecode(layout.durationMs)}
              </StatusText>
            </li>
            <li>
              <StatusText tone={usedMissing === 0 ? "success" : "danger"}>
                {usedMissing === 0 ? "Semua file media ditemukan" : `${usedMissing} scene memakai file yang hilang (hubungkan ulang di Media)`}
              </StatusText>
            </li>
            <li>
              <StatusText tone={unsynthesized === 0 ? "success" : "warning"}>
                {unsynthesized === 0 ? "Semua narasi sudah disintesis" : `${unsynthesized} scene belum disintesis (akan tanpa suara)`}
              </StatusText>
            </li>
          </ul>
        </Card>

        <Card title="Ekspor">
          {job.state === "running" ? (
            <div className="space-y-3" aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-timeline" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress?.percentage ?? 0)}>
                <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${progress?.percentage ?? 0}%` }} />
              </div>
              <p className="font-mono text-[12px] tabular text-fg-2">
                {progress ? (
                  <>
                    {progress.stage === "measure" ? "Mengukur loudness" : "Merender"} · {progress.percentage.toFixed(1)}%
                    {progress.stage === "encode" && ` · ${progress.fps.toFixed(0)} fps · ${progress.speedMultiplier.toFixed(2)}× · sisa ${formatEta(progress.etaSeconds)}`}
                  </>
                ) : (
                  "Menunggu lokasi simpan / menyiapkan…"
                )}
              </p>
              <Button icon={CircleStop} onClick={cancel}>
                Batal
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {job.state === "done" && (
                <p className="text-[13px] break-all">
                  <StatusText tone="success">Tersimpan:</StatusText> <span className="font-mono text-[12px]">{job.path}</span>
                </p>
              )}
              {job.state === "error" && (
                <div role="alert" className="space-y-1 rounded-md border border-danger bg-surface p-3 text-[13px]">
                  <StatusText tone="danger">Ekspor gagal.</StatusText>
                  <p className="font-mono text-[12px] break-all text-fg-2">{job.error.message}</p>
                </div>
              )}
              <Button variant="primary" icon={Upload} disabled={blocked || project.readOnly} onClick={() => void start()}>
                Ekspor video
              </Button>
              <p className="text-[12px] text-fg-2">Anda akan diminta memilih lokasi file. Hasil ditulis ke file sementara lalu diganti nama saat selesai.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
