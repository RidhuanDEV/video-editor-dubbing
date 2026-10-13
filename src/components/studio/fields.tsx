/** Field groups shared by the inspector, the setup wizard and dialogs. */
import { useId } from "react";
import { formatTimecode } from "../../lib/format";
import { formatSigned, parseSigned, sortVoices, useVoices } from "../../lib/voices";
import { setSubtitleSettings } from "../../project/commands";
import { fileNameOf } from "../../project/manifest";
import { useProjectStore } from "../../project/store";
import type { MediaAsset, ProjectManifest, VoiceConfig, VoiceEngine, VoiceInfo } from "../../types";
import { Checkbox, Combobox, Field, INPUT_CLASS, NumberField, Select, Slider, type ComboboxOption, type SelectOption } from "../ui";

/** Select option for a video asset: file name plus duration. */
export function clipOption(asset: MediaAsset): SelectOption<string> {
  const option = { value: asset.id, label: fileNameOf(asset.filePath) };
  return asset.durationMs === undefined ? option : { ...option, detail: formatTimecode(asset.durationMs) };
}

/** Engines offered in the UI; "kokoro-local"/"custom-api" exist in the schema but are not built yet. */
const TTS_ENGINES: ReadonlyArray<SelectOption<VoiceEngine>> = [
  { value: "edge-tts", label: "Edge-TTS (gratis, tidak resmi)" },
  { value: "azure-speech", label: "Azure Speech (resmi)" },
];

const GENDER: Readonly<Record<string, string>> = { Female: "Perempuan", Male: "Laki-laki" };

function localeGroup(locale: string): string {
  return locale.startsWith("id-") ? "Indonesia" : locale.startsWith("en-") ? "English" : "Bahasa lain";
}

function voiceOption(voice: VoiceInfo): ComboboxOption<string> {
  // "id-ID-GadisNeural" → "Gadis"
  const name = voice.shortName.replace(/^[a-z]{2,3}-[A-Za-z]{2,4}-/, "").replace(/(Multilingual)?Neural$/, "");
  return {
    value: voice.shortName,
    label: `${name} · ${voice.locale}`,
    detail: GENDER[voice.gender] ?? voice.gender,
    group: localeGroup(voice.locale),
    keywords: [voice.locale, voice.gender, voice.friendlyName],
  };
}

/** Engine, voice (searchable), rate and pitch. Used for the project default and per-scene overrides. */
export function VoiceFields({ idPrefix, voice, onChange, disabled }: {
  readonly idPrefix: string;
  readonly voice: VoiceConfig;
  readonly onChange: (voice: VoiceConfig) => void;
  readonly disabled: boolean;
}) {
  const { voices, status } = useVoices(voice.engine);
  const sorted = sortVoices(voices);
  const options = sorted.map(voiceOption);
  const known = sorted.some((v) => v.shortName === voice.voiceId);
  const offlineHint =
    voice.engine === "azure-speech" ? "Daftar suara Azure belum tersedia: atur kunci di Pengaturan → Suara." : "Daftar suara terbatas (offline atau belum disetujui).";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field id={`${idPrefix}-engine`} label="Engine">
          <Select id={`${idPrefix}-engine`} value={voice.engine} options={TTS_ENGINES} disabled={disabled} onChange={(engine) => onChange({ ...voice, engine })} />
        </Field>
        <Field id={`${idPrefix}-voice`} label="Suara" hint={status === "offline" ? offlineHint : undefined}>
          <Combobox
            id={`${idPrefix}-voice`}
            value={voice.voiceId}
            options={known ? options : [{ value: voice.voiceId, label: voice.voiceId, group: "Terpilih" }, ...options]}
            disabled={disabled}
            searchPlaceholder="Cari suara (nama, bahasa)…"
            emptyText="Tidak ada suara yang cocok."
            onChange={(voiceId) => onChange({ ...voice, voiceId })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
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
    </div>
  );
}

const FONTS = ["Inter", "Segoe UI", "Arial", "Roboto", "Verdana"];

const COLOR_CLASS = `${INPUT_CLASS} cursor-pointer p-0.5`;

/** Subtitle style (applies to preview and export). */
export function SubtitleFields({ manifest, disabled }: { readonly manifest: ProjectManifest; readonly disabled: boolean }) {
  const ids = { font: useId(), size: useId(), primary: useId(), highlight: useId(), back: useId(), alpha: useId(), chars: useId() };
  const execute = useProjectStore((s) => s.execute);
  const settings = manifest.subtitleSettings;
  const set = (patch: Partial<ProjectManifest["subtitleSettings"]>, key: string): void =>
    execute(setSubtitleSettings(manifest, { ...settings, ...patch }, `subtitle:${key}`));
  const backRgb = settings.backColor.slice(0, 7);
  const backAlpha = settings.backColor.length === 9 ? parseInt(settings.backColor.slice(7, 9), 16) : 255;
  const off = disabled || !settings.enabled;

  return (
    <div className="space-y-3">
      <Checkbox checked={settings.enabled} disabled={disabled} onChange={(enabled) => set({ enabled }, "enabled")}>
        Tampilkan subtitle dari narasi (kata aktif disorot)
      </Checkbox>
      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <Field id={ids.font} label="Font">
          <Select
            id={ids.font}
            value={settings.fontName}
            options={(FONTS.includes(settings.fontName) ? FONTS : [settings.fontName, ...FONTS]).map((f) => ({ value: f, label: f }))}
            disabled={off}
            onChange={(fontName) => set({ fontName }, "font")}
          />
        </Field>
        <Field id={ids.size} label="Ukuran (px)">
          <NumberField id={ids.size} min={8} max={200} step={1} value={settings.fontSize} disabled={off} onCommit={(v) => set({ fontSize: Math.round(v) }, "size")} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field id={ids.primary} label="Teks">
          <input id={ids.primary} type="color" className={COLOR_CLASS} value={settings.primaryColor.toLowerCase()} disabled={off} onChange={(e) => set({ primaryColor: e.target.value.toUpperCase() }, "primary")} />
        </Field>
        <Field id={ids.highlight} label="Kata aktif">
          <input id={ids.highlight} type="color" className={COLOR_CLASS} value={settings.highlightColor.toLowerCase()} disabled={off} onChange={(e) => set({ highlightColor: e.target.value.toUpperCase() }, "highlight")} />
        </Field>
        <Field id={ids.back} label="Latar">
          <input
            id={ids.back}
            type="color"
            className={COLOR_CLASS}
            value={backRgb.toLowerCase()}
            disabled={off}
            onChange={(e) => set({ backColor: `${e.target.value.toUpperCase()}${backAlpha.toString(16).padStart(2, "0").toUpperCase()}` }, "back")}
          />
        </Field>
      </div>
      <Field id={ids.alpha} label={`Opasitas latar ${Math.round((backAlpha / 255) * 100)}%`}>
        <Slider
          id={ids.alpha}
          min={0}
          max={255}
          value={backAlpha}
          disabled={off}
          onChange={(v) => set({ backColor: `${backRgb}${v.toString(16).padStart(2, "0").toUpperCase()}` }, "alpha")}
        />
      </Field>
      <Field id={ids.chars} label="Maks. karakter per baris" hint="Dipecah di koma, akhir kalimat, atau sebelum kata hubung.">
        <NumberField id={ids.chars} min={20} max={200} step={1} value={settings.maxCharsPerChunk} disabled={off} onCommit={(v) => set({ maxCharsPerChunk: Math.round(v) }, "chars")} />
      </Field>
    </div>
  );
}
