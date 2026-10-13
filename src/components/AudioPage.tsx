/** Audio page (08 §7): track mix, loudness target (F-AUD-1, applied at export), scene gap, BGM. */
import { Headphones, Volume2, VolumeX } from "lucide-react";
import { useId } from "react";
import { setAudioMix, setTrackState } from "../project/commands";
import { useProjectStore } from "../project/store";
import type { TrackKind } from "../types";
import { BgmInspector } from "./edit/EditPage";
import { Card, Field, IconButton, INPUT_CLASS, NumberField } from "./ui";

const LOUDNESS_PRESETS: ReadonlyArray<{ readonly lufs: number; readonly label: string }> = [
  { lufs: -14, label: "-14 LUFS (YouTube, media sosial)" },
  { lufs: -16, label: "-16 LUFS (podcast, WhatsApp)" },
  { lufs: -23, label: "-23 LUFS (siaran EBU R128)" },
];

const AUDIO_TRACKS: ReadonlyArray<{ readonly kind: TrackKind; readonly label: string }> = [
  { kind: "narration", label: "Narasi" },
  { kind: "bgm", label: "BGM" },
];

export function AudioPage() {
  const ids = { lufs: useId(), gap: useId() };
  const project = useProjectStore((s) => s.project);
  const execute = useProjectStore((s) => s.execute);
  if (!project) return null;
  const { manifest, readOnly } = project;
  const { loudness } = manifest;
  const custom = !LOUDNESS_PRESETS.some((p) => p.lufs === loudness.targetLufs);

  return (
    <div className="mx-auto grid max-w-[1100px] gap-4 p-4 lg:grid-cols-2">
      <Card title="Mixer">
        <ul className="space-y-1">
          {AUDIO_TRACKS.map(({ kind, label }) => {
            const state = manifest.tracks.find((t) => t.kind === kind) ?? { kind, muted: false, solo: false, locked: false };
            return (
              <li key={kind} className="flex items-center gap-2 rounded-sm border border-line-subtle bg-surface px-3 py-1.5">
                <span className="flex-1 text-[13px] font-medium">{label}</span>
                <IconButton
                  icon={state.muted ? VolumeX : Volume2}
                  label={`${state.muted ? "Bunyikan" : "Bisukan"} ${label}`}
                  pressed={state.muted}
                  disabled={readOnly}
                  onClick={() => execute(setTrackState(manifest, kind, { muted: !state.muted }))}
                />
                <IconButton
                  icon={Headphones}
                  label={`Solo ${label}`}
                  pressed={state.solo}
                  disabled={readOnly}
                  onClick={() => execute(setTrackState(manifest, kind, { solo: !state.solo }))}
                />
              </li>
            );
          })}
        </ul>
        <p className="text-[12px] text-fg-2">Mute dan solo berlaku di preview dan ekspor.</p>
      </Card>

      <Card title="Loudness & ritme">
        <label className="flex min-h-6 items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={loudness.enabled}
            disabled={readOnly}
            onChange={(e) => execute(setAudioMix(manifest, { loudness: { ...loudness, enabled: e.target.checked } }, "audio:loudness"))}
          />
          Normalisasi loudness saat ekspor (EBU R128, dua pass)
        </label>
        <Field id={ids.lufs} label="Target" hint="Diterapkan pada mix akhir setelah ducking; preview tidak menormalisasi.">
          <select
            id={ids.lufs}
            className={`${INPUT_CLASS} pr-8`}
            value={loudness.targetLufs}
            disabled={readOnly || !loudness.enabled}
            onChange={(e) => execute(setAudioMix(manifest, { loudness: { ...loudness, targetLufs: Number(e.target.value) } }, "audio:lufs"))}
          >
            {custom && <option value={loudness.targetLufs}>{loudness.targetLufs} LUFS (kustom)</option>}
            {LOUDNESS_PRESETS.map((p) => (
              <option key={p.lufs} value={p.lufs}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={ids.gap} label="Jeda antar-scene (ms)" hint="Napas di akhir setiap scene; frame terakhir ditahan.">
          <NumberField
            id={ids.gap}
            min={0}
            max={5000}
            step={50}
            value={manifest.sceneGapMs}
            disabled={readOnly}
            onCommit={(v) => execute(setAudioMix(manifest, { sceneGapMs: Math.round(v) }, "audio:gap"))}
          />
        </Field>
      </Card>

      <Card title={`BGM (${manifest.bgmTracks.length})`}>
        {manifest.bgmTracks.length === 0 ? (
          <p className="text-[13px] text-fg-2">Belum ada BGM. Tambahkan dari track BGM di halaman Edit.</p>
        ) : (
          <div className="divide-y divide-line-subtle">
            {manifest.bgmTracks.map((track) => (
              <BgmInspector key={track.id} manifest={manifest} track={track} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
