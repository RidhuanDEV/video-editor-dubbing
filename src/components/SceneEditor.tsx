/** Editor for one scene: text, clip & trim, alignment, voice, synthesis + preview. */
import { AudioLines, RotateCcw } from "lucide-react";
import { useId, type ReactNode } from "react";
import { formatTimecode, projectFileUrl } from "../lib/format";
import { formatSigned, parseSigned, sortVoices, useVoices } from "../lib/voices";
import { effectiveVoice, setSceneVoice, updateScene } from "../project/commands";
import { fileNameOf } from "../project/manifest";
import { estimateNarrationMs, formatSeconds, sceneSync } from "../project/sync";
import { synthesizeScene, useSynthesis } from "../project/synthesis";
import { useProjectStore } from "../project/store";
import { SceneAlignmentModeSchema, type SceneAlignmentMode, type ScriptScene, type VoiceConfig, type VoiceEngine } from "../types";
import { SyncBadge } from "./SyncBadge";
import { Button, Field, INPUT_CLASS, NumberField, StatusText } from "./ui";

const ALIGNMENT_LABEL: Readonly<Record<SceneAlignmentMode, string>> = {
  "freeze-frame": "Freeze-frame (tahan frame terakhir)",
  "ripple-cut": "Ripple-cut (potong ekor video)",
  "natural-pause": "Natural pause (tanpa penyesuaian)",
};

const SELECT_CLASS = `${INPUT_CLASS} pr-8`;

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line-subtle pb-4 last:border-b-0" aria-label={title}>
      <h3 className="panel-title">{title}</h3>
      {children}
    </section>
  );
}

/** Engines offered in the UI; "kokoro-local"/"custom-api" exist in the schema but are not built yet. */
const TTS_ENGINES: ReadonlyArray<{ readonly id: VoiceEngine; readonly label: string }> = [
  { id: "edge-tts", label: "Edge-TTS (tidak resmi)" },
  { id: "azure-speech", label: "Azure Speech (resmi)" },
];

/** Shared voice controls for the project default and per-scene overrides. */
export function VoiceFields({
  idPrefix,
  voice,
  onChange,
  disabled,
}: {
  readonly idPrefix: string;
  readonly voice: VoiceConfig;
  readonly onChange: (voice: VoiceConfig) => void;
  readonly disabled: boolean;
}) {
  const { voices, status } = useVoices(voice.engine);
  const sorted = sortVoices(voices);
  const known = sorted.some((v) => v.shortName === voice.voiceId);
  const offlineHint =
    voice.engine === "azure-speech" ? "Daftar suara Azure belum tersedia (atur kunci di Pengaturan)." : "Daftar suara terbatas (offline atau belum disetujui).";
  return (
    <div className="grid grid-cols-[1.4fr_2fr_1fr_1fr] gap-3">
      <Field id={`${idPrefix}-engine`} label="Engine">
        <select
          id={`${idPrefix}-engine`}
          className={SELECT_CLASS}
          value={voice.engine}
          disabled={disabled}
          onChange={(e) => {
            const engine = TTS_ENGINES.find((option) => option.id === e.target.value);
            if (engine) onChange({ ...voice, engine: engine.id });
          }}
        >
          {TTS_ENGINES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${idPrefix}-voice`} label="Suara" {...(status === "offline" && { hint: offlineHint })}>
        <select
          id={`${idPrefix}-voice`}
          className={SELECT_CLASS}
          value={voice.voiceId}
          disabled={disabled}
          onChange={(e) => onChange({ ...voice, voiceId: e.target.value })}
        >
          {!known && <option value={voice.voiceId}>{voice.voiceId}</option>}
          {sorted.map((v) => (
            <option key={v.shortName} value={v.shortName}>
              {v.shortName} ({v.gender})
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${idPrefix}-rate`} label="Kecepatan (%)">
        <NumberField
          id={`${idPrefix}-rate`}
          min={-50}
          max={100}
          step={5}
          value={parseSigned(voice.rate)}
          disabled={disabled}
          onCommit={(value) => onChange({ ...voice, rate: formatSigned(value, "%") })}
        />
      </Field>
      <Field id={`${idPrefix}-pitch`} label="Nada (Hz)">
        <NumberField
          id={`${idPrefix}-pitch`}
          min={-50}
          max={50}
          step={1}
          value={parseSigned(voice.pitch)}
          disabled={disabled}
          onCommit={(value) => onChange({ ...voice, pitch: formatSigned(value, "Hz") })}
        />
      </Field>
    </div>
  );
}

export function SceneEditor({ scene }: { readonly scene: ScriptScene }) {
  const ids = { title: useId(), narration: useId(), clip: useId(), start: useId(), end: useId(), rate: useId(), align: useId(), voice: useId() };
  const project = useProjectStore((s) => s.project);
  const execute = useProjectStore((s) => s.execute);
  const synthesis = useSynthesis((s) => s.byScene.get(scene.id));
  if (!project) return null;

  const { manifest, root, readOnly } = project;
  const videos = manifest.assets.filter((a) => a.kind === "video");
  const clip = manifest.assets.find((a) => a.id === scene.videoClipId);
  const clipMaxMs = clip?.durationMs ?? Number.MAX_SAFE_INTEGER;
  const voice = effectiveVoice(manifest, scene);
  const hasOverride = scene.voiceOverride !== undefined;
  const edit = (patch: Parameters<typeof updateScene>[2], field: string): void =>
    execute(updateScene(manifest, scene.id, patch, `scene:${scene.id}:${field}`));

  const setTrim = (field: "videoTrimStartMs" | "videoTrimEndMs", seconds: number): void => {
    const ms = Math.round(seconds * 1000);
    const start = field === "videoTrimStartMs" ? ms : scene.videoTrimStartMs;
    const end = field === "videoTrimEndMs" ? ms : scene.videoTrimEndMs;
    // Invalid ranges are ignored; the field then shows the previous value again.
    if (end > start && end <= clipMaxMs) execute(updateScene(manifest, scene.id, { [field]: ms }));
  };

  return (
    <div className="space-y-4 p-4">
      <Section title="Naskah">
        <Field id={ids.title} label="Judul scene">
          <input
            id={ids.title}
            className={INPUT_CLASS}
            value={scene.title}
            maxLength={255}
            disabled={readOnly}
            onChange={(e) => edit({ title: e.target.value }, "title")}
          />
        </Field>
        <Field
          id={ids.narration}
          label="Narasi"
          hint={`${scene.narration.length} karakter · perkiraan ${formatSeconds(estimateNarrationMs(scene.narration))}`}
        >
          <textarea
            id={ids.narration}
            className={`${INPUT_CLASS} h-36 resize-y py-2 text-[14px] leading-[22px]`}
            value={scene.narration}
            disabled={readOnly}
            onChange={(e) => edit({ narration: e.target.value }, "narration")}
          />
        </Field>
      </Section>

      <Section title="Klip video">
        <Field id={ids.clip} label="Sumber">
          <select
            id={ids.clip}
            className={SELECT_CLASS}
            value={scene.videoClipId}
            disabled={readOnly}
            onChange={(e) => {
              const next = videos.find((v) => v.id === e.target.value);
              if (!next) return;
              const end = Math.min(scene.videoTrimEndMs, next.durationMs ?? scene.videoTrimEndMs);
              execute(updateScene(manifest, scene.id, { videoClipId: next.id, videoTrimStartMs: 0, videoTrimEndMs: Math.max(end, 1) }));
            }}
          >
            {!clip && <option value={scene.videoClipId}>(aset tidak ada)</option>}
            {videos.map((v) => (
              <option key={v.id} value={v.id}>
                {fileNameOf(v.filePath)}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field id={ids.start} label="Mulai (dtk)">
            <NumberField
              id={ids.start}
              min={0}
              max={clipMaxMs / 1000}
              step={0.1}
              value={scene.videoTrimStartMs / 1000}
              disabled={readOnly}
              onCommit={(value) => setTrim("videoTrimStartMs", value)}
            />
          </Field>
          <Field id={ids.end} label="Selesai (dtk)" {...(clip?.durationMs !== undefined && { hint: `Maks. ${formatTimecode(clip.durationMs)}` })}>
            <NumberField
              id={ids.end}
              min={0}
              max={clipMaxMs / 1000}
              step={0.1}
              value={scene.videoTrimEndMs / 1000}
              disabled={readOnly}
              onCommit={(value) => setTrim("videoTrimEndMs", value)}
            />
          </Field>
          <Field id={ids.rate} label="Kecepatan video">
            <NumberField
              id={ids.rate}
              min={0.25}
              max={4}
              step={0.05}
              value={scene.playbackRate}
              disabled={readOnly}
              onCommit={(value) => execute(updateScene(manifest, scene.id, { playbackRate: value }))}
            />
          </Field>
        </div>
        <Field id={ids.align} label="Penyelarasan audio-video">
          <select
            id={ids.align}
            className={SELECT_CLASS}
            value={scene.alignmentMode}
            disabled={readOnly}
            onChange={(e) => {
              const mode = SceneAlignmentModeSchema.safeParse(e.target.value);
              if (mode.success) execute(updateScene(manifest, scene.id, { alignmentMode: mode.data }));
            }}
          >
            {SceneAlignmentModeSchema.options.map((mode) => (
              <option key={mode} value={mode}>
                {ALIGNMENT_LABEL[mode]}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Suara">
        <label className="flex min-h-6 items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={!hasOverride}
            disabled={readOnly}
            onChange={(e) => execute(setSceneVoice(manifest, scene.id, e.target.checked ? null : { ...manifest.defaultVoice }))}
          />
          Pakai suara default proyek ({manifest.defaultVoice.voiceId})
        </label>
        {hasOverride && (
          <VoiceFields idPrefix={ids.voice} voice={voice} disabled={readOnly} onChange={(next) => execute(setSceneVoice(manifest, scene.id, next))} />
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            icon={scene.audioDurationMs === undefined ? AudioLines : RotateCcw}
            loading={synthesis?.state === "loading"}
            disabled={readOnly || scene.narration.trim() === ""}
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
            <p className="font-mono text-[12px] tabular text-fg-2">Durasi audio {formatSeconds(scene.audioDurationMs)}</p>
          </div>
        )}
      </Section>
    </div>
  );
}
