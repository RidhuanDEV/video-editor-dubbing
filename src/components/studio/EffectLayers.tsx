/**
 * Preview rendering of effects and subtitles (approximation; FFmpeg renders the export).
 * Sizes use container-query units (`cqh`) so they scale with the preview exactly like the
 * export scales with the canvas: 1 canvas pixel = 100cqh / canvas.height.
 */
import type { CSSProperties } from "react";
import { blurRectNorm, CALLOUT_COLORS, easeEnvelope, SPOTLIGHT_DIM, zoomScaleAt, zoomViewport, type NormRect } from "../../project/effects";
import type { Cue } from "../../project/subtitles";
import type { BadgeCalloutEffect, BlurEffect, CanvasSettings, SceneEffect, SubtitleSettings, ZoomEffect } from "../../types";

/** Canvas pixels → CSS length inside the preview box. */
function cpx(value: number, canvas: Pick<CanvasSettings, "height">): string {
  return `calc(${value} / ${canvas.height} * 100cqh)`;
}

/** Source-normalized rect → canvas-normalized rect through the content (fit) rect. */
function toCanvas(rect: NormRect, content: NormRect): NormRect {
  return { x: content.x + rect.x * content.w, y: content.y + rect.y * content.h, w: rect.w * content.w, h: rect.h * content.h };
}

function percentBox(rect: NormRect): CSSProperties {
  return { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` };
}

/** Transform for the content layer so the zoom viewport fills the canvas (crop + scale). */
export function zoomStyle(effect: ZoomEffect | undefined, elapsedMs: number, content: NormRect): CSSProperties | undefined {
  if (!effect || effect.spotlightMask) return undefined;
  const scale = zoomScaleAt(effect, elapsedMs);
  if (scale <= 1.0001) return undefined;
  const view = toCanvas(zoomViewport(effect.target, scale), content);
  const s = 1 / Math.max(view.w, view.h);
  return { transformOrigin: "0 0", transform: `translate(${-view.x * s * 100}%, ${-view.y * s * 100}%) scale(${s})` };
}

export function BlurOverlays({ effects, content, sourceW, sourceH, canvas }: {
  readonly effects: ReadonlyArray<BlurEffect>;
  readonly content: NormRect;
  readonly sourceW: number;
  readonly sourceH: number;
  readonly canvas: CanvasSettings;
}) {
  return effects.map((effect) => {
    const box = toCanvas(blurRectNorm(effect, sourceW, sourceH), content);
    // blurStrength is a radius in source pixels; convert through the content scale.
    const radius = (effect.blurStrength * content.h * canvas.height) / sourceH;
    return (
      <div
        key={effect.id}
        className="pointer-events-none absolute"
        style={{ ...percentBox(box), backdropFilter: `blur(${cpx(radius, canvas)})`, WebkitBackdropFilter: `blur(${cpx(radius, canvas)})` }}
      />
    );
  });
}

const CALLOUT_POSITION: Readonly<Record<BadgeCalloutEffect["position"], CSSProperties>> = {
  "top-left": { top: "6%", left: "4%" },
  "top-right": { top: "6%", right: "4%" },
  "bottom-left": { bottom: "16%", left: "4%" },
  "bottom-right": { bottom: "16%", right: "4%" },
};

export function ScreenOverlays({ effects, elapsedOf, content, canvas }: {
  readonly effects: ReadonlyArray<SceneEffect>;
  readonly elapsedOf: (effect: SceneEffect) => number;
  readonly content: NormRect;
  readonly canvas: CanvasSettings;
}) {
  return effects.map((effect) => {
    if (effect.type === "zoom" && effect.spotlightMask) {
      const focus = toCanvas(zoomViewport(effect.target, effect.scale), content);
      const dim = SPOTLIGHT_DIM * easeEnvelope(effect, elapsedOf(effect));
      return (
        <div
          key={effect.id}
          className="pointer-events-none absolute rounded-[2%]"
          style={{ ...percentBox(focus), boxShadow: `0 0 0 9999px rgb(0 0 0 / ${dim})` }}
        />
      );
    }
    if (effect.type === "callout") {
      return (
        <span
          key={effect.id}
          className="pointer-events-none absolute rounded-md font-semibold whitespace-nowrap"
          style={{ ...CALLOUT_POSITION[effect.position], background: CALLOUT_COLORS.background, color: CALLOUT_COLORS.text, fontSize: cpx(36, canvas), padding: `${cpx(10, canvas)} ${cpx(22, canvas)}`, opacity: easeEnvelope(effect, elapsedOf(effect)) }}
        >
          {effect.label}
        </span>
      );
    }
    return null;
  });
}

export function SubtitleOverlay({ cue, activeWord, settings, canvas }: {
  readonly cue: Cue;
  readonly activeWord: number;
  readonly settings: SubtitleSettings;
  readonly canvas: CanvasSettings;
}) {
  // ASS colours are #RRGGBB[AA]; CSS accepts the same notation.
  return (
    <div className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ bottom: "6%" }}>
      <span
        className="max-w-[90%] text-center leading-tight"
        style={{
          fontFamily: `"${settings.fontName}", "Inter Variable", sans-serif`,
          fontSize: cpx(settings.fontSize, canvas),
          color: settings.primaryColor,
          background: settings.backColor,
          padding: `${cpx(settings.fontSize / 5, canvas)} ${cpx(settings.fontSize / 2.5, canvas)}`,
          borderRadius: cpx(6, canvas),
        }}
      >
        {cue.words.map((w, i) => (
          <span key={`${i}-${w.startMs}`} style={i === activeWord ? { color: settings.highlightColor } : undefined}>
            {i > 0 ? " " : ""}
            {w.word}
          </span>
        ))}
        {!cue.precise && <span className="sr-only"> (timing perkiraan)</span>}
      </span>
    </div>
  );
}
