/** Efek page side panel: tools, effects of the scene at the playhead, inspector, subtitle style. */
import { BadgeCheck, Droplets, MousePointer2, Trash2, ZoomIn, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import { removeEffect, replaceEffect, setSubtitleSettings } from "../../project/commands";
import { EFFECT_LABEL } from "../../project/effects";
import { useEditor } from "../../project/editor";
import { useProjectStore } from "../../project/store";
import type { SceneSegment } from "../../project/timeline";
import type { BadgeCalloutEffect, ProjectManifest, SceneEffect } from "../../types";
import { Button, Field, IconButton, INPUT_CLASS, NumberField } from "../ui";
import type { EffectTool } from "./EffectGizmo";

const TOOLS: ReadonlyArray<{ readonly id: EffectTool; readonly label: string; readonly icon: LucideIcon }> = [
  { id: "select", label: "Pilih", icon: MousePointer2 },
  { id: "zoom", label: "Zoom: seret area di preview", icon: ZoomIn },
  { id: "blur", label: "Blur sensor: seret area di preview", icon: Droplets },
  { id: "callout", label: "Badge: klik posisi di preview", icon: BadgeCheck },
];

const POSITIONS: ReadonlyArray<{ readonly value: BadgeCalloutEffect["position"]; readonly label: string }> = [
  { value: "top-left", label: "Kiri atas" },
  { value: "top-right", label: "Kanan atas" },
  { value: "bottom-left", label: "Kiri bawah" },
  { value: "bottom-right", label: "Kanan bawah" },
];

const FONTS = ["Inter", "Segoe UI", "Arial", "Roboto", "Verdana"];

type PanelTab = "effects" | "subtitle";
const TABS: ReadonlyArray<{ readonly id: PanelTab; readonly label: string }> = [
  { id: "effects", label: "Efek" },
  { id: "subtitle", label: "Subtitle" },
];

function EffectInspector({ manifest, segment, effect, disabled }: { readonly manifest: ProjectManifest; readonly segment: SceneSegment; readonly effect: SceneEffect; readonly disabled: boolean }) {
  const ids = { start: useId(), duration: useId(), scale: useId(), strength: useId(), label: useId(), position: useId() };
  const execute = useProjectStore((s) => s.execute);
  const sceneMs = segment.endMs - segment.startMs;
  const set = (next: SceneEffect, key?: string): void => execute(replaceEffect(manifest, segment.scene.id, next, key));

  return (
    <div className="space-y-3 rounded-md border border-line-subtle bg-surface p-3">
      <div className="grid grid-cols-2 gap-3">
        <Field id={ids.start} label="Mulai (dtk, dari awal scene)">
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

      {effect.type === "zoom" && (
        <>
          <Field id={ids.scale} label="Skala (1–8×)" hint={effect.spotlightMask ? "Spotlight: area fokus seluas 1/skala, sisanya digelapkan." : "Zoom halus 300 ms di awal dan akhir."}>
            <NumberField id={ids.scale} min={1} max={8} step={0.1} value={effect.scale} disabled={disabled} onCommit={(v) => set({ ...effect, scale: v })} />
          </Field>
          <label className="flex min-h-6 items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={effect.spotlightMask}
              disabled={disabled}
              onChange={(e) => set({ ...effect, spotlightMask: e.target.checked })}
            />
            Mode spotlight (tanpa zoom)
          </label>
        </>
      )}

      {effect.type === "blur" && (
        <Field id={ids.strength} label={`Kekuatan blur ${effect.blurStrength}`} hint={`Area ${effect.rect.width}×${effect.rect.height} px di video sumber.`}>
          <input
            id={ids.strength}
            type="range"
            min={1}
            max={100}
            value={effect.blurStrength}
            disabled={disabled}
            onChange={(e) => set({ ...effect, blurStrength: e.target.valueAsNumber }, `effect:${effect.id}:strength`)}
            className="w-full accent-[var(--accent)]"
          />
        </Field>
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
            <select
              id={ids.position}
              className={`${INPUT_CLASS} pr-8`}
              value={effect.position}
              disabled={disabled}
              onChange={(e) => {
                const position = POSITIONS.find((p) => p.value === e.target.value);
                if (position) set({ ...effect, position: position.value });
              }}
            >
              {POSITIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <Button
        icon={Trash2}
        disabled={disabled}
        onClick={() => {
          execute(removeEffect(manifest, segment.scene.id, effect.id));
          useEditor.getState().select(null);
        }}
      >
        Hapus efek
      </Button>
    </div>
  );
}

function SubtitleStyle({ manifest, disabled }: { readonly manifest: ProjectManifest; readonly disabled: boolean }) {
  const ids = { font: useId(), size: useId(), primary: useId(), highlight: useId(), back: useId(), alpha: useId(), chars: useId() };
  const execute = useProjectStore((s) => s.execute);
  const settings = manifest.subtitleSettings;
  const set = (patch: Partial<ProjectManifest["subtitleSettings"]>, key: string): void =>
    execute(setSubtitleSettings(manifest, { ...settings, ...patch }, `subtitle:${key}`));
  const backRgb = settings.backColor.slice(0, 7);
  const backAlpha = settings.backColor.length === 9 ? parseInt(settings.backColor.slice(7, 9), 16) : 255;

  return (
    <div className="space-y-3">
      <label className="flex min-h-6 items-center gap-2 text-[13px]">
        <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={settings.enabled} disabled={disabled} onChange={(e) => set({ enabled: e.target.checked }, "enabled")} />
        Tampilkan subtitle (dari narasi)
      </label>
      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <Field id={ids.font} label="Font">
          <select id={ids.font} className={`${INPUT_CLASS} pr-8`} value={settings.fontName} disabled={disabled} onChange={(e) => set({ fontName: e.target.value }, "font")}>
            {!FONTS.includes(settings.fontName) && <option value={settings.fontName}>{settings.fontName}</option>}
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
        <Field id={ids.size} label="Ukuran (px kanvas)">
          <NumberField id={ids.size} min={8} max={200} step={1} value={settings.fontSize} disabled={disabled} onCommit={(v) => set({ fontSize: Math.round(v) }, "size")} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field id={ids.primary} label="Teks">
          <input id={ids.primary} type="color" className="h-8 w-full rounded-sm border border-line bg-surface" value={settings.primaryColor.toLowerCase()} disabled={disabled} onChange={(e) => set({ primaryColor: e.target.value.toUpperCase() }, "primary")} />
        </Field>
        <Field id={ids.highlight} label="Kata aktif">
          <input id={ids.highlight} type="color" className="h-8 w-full rounded-sm border border-line bg-surface" value={settings.highlightColor.toLowerCase()} disabled={disabled} onChange={(e) => set({ highlightColor: e.target.value.toUpperCase() }, "highlight")} />
        </Field>
        <Field id={ids.back} label="Latar">
          <input
            id={ids.back}
            type="color"
            className="h-8 w-full rounded-sm border border-line bg-surface"
            value={backRgb.toLowerCase()}
            disabled={disabled}
            onChange={(e) => set({ backColor: `${e.target.value.toUpperCase()}${backAlpha.toString(16).padStart(2, "0").toUpperCase()}` }, "back")}
          />
        </Field>
      </div>
      <Field id={ids.alpha} label={`Opasitas latar ${Math.round((backAlpha / 255) * 100)}%`}>
        <input
          id={ids.alpha}
          type="range"
          min={0}
          max={255}
          value={backAlpha}
          disabled={disabled}
          onChange={(e) => set({ backColor: `${backRgb}${e.target.valueAsNumber.toString(16).padStart(2, "0").toUpperCase()}` }, "alpha")}
          className="w-full accent-[var(--accent)]"
        />
      </Field>
      <Field id={ids.chars} label="Maks. karakter per baris" hint="Dipecah di koma, akhir kalimat, atau sebelum kata hubung.">
        <NumberField id={ids.chars} min={20} max={200} step={1} value={settings.maxCharsPerChunk} disabled={disabled} onCommit={(v) => set({ maxCharsPerChunk: Math.round(v) }, "chars")} />
      </Field>
    </div>
  );
}

export function EffectsPanel({ manifest, segment, tool, onTool }: {
  readonly manifest: ProjectManifest;
  readonly segment: SceneSegment | null;
  readonly tool: EffectTool;
  readonly onTool: (tool: EffectTool) => void;
}) {
  const [tab, setTab] = useState<PanelTab>("effects");
  const selection = useEditor((s) => s.selection);
  const readOnly = useProjectStore((s) => s.project?.readOnly ?? true);
  const locked = readOnly || manifest.tracks.some((t) => t.kind === "effects" && t.locked);
  const selected = selection?.type === "effect" && segment ? segment.scene.effects.find((e) => e.id === selection.id) : undefined;

  return (
    <div className="flex h-full flex-col">
      <div role="tablist" aria-label="Panel efek" className="flex border-b border-line-subtle">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex-1 border-b-2 py-2 text-[13px] font-medium ${tab === id ? "border-accent text-fg" : "border-transparent text-fg-2 hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {tab === "subtitle" ? (
          <SubtitleStyle manifest={manifest} disabled={readOnly} />
        ) : (
          <>
            <div className="flex gap-1" role="group" aria-label="Alat efek">
              {TOOLS.map((t) => (
                <IconButton key={t.id} icon={t.icon} label={t.label} pressed={tool === t.id} disabled={locked && t.id !== "select"} onClick={() => onTool(t.id)} />
              ))}
            </div>
            {locked && <p className="text-[12px] text-fg-2">Track efek terkunci atau proyek baca-saja.</p>}

            {segment ? (
              <>
                <h3 className="panel-title">
                  Scene {segment.index + 1}: {segment.scene.title}
                </h3>
                {segment.scene.effects.length === 0 ? (
                  <p className="text-[12px] text-fg-2">Belum ada efek. Pilih alat lalu seret di preview pada posisi playhead.</p>
                ) : (
                  <ul className="space-y-1" aria-label="Efek scene ini">
                    {segment.scene.effects.map((effect) => {
                      const active = selected?.id === effect.id;
                      return (
                        <li key={effect.id}>
                          <button
                            type="button"
                            aria-current={active ? "true" : undefined}
                            className={`flex w-full items-center justify-between rounded-sm border px-2 py-1.5 text-left text-[13px] ${active ? "border-accent bg-selected" : "border-line-subtle bg-surface hover:bg-hover"}`}
                            onClick={() => {
                              const editor = useEditor.getState();
                              editor.select({ type: "effect", sceneId: segment.scene.id, id: effect.id });
                              editor.setPlaying(false);
                              // Park the playhead inside the effect so its gizmo is visible.
                              editor.seek(segment.startMs + effect.startOffsetMs + Math.min(effect.durationMs / 2, 400), segment.endMs);
                            }}
                          >
                            <span>{EFFECT_LABEL[effect.type]}{effect.type === "callout" ? `: ${effect.label}` : ""}</span>
                            <span className="font-mono text-[12px] tabular text-fg-2">
                              {(effect.startOffsetMs / 1000).toFixed(1)}–{((effect.startOffsetMs + effect.durationMs) / 1000).toFixed(1)}s
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {selected && <EffectInspector key={selected.id} manifest={manifest} segment={segment} effect={selected} disabled={locked} />}
              </>
            ) : (
              <p className="text-[12px] text-fg-2">Belum ada scene di posisi playhead.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
