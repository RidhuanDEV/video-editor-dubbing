/**
 * Contextual inspector (PRD 10 §4.2): the selection decides what is shown — scene, effect or
 * BGM — and with nothing selected it shows the project settings (canvas, default voice,
 * subtitles, audio). One place per setting; narration text is edited in the script panel.
 */
import { AudioLines, Film, Music, Plus, RotateCcw, Settings2, Sparkles, Trash2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { projectFileUrl } from "../../lib/format";
import {
  CANVAS_SIZE,
  effectiveVoice,
  removeBgmTrack,
  removeEffect,
  replaceEffect,
  setAudioMix,
  setCanvas,
  setDefaultVoice,
  setProjectTitle,
  setSceneVoice,
  updateBgmTrack,
  updateScene,
} from "../../project/commands";
import { EFFECT_LABEL } from "../../project/effects";
import { useEditor } from "../../project/editor";
import { useProjectStore } from "../../project/store";
import { formatSeconds, sceneSync } from "../../project/sync";
import { pendingSceneIds, synthesizeAll, synthesizeScene, useSynthesis } from "../../project/synthesis";
import { isTrackLocked, type SceneSegment } from "../../project/timeline";
import { executeWithUndo } from "../../project/undoable";
import { useWorkspace } from "../../project/workspace";
import {
  AspectRatioSchema,
  FitModeSchema,
  type AspectRatio,
  type AudioTrackConfig,
  type BadgeCalloutEffect,
  type FitMode,
  type ProjectManifest,
  type SceneAlignmentMode,
  type SceneEffect,
  type ScriptScene,
} from "../../types";
import { SyncBadge } from "../SyncBadge";
import { Button, Checkbox, Disclosure, Field, INPUT_CLASS, NumberField, Segmented, Select, Slider, StatusText, type SelectOption } from "../ui";
import { clipOption, SubtitleFields, VoiceFields } from "./fields";

function Section({ title, children, actions }: { readonly title: string; readonly children: ReactNode; readonly actions?: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line-subtle px-4 py-4 last:border-b-0" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="panel-title">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Header({ icon: Icon, kicker, title }: { readonly icon: typeof Film; readonly kicker: string; readonly title: string }) {
  return (
    // Not <header>: only the app title bar is the page banner landmark.
    <div className="flex items-center gap-2 border-b border-line-subtle px-4 py-3">
      <Icon size={16} strokeWidth={1.75} className="shrink-0 text-fg-2" aria-hidden />
      <div className="min-w-0">
        <p className="text-caption text-fg-2">{kicker}</p>
        <p className="truncate text-ui font-semibold" title={title}>
          {title}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const ALIGNMENT: ReadonlyArray<SelectOption<SceneAlignmentMode>> = [
  { value: "freeze-frame", label: "Tahan frame terakhir", detail: "Video berhenti sampai narasi selesai" },
  { value: "ripple-cut", label: "Potong ekor video", detail: "Video dipotong mengikuti narasi" },
  { value: "natural-pause", label: "Biarkan apa adanya", detail: "Tanpa penyesuaian" },
];

function SceneInspector({ manifest, root, readOnly, scene, index }: {
  readonly manifest: ProjectManifest;
  readonly root: string;
  readonly readOnly: boolean;
  readonly scene: ScriptScene;
  readonly index: number;
}) {
  const ids = { clip: useId(), start: useId(), end: useId(), rate: useId(), align: useId(), voice: useId() };
  const execute = useProjectStore((s) => s.execute);
  const synthesis = useSynthesis((s) => s.byScene.get(scene.id));
  const videos = manifest.assets.filter((a) => a.kind === "video");
  const clip = manifest.assets.find((a) => a.id === scene.videoClipId);
  const clipMaxMs = clip?.durationMs ?? Number.MAX_SAFE_INTEGER;
  const voice = effectiveVoice(manifest, scene);
  const hasOverride = scene.voiceOverride !== undefined;

  const setTrim = (field: "videoTrimStartMs" | "videoTrimEndMs", seconds: number): void => {
    const ms = Math.round(seconds * 1000);
    const start = field === "videoTrimStartMs" ? ms : scene.videoTrimStartMs;
    const end = field === "videoTrimEndMs" ? ms : scene.videoTrimEndMs;
    // Invalid ranges are ignored; the field then shows the previous value again.
    if (end > start && end <= clipMaxMs) execute(updateScene(manifest, scene.id, { [field]: ms }));
  };

  return (
    <>
      <Header icon={Film} kicker={`Scene ${index + 1}`} title={scene.title || "(tanpa judul)"} />

      <Section title="Suara narasi">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={scene.audioDurationMs === undefined ? "primary" : "secondary"}
            icon={scene.audioDurationMs === undefined ? AudioLines : RotateCcw}
            loading={synthesis?.state === "loading"}
            disabled={readOnly || scene.narration.trim() === ""}
            tooltip={scene.narration.trim() === "" ? "Tulis narasi scene ini dulu di panel Naskah" : "Buat suara dari narasi"}
            shortcut="Ctrl+Enter"
            onClick={() => void synthesizeScene(scene.id)}
          >
            {scene.audioDurationMs === undefined ? "Sintesis suara" : "Sintesis ulang"}
          </Button>
          <SyncBadge sync={sceneSync(scene)} synthesis={synthesis} />
        </div>
        {synthesis?.state === "error" && <StatusText tone="danger">{synthesis.error.message}</StatusText>}
        {scene.audioCachePath !== undefined && scene.audioDurationMs !== undefined && (
          <div className="space-y-1">
            <audio key={scene.audioCachePath} controls preload="metadata" className="h-8 w-full" src={projectFileUrl(root, scene.audioCachePath)}>
              <track kind="captions" />
            </audio>
            <p className="font-mono text-caption tabular text-fg-2">Durasi {formatSeconds(scene.audioDurationMs)}</p>
          </div>
        )}
        <Checkbox
          checked={!hasOverride}
          disabled={readOnly}
          onChange={(useDefault) => execute(setSceneVoice(manifest, scene.id, useDefault ? null : { ...manifest.defaultVoice }))}
        >
          Pakai suara default proyek
        </Checkbox>
        {hasOverride && <VoiceFields idPrefix={ids.voice} voice={voice} disabled={readOnly} onChange={(next) => execute(setSceneVoice(manifest, scene.id, next))} />}
      </Section>

      <Section title="Klip video">
        <Field id={ids.clip} label="Rekaman">
          <Select
            id={ids.clip}
            value={scene.videoClipId}
            options={[...(clip ? [] : [{ value: scene.videoClipId, label: "(file tidak ada di media)" }]), ...videos.map(clipOption)]}
            disabled={readOnly}
            onChange={(id) => {
              const next = videos.find((v) => v.id === id);
              if (!next) return;
              const end = Math.min(scene.videoTrimEndMs, next.durationMs ?? scene.videoTrimEndMs);
              execute(updateScene(manifest, scene.id, { videoClipId: next.id, videoTrimStartMs: 0, videoTrimEndMs: Math.max(end, 1) }));
            }}
          />
        </Field>
        <Field id={ids.align} label="Jika narasi lebih panjang dari video">
          <Select
            id={ids.align}
            value={scene.alignmentMode}
            options={ALIGNMENT}
            disabled={readOnly}
            onChange={(alignmentMode) => execute(updateScene(manifest, scene.id, { alignmentMode }))}
          />
        </Field>
        <Disclosure title="Lanjutan: potongan & kecepatan">
          <p className="text-caption text-fg-2">Potongan juga bisa diubah dengan menyeret tepi klip di timeline.</p>
          <div className="grid grid-cols-3 gap-3">
            <Field id={ids.start} label="Mulai (dtk)">
              <NumberField id={ids.start} min={0} max={clipMaxMs / 1000} step={0.1} value={scene.videoTrimStartMs / 1000} disabled={readOnly} onCommit={(v) => setTrim("videoTrimStartMs", v)} />
            </Field>
            <Field id={ids.end} label="Selesai (dtk)">
              <NumberField id={ids.end} min={0} max={clipMaxMs / 1000} step={0.1} value={scene.videoTrimEndMs / 1000} disabled={readOnly} onCommit={(v) => setTrim("videoTrimEndMs", v)} />
            </Field>
            <Field id={ids.rate} label="Kecepatan">
              <NumberField
                id={ids.rate}
                min={0.25}
                max={4}
                step={0.05}
                value={scene.playbackRate}
                disabled={readOnly}
                onCommit={(playbackRate) => execute(updateScene(manifest, scene.id, { playbackRate }))}
              />
            </Field>
          </div>
        </Disclosure>
      </Section>

      <Section title={`Efek (${scene.effects.length})`}>
        {scene.effects.length === 0 ? (
          <p className="text-caption text-fg-2">Tambah zoom, blur, atau badge dengan alat di atas preview, lalu seret di area video.</p>
        ) : (
          <ul className="space-y-1">
            {scene.effects.map((effect) => (
              <li key={effect.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-sm border border-line-subtle bg-surface px-2 py-1.5 text-left text-ui hover:bg-hover"
                  onClick={() => useEditor.getState().select({ type: "effect", sceneId: scene.id, id: effect.id })}
                >
                  <span>
                    {EFFECT_LABEL[effect.type]}
                    {effect.type === "callout" ? `: ${effect.label}` : ""}
                  </span>
                  <span className="font-mono text-caption tabular text-fg-2">
                    {(effect.startOffsetMs / 1000).toFixed(1)}–{((effect.startOffsetMs + effect.durationMs) / 1000).toFixed(1)}s
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Effect
// ---------------------------------------------------------------------------

const POSITIONS: ReadonlyArray<SelectOption<BadgeCalloutEffect["position"]>> = [
  { value: "top-left", label: "Kiri atas" },
  { value: "top-right", label: "Kanan atas" },
  { value: "bottom-left", label: "Kiri bawah" },
  { value: "bottom-right", label: "Kanan bawah" },
];

function EffectInspector({ manifest, segment, effect }: { readonly manifest: ProjectManifest; readonly segment: SceneSegment; readonly effect: SceneEffect }) {
  const ids = { start: useId(), duration: useId(), scale: useId(), strength: useId(), label: useId(), position: useId() };
  const execute = useProjectStore((s) => s.execute);
  const readOnly = useProjectStore((s) => s.project?.readOnly ?? true);
  const disabled = readOnly || isTrackLocked(manifest.tracks, "effects");
  const sceneMs = segment.endMs - segment.startMs;
  const set = (next: SceneEffect, key?: string): void => execute(replaceEffect(manifest, segment.scene.id, next, key));

  return (
    <>
      <Header icon={Sparkles} kicker={`Efek · Scene ${segment.index + 1}`} title={EFFECT_LABEL[effect.type]} />
      <Section title="Waktu">
        <div className="grid grid-cols-2 gap-3">
          <Field id={ids.start} label="Mulai (dtk dari awal scene)">
            <NumberField
              id={ids.start}
              min={0}
              max={Math.max(0, (sceneMs - 100) / 1000)}
              step={0.1}
              value={effect.startOffsetMs / 1000}
              disabled={disabled}
              onCommit={(v) => set({ ...effect, startOffsetMs: Math.round(v * 1000), durationMs: Math.min(effect.durationMs, sceneMs - Math.round(v * 1000)) })}
            />
          </Field>
          <Field id={ids.duration} label="Durasi (dtk)">
            <NumberField
              id={ids.duration}
              min={0.1}
              max={(sceneMs - effect.startOffsetMs) / 1000}
              step={0.1}
              value={effect.durationMs / 1000}
              disabled={disabled}
              onCommit={(v) => set({ ...effect, durationMs: Math.round(v * 1000) })}
            />
          </Field>
        </div>
      </Section>
      <Section title="Tampilan">
        {effect.type === "zoom" && (
          <>
            <Field id={ids.scale} label="Skala (1–8×)" hint={effect.spotlightMask ? "Area fokus seluas 1/skala tetap terang, sisanya digelapkan." : "Masuk dan keluar halus 300 ms."}>
              <NumberField id={ids.scale} min={1} max={8} step={0.1} value={effect.scale} disabled={disabled} onCommit={(v) => set({ ...effect, scale: v })} />
            </Field>
            <Checkbox checked={effect.spotlightMask} disabled={disabled} onChange={(checked) => set({ ...effect, spotlightMask: checked })}>
              Mode spotlight (gelapkan sekitar, tanpa zoom)
            </Checkbox>
            <p className="text-caption text-fg-2">Seret kotak di preview untuk memindah; seret sudutnya untuk mengubah skala.</p>
          </>
        )}
        {effect.type === "blur" && (
          <>
            <Field id={ids.strength} label={`Kekuatan blur ${effect.blurStrength}`}>
              <Slider id={ids.strength} min={1} max={100} value={effect.blurStrength} disabled={disabled} onChange={(v) => set({ ...effect, blurStrength: v }, `effect:${effect.id}:strength`)} />
            </Field>
            <p className="text-caption text-fg-2">
              Area {effect.rect.width}×{effect.rect.height} px. Seret kotak di preview untuk memindah atau mengubah ukuran.
            </p>
          </>
        )}
        {effect.type === "callout" && (
          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <Field id={ids.label} label="Teks badge">
              <input
                id={ids.label}
                className={INPUT_CLASS}
                value={effect.label}
                maxLength={60}
                disabled={disabled}
                onChange={(e) => e.target.value.trim() !== "" && set({ ...effect, label: e.target.value }, `effect:${effect.id}:label`)}
              />
            </Field>
            <Field id={ids.position} label="Posisi">
              <Select id={ids.position} value={effect.position} options={POSITIONS} disabled={disabled} onChange={(position) => set({ ...effect, position })} />
            </Field>
          </div>
        )}
      </Section>
      <div className="px-4 py-4">
        <Button
          variant="danger"
          icon={Trash2}
          disabled={disabled}
          shortcut="Delete"
          tooltip="Hapus efek (bisa diurungkan)"
          onClick={() => {
            executeWithUndo(removeEffect(manifest, segment.scene.id, effect.id), "Efek dihapus.");
            useEditor.getState().select(null);
          }}
        >
          Hapus efek
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// BGM
// ---------------------------------------------------------------------------

function BgmFields({ manifest, track }: { readonly manifest: ProjectManifest; readonly track: AudioTrackConfig }) {
  const ids = { volume: useId(), duck: useId() };
  const execute = useProjectStore((s) => s.execute);
  const readOnly = useProjectStore((s) => s.project?.readOnly ?? true);
  const locked = isTrackLocked(manifest.tracks, "bgm") || readOnly;
  const set = (patch: Parameters<typeof updateBgmTrack>[2], key: string): void =>
    execute(updateBgmTrack(manifest, track.id, patch, "Ubah BGM", `bgm:${track.id}:${key}`));
  return (
    <div className="space-y-3">
      <Field id={ids.volume} label={`Volume ${Math.round(track.volume * 100)}%`}>
        <Slider id={ids.volume} min={0} max={100} value={Math.round(track.volume * 100)} disabled={locked} onChange={(v) => set({ volume: v / 100 }, "volume")} />
      </Field>
      <Checkbox checked={track.autoDuck} disabled={locked} onChange={(autoDuck) => set({ autoDuck }, "autoDuck")}>
        Kecilkan otomatis saat ada narasi (ducking)
      </Checkbox>
      {track.autoDuck && (
        <Field id={ids.duck} label={`Volume saat narasi ${Math.round(track.duckVolume * 100)}%`} hint="Preview hanya mendekati; ekspor memakai sidechain FFmpeg.">
          <Slider id={ids.duck} min={0} max={100} value={Math.round(track.duckVolume * 100)} disabled={locked} onChange={(v) => set({ duckVolume: v / 100 }, "duck")} />
        </Field>
      )}
    </div>
  );
}

function BgmInspector({ manifest, track }: { readonly manifest: ProjectManifest; readonly track: AudioTrackConfig }) {
  const readOnly = useProjectStore((s) => s.project?.readOnly ?? true);
  const locked = isTrackLocked(manifest.tracks, "bgm") || readOnly;
  return (
    <>
      <Header icon={Music} kicker="Musik latar (BGM)" title={track.label} />
      <Section title="Mix">
        <BgmFields manifest={manifest} track={track} />
        <p className="text-caption text-fg-2">Geser klip di timeline untuk memindah; seret tepi kanannya untuk memotong.</p>
      </Section>
      <div className="px-4 py-4">
        <Button
          variant="danger"
          icon={Trash2}
          disabled={locked}
          shortcut="Delete"
          tooltip="Hapus musik (bisa diurungkan)"
          onClick={() => {
            executeWithUndo(removeBgmTrack(manifest, track.id), "Musik latar dihapus.");
            useEditor.getState().select(null);
          }}
        >
          Hapus musik
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Project (nothing selected)
// ---------------------------------------------------------------------------

const ASPECTS: ReadonlyArray<{ readonly value: AspectRatio; readonly label: string }> = AspectRatioSchema.options.map((value) => ({ value, label: value }));
const FIT_LABEL: Readonly<Record<FitMode, string>> = { contain: "Utuh (ada pinggiran)", cover: "Penuhi (terpotong)", fill: "Regangkan" };
const LOUDNESS_PRESETS: ReadonlyArray<{ readonly lufs: number; readonly label: string }> = [
  { lufs: -14, label: "-14 LUFS (YouTube, media sosial)" },
  { lufs: -16, label: "-16 LUFS (podcast, WhatsApp)" },
  { lufs: -23, label: "-23 LUFS (siaran EBU R128)" },
];

function ProjectInspector({ manifest, readOnly }: { readonly manifest: ProjectManifest; readonly readOnly: boolean }) {
  const ids = { title: useId(), fit: useId(), background: useId(), voice: useId(), lufs: useId(), gap: useId() };
  const execute = useProjectStore((s) => s.execute);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const pending = pendingSceneIds(manifest.scenes).length;
  const batch = useSynthesis((s) => s.batch);
  const { loudness, canvas } = manifest;
  const customLufs = !LOUDNESS_PRESETS.some((p) => p.lufs === loudness.targetLufs);
  const commitTitle = (): void => {
    if (titleDraft !== null) execute(setProjectTitle(manifest, titleDraft));
    setTitleDraft(null);
  };

  return (
    <>
      <Header icon={Settings2} kicker="Proyek" title={manifest.title} />
      <Section title="Umum">
        <Field id={ids.title} label="Judul proyek" hint="Juga nama file saat ekspor.">
          <input
            id={ids.title}
            className={INPUT_CLASS}
            value={titleDraft ?? manifest.title}
            maxLength={255}
            disabled={readOnly}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => e.key === "Enter" && commitTitle()}
          />
        </Field>
      </Section>

      <Section title="Kanvas">
        <div className="space-y-1.5">
          <p className="text-caption font-medium text-fg-2">Rasio</p>
          <Segmented label="Rasio kanvas" value={canvas.aspectRatio} options={ASPECTS} disabled={readOnly} onChange={(aspectRatio) => execute(setCanvas(manifest, { aspectRatio }))} />
          <p className="font-mono text-caption tabular text-fg-muted">
            {CANVAS_SIZE[canvas.aspectRatio].width}×{CANVAS_SIZE[canvas.aspectRatio].height} · {canvas.fps} fps
          </p>
        </div>
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <Field id={ids.fit} label="Rekaman di dalam kanvas">
            <Select
              id={ids.fit}
              value={canvas.fit}
              options={FitModeSchema.options.map((value) => ({ value, label: FIT_LABEL[value] }))}
              disabled={readOnly}
              onChange={(fit) => execute(setCanvas(manifest, { fit }))}
            />
          </Field>
          <Field id={ids.background} label="Latar">
            <input
              id={ids.background}
              type="color"
              className={`${INPUT_CLASS} cursor-pointer p-0.5`}
              value={canvas.background.toLowerCase()}
              disabled={readOnly}
              onChange={(e) => execute(setCanvas(manifest, { background: e.target.value.toUpperCase() }, "canvas:background"))}
            />
          </Field>
        </div>
      </Section>

      <Section title="Suara default">
        <VoiceFields idPrefix={ids.voice} voice={manifest.defaultVoice} disabled={readOnly} onChange={(voice) => execute(setDefaultVoice(manifest, voice))} />
        <Button
          icon={AudioLines}
          className="w-full"
          disabled={readOnly || pending === 0}
          loading={batch !== null}
          tooltip={pending === 0 ? "Semua narasi sudah bersuara" : "Buat suara untuk semua scene yang belum"}
          onClick={() => void synthesizeAll()}
        >
          {batch ? `Menyintesis ${batch.done + 1}/${batch.total}…` : `Sintesis semua yang belum (${pending})`}
        </Button>
      </Section>

      <Section title="Subtitle">
        <SubtitleFields manifest={manifest} disabled={readOnly} />
      </Section>

      <Section
        title="Audio"
        actions={
          <Button size="sm" variant="ghost" icon={Plus} disabled={readOnly} onClick={() => useWorkspace.getState().openDialog("addBgm")}>
            Musik
          </Button>
        }
      >
        <Checkbox checked={loudness.enabled} disabled={readOnly} onChange={(enabled) => execute(setAudioMix(manifest, { loudness: { ...loudness, enabled } }, "audio:loudness"))}>
          Samakan kekerasan suara saat ekspor (EBU R128)
        </Checkbox>
        <Field id={ids.lufs} label="Target">
          <Select
            id={ids.lufs}
            value={String(loudness.targetLufs)}
            options={[
              ...(customLufs ? [{ value: String(loudness.targetLufs), label: `${loudness.targetLufs} LUFS (kustom)` }] : []),
              ...LOUDNESS_PRESETS.map((p) => ({ value: String(p.lufs), label: p.label })),
            ]}
            disabled={readOnly || !loudness.enabled}
            onChange={(value) => execute(setAudioMix(manifest, { loudness: { ...loudness, targetLufs: Number(value) } }, "audio:lufs"))}
          />
        </Field>
        <Field id={ids.gap} label="Jeda antar-scene (ms)" hint="Napas di akhir setiap scene; frame terakhir ditahan.">
          <NumberField id={ids.gap} min={0} max={5000} step={50} value={manifest.sceneGapMs} disabled={readOnly} onCommit={(v) => execute(setAudioMix(manifest, { sceneGapMs: Math.round(v) }, "audio:gap"))} />
        </Field>
        <p className="text-caption text-fg-2">Bisukan atau solo track lewat tombol di kepala track timeline.</p>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

export function Inspector({ manifest, root, readOnly, segment }: {
  readonly manifest: ProjectManifest;
  readonly root: string;
  readonly readOnly: boolean;
  /** Segment of the selected effect's scene, for timing limits. */
  readonly segment: (sceneId: string) => SceneSegment | null;
}) {
  const selection = useEditor((s) => s.selection);
  const body = (() => {
    if (selection?.type === "scene") {
      const index = manifest.scenes.findIndex((s) => s.id === selection.id);
      const scene = manifest.scenes[index];
      if (scene) return <SceneInspector key={scene.id} manifest={manifest} root={root} readOnly={readOnly} scene={scene} index={index} />;
    }
    if (selection?.type === "effect") {
      const sceneSegment = segment(selection.sceneId);
      const effect = sceneSegment?.scene.effects.find((e) => e.id === selection.id);
      if (sceneSegment && effect) return <EffectInspector key={effect.id} manifest={manifest} segment={sceneSegment} effect={effect} />;
    }
    if (selection?.type === "bgm") {
      const track = manifest.bgmTracks.find((t) => t.id === selection.id);
      if (track) return <BgmInspector key={track.id} manifest={manifest} track={track} />;
    }
    return <ProjectInspector manifest={manifest} readOnly={readOnly} />;
  })();
  return <div className="min-h-0 overflow-auto">{body}</div>;
}

