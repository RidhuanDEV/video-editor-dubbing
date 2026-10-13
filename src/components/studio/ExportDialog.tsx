/**
 * Export dialog (PRD 10 §4.6): preset → format → subtitles → checks with in-place fixes →
 * Export. While rendering the dialog may be closed; progress continues in the status bar.
 */
import { CircleStop, Film, Music, RotateCcw, Smartphone, Upload, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { formatTimecode } from "../../lib/format";
import { serializeManifest } from "../../project/manifest";
import { cancelExport, formatEta, resetExport, startExport, useExportJob } from "../../project/exportJob";
import { buildOverlayAss } from "../../project/overlay";
import type { Readiness } from "../../project/readiness";
import type { Cue } from "../../project/subtitles";
import { toSrt } from "../../project/subtitles";
import type { TimelineLayout } from "../../project/timeline";
import { useWorkspace } from "../../project/workspace";
import type { Codec, PresetId, ProjectManifest } from "../../types";
import { Dialog } from "../Dialog";
import { Button, Checkbox, RadioCards, StatusText } from "../ui";
import { runReadinessAction } from "./ScriptPanel";

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
  { id: "youtube1080", label: "YouTube 1080p", detail: "1920×1080 · 30 fps", icon: Film, size: { width: 1920, height: 1080 }, recommendedLufs: -14 },
  { id: "youtube4k", label: "YouTube 4K", detail: "3840×2160 · 30 fps · file besar", icon: Film, size: { width: 3840, height: 2160 }, recommendedLufs: -14 },
  { id: "shorts", label: "Shorts / TikTok", detail: "1080×1920 · 30 fps", icon: Smartphone, size: { width: 1080, height: 1920 }, recommendedLufs: -14 },
  { id: "whatsapp", label: "WhatsApp ringan", detail: "1280×720 · 25 fps · ukuran kecil", icon: Smartphone, size: { width: 1280, height: 720 }, recommendedLufs: -16 },
  { id: "audioOnly", label: "Audio saja", detail: "Tanpa video", icon: Music, size: null, recommendedLufs: -16 },
];

const CODECS: ReadonlyArray<{ readonly id: Codec; readonly label: string; readonly audioLabel: string; readonly detail: string }> = [
  { id: "av1", label: "AV1 + Opus (WebM)", audioLabel: "Opus (.opus)", detail: "Bebas royalti, file lebih kecil. Didukung YouTube dan browser modern." },
  { id: "h264", label: "H.264 + AAC (MP4)", audioLabel: "AAC (.m4a)", detail: "Paling kompatibel (WhatsApp, pemutar lama). Lisensi paten tanggung jawab distributor." },
];

function aspectOk(manifest: ProjectManifest, info: PresetInfo): boolean {
  if (info.size === null) return true;
  const canvas = manifest.canvas.width / manifest.canvas.height;
  const preset = info.size.width / info.size.height;
  return Math.abs(canvas - preset) / preset < 0.01;
}

function Progress() {
  const job = useExportJob((s) => s.job);
  if (job.state !== "running") return null;
  const progress = job.progress;
  return (
    <div className="space-y-3" aria-live="polite">
      <div className="h-2 overflow-hidden rounded-full bg-timeline" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress?.percentage ?? 0)}>
        <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${progress?.percentage ?? 0}%` }} />
      </div>
      <p className="font-mono text-caption tabular text-fg-2">
        {progress ? (
          <>
            {progress.stage === "measure" ? "Mengukur loudness" : "Merender"} · {progress.percentage.toFixed(1)}%
            {progress.stage === "encode" && ` · ${progress.fps.toFixed(0)} fps · ${progress.speedMultiplier.toFixed(2)}× · sisa ${formatEta(progress.etaSeconds)}`}
          </>
        ) : (
          "Menunggu lokasi simpan / menyiapkan…"
        )}
      </p>
      <p className="text-caption text-fg-muted">Dialog ini boleh ditutup; progres tetap terlihat di bilah status bawah.</p>
    </div>
  );
}

export function ExportDialog({ manifest, readiness, readOnly, layout, cues }: {
  readonly manifest: ProjectManifest;
  readonly readiness: Readiness;
  readonly readOnly: boolean;
  readonly layout: TimelineLayout;
  readonly cues: ReadonlyArray<Cue>;
}) {
  const open = useWorkspace((s) => s.dialog === "export");
  const close = useWorkspace((s) => s.closeDialog);
  const job = useExportJob((s) => s.job);
  const [preset, setPreset] = useState<PresetId>(manifest.canvas.aspectRatio === "9:16" ? "shorts" : "youtube1080");
  const [codec, setCodec] = useState<Codec>("av1");
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [writeSrt, setWriteSrt] = useState(false);
  const chosen = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];
  const presetOk = chosen !== undefined && aspectOk(manifest, chosen);
  const audioOnly = chosen?.size === null;
  const subtitlesOn = manifest.subtitleSettings.enabled;

  const start = (): void => {
    if (!chosen) return;
    const overlay = chosen.size ? buildOverlayAss(manifest, layout, burnSubtitles && subtitlesOn ? cues : null) : null;
    void startExport({
      manifestJson: serializeManifest(manifest),
      title: manifest.title,
      preset,
      codec,
      overlayAss: overlay,
      srt: writeSrt && cues.length > 0 ? toSrt(cues) : null,
    });
  };

  const actions =
    job.state === "running" ? (
      <>
        <Button onClick={close}>Tutup (lanjut di latar)</Button>
        <Button variant="danger" icon={CircleStop} onClick={cancelExport}>
          Batalkan ekspor
        </Button>
      </>
    ) : job.state === "done" || job.state === "error" ? (
      <>
        <Button onClick={close}>Tutup</Button>
        <Button variant="primary" icon={RotateCcw} onClick={resetExport}>
          Ekspor lagi
        </Button>
      </>
    ) : (
      <>
        <Button onClick={close}>Batal</Button>
        <Button
          variant="primary"
          icon={Upload}
          disabled={readOnly || !readiness.canExport || !presetOk}
          tooltip={!readiness.canExport ? "Selesaikan pemeriksaan bertanda merah dulu" : !presetOk ? "Rasio kanvas tidak cocok dengan preset ini" : "Pilih lokasi file lalu mulai render"}
          onClick={start}
        >
          Ekspor
        </Button>
      </>
    );

  return (
    <Dialog open={open} title="Ekspor video" width="lg" onClose={close} actions={actions}>
      {job.state === "running" ? (
        <Progress />
      ) : job.state === "done" ? (
        <div className="space-y-2">
          <StatusText tone="success">Ekspor selesai.</StatusText>
          <p className="font-mono text-caption break-all text-fg-2">{job.path}</p>
        </div>
      ) : job.state === "error" ? (
        <div role="alert" className="space-y-1 rounded-md border border-danger bg-surface p-3">
          <StatusText tone="danger">Ekspor gagal.</StatusText>
          <p className="font-mono text-caption break-all text-fg-2">{job.error.message}</p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[1fr_260px]">
          <div className="space-y-4">
            <section className="space-y-2">
              <h3 className="panel-title">Tujuan</h3>
              <RadioCards
                label="Preset ekspor"
                columns={2}
                value={preset}
                onChange={setPreset}
                options={PRESETS.map((info) => ({
                  value: info.id,
                  label: info.label,
                  detail: aspectOk(manifest, info) ? info.detail : `Butuh kanvas ${info.size?.width}×${info.size?.height} (ubah di panel Proyek)`,
                  icon: info.icon,
                  disabled: !aspectOk(manifest, info),
                }))}
              />
            </section>
            <section className="space-y-2">
              <h3 className="panel-title">Format</h3>
              <RadioCards label="Format ekspor" value={codec} onChange={setCodec} options={CODECS.map((c) => ({ value: c.id, label: audioOnly ? c.audioLabel : c.label, detail: c.detail }))} />
              {preset === "whatsapp" && codec === "av1" && <StatusText tone="warning">WhatsApp belum memutar AV1 dengan andal; pilih H.264 untuk preset ini.</StatusText>}
            </section>
            <section className="space-y-2">
              <h3 className="panel-title">Subtitle</h3>
              <Checkbox checked={burnSubtitles && subtitlesOn} disabled={!subtitlesOn || audioOnly} onChange={setBurnSubtitles}>
                Tanam subtitle ke video{!subtitlesOn && " (subtitle dimatikan di panel Proyek)"}
              </Checkbox>
              <Checkbox checked={writeSrt} onChange={setWriteSrt}>
                Simpan juga file .srt di samping hasil
              </Checkbox>
            </section>
          </div>

          <aside className="space-y-3">
            <h3 className="panel-title">Pemeriksaan</h3>
            <ul className="space-y-2.5">
              {readiness.items.map((item) => (
                <li key={item.id} className="space-y-1">
                  <StatusText tone={item.ok ? "success" : item.blocking ? "danger" : "warning"}>{item.label}</StatusText>
                  {!item.ok && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-5"
                      disabled={readOnly}
                      onClick={() => {
                        close();
                        runReadinessAction(item.action, manifest);
                      }}
                    >
                      {item.actionLabel}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <p className="border-t border-line-subtle pt-3 text-caption text-fg-2">
              Durasi {formatTimecode(layout.durationMs)} · Loudness {manifest.loudness.enabled ? `${manifest.loudness.targetLufs} LUFS` : "tidak dinormalisasi"}
              {chosen && manifest.loudness.enabled && chosen.recommendedLufs !== manifest.loudness.targetLufs && ` (disarankan ${chosen.recommendedLufs} LUFS)`}
            </p>
            <p className="text-caption text-fg-muted">Anda akan memilih lokasi file. Hasil ditulis ke file sementara dan baru diganti nama saat selesai.</p>
          </aside>
        </div>
      )}
    </Dialog>
  );
}
