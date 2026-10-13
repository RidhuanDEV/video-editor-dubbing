/**
 * Click-and-drag effect editing on the preview (Phase 4 acceptance: effects are created by
 * dragging). Drawn on the unzoomed frame; pointer positions convert canvas → source via the
 * fit (content) rect. Live drags execute coalesced commands, so one drag is one undo step.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { addEffect, replaceEffect } from "../../project/commands";
import { calloutPositionFor, effectTimingAt, zoomFromRect, zoomViewport, type NormRect } from "../../project/effects";
import { useEditor } from "../../project/editor";
import { useProjectStore } from "../../project/store";
import type { SceneSegment } from "../../project/timeline";
import type { BlurEffect, ProjectManifest, SceneEffect, ZoomEffect } from "../../types";

export type EffectTool = "select" | "zoom" | "blur" | "callout";

const MIN_DRAW = 0.02;

interface GizmoProps {
  readonly manifest: ProjectManifest;
  readonly segment: SceneSegment | null;
  readonly tool: EffectTool;
  readonly onToolDone: () => void;
  readonly content: NormRect;
  readonly sourceW: number;
  readonly sourceH: number;
}

type Interaction =
  | { readonly kind: "draw"; readonly from: Point; readonly to: Point }
  | { readonly kind: "move" | "resize"; readonly effect: ZoomEffect | BlurEffect; readonly from: Point };

interface Point {
  readonly x: number;
  readonly y: number;
}

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

function rectFrom(a: Point, b: Point): NormRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function EffectGizmo({ manifest, segment, tool, onToolDone, content, sourceW, sourceH }: GizmoProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const execute = useProjectStore((s) => s.execute);
  const selection = useEditor((s) => s.selection);
  const locked = manifest.tracks.some((t) => t.kind === "effects" && t.locked);
  const selected = selection?.type === "effect" && segment ? segment.scene.effects.find((e) => e.id === selection.id) : undefined;

  /** Pointer → normalized source coordinates (0–1 over the source frame). */
  const toSource = (event: ReactPointerEvent<HTMLDivElement>): Point => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    const cx = (event.clientX - box.left) / box.width;
    const cy = (event.clientY - box.top) / box.height;
    return { x: clamp01((cx - content.x) / content.w), y: clamp01((cy - content.y) / content.h) };
  };

  /** Source-normalized rect → canvas percent box for drawing. */
  const box = (r: NormRect): { left: string; top: string; width: string; height: string } => ({
    left: `${(content.x + r.x * content.w) * 100}%`,
    top: `${(content.y + r.y * content.h) * 100}%`,
    width: `${r.w * content.w * 100}%`,
    height: `${r.h * content.h * 100}%`,
  });

  const create = (effect: SceneEffect): void => {
    if (!segment) return;
    execute(addEffect(manifest, segment.scene.id, effect));
    useEditor.getState().select({ type: "effect", sceneId: segment.scene.id, id: effect.id });
    onToolDone();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !segment || locked || tool === "select") return;
    const point = toSource(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "callout") {
      const timing = effectTimingAt(segment, useEditor.getState().playheadMs);
      if (!timing) return;
      const count = segment.scene.effects.filter((e) => e.type === "callout").length + 1;
      create({ id: crypto.randomUUID(), type: "callout", ...timing, label: `Langkah ${count}`, position: calloutPositionFor(point) });
      return;
    }
    setInteraction({ kind: "draw", from: point, to: point });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!interaction || !segment) return;
    const point = toSource(event);
    if (interaction.kind === "draw") {
      setInteraction({ ...interaction, to: point });
      return;
    }
    const dx = point.x - interaction.from.x;
    const dy = point.y - interaction.from.y;
    const key = `effect:${interaction.effect.id}:gizmo`;
    const effect = interaction.effect;
    if (effect.type === "zoom") {
      const next: ZoomEffect =
        interaction.kind === "move"
          ? { ...effect, target: { x: clamp01(effect.target.x + dx), y: clamp01(effect.target.y + dy) } }
          : { ...effect, scale: zoomFromRect(rectFrom(zoomViewport(effect.target, effect.scale), point)).scale };
      execute(replaceEffect(manifest, segment.scene.id, next, key));
    } else {
      const r = effect.rect;
      const pxX = dx * sourceW;
      const pxY = dy * sourceH;
      const rect =
        interaction.kind === "move"
          ? { ...r, x: Math.round(Math.min(Math.max(r.x + pxX, 0), sourceW - r.width)), y: Math.round(Math.min(Math.max(r.y + pxY, 0), sourceH - r.height)) }
          : { ...r, width: Math.round(Math.max(8, Math.min(r.width + pxX, sourceW - r.x))), height: Math.round(Math.max(8, Math.min(r.height + pxY, sourceH - r.y))) };
      execute(replaceEffect(manifest, segment.scene.id, { ...effect, rect }, key));
    }
  };

  const onPointerUp = (): void => {
    const current = interaction;
    setInteraction(null);
    if (!current || current.kind !== "draw" || !segment) return;
    const rect = rectFrom(current.from, current.to);
    if (rect.w < MIN_DRAW || rect.h < MIN_DRAW) return;
    const timing = effectTimingAt(segment, useEditor.getState().playheadMs);
    if (!timing) return;
    if (tool === "zoom") {
      create({ id: crypto.randomUUID(), type: "zoom", ...timing, ...zoomFromRect(rect), spotlightMask: false });
    } else if (tool === "blur") {
      const px = { x: Math.round(rect.x * sourceW), y: Math.round(rect.y * sourceH), width: Math.round(rect.w * sourceW), height: Math.round(rect.h * sourceH) };
      create({ id: crypto.randomUUID(), type: "blur", ...timing, rect: px, blurStrength: 20 });
    }
  };

  const startEdit = (kind: "move" | "resize", effect: ZoomEffect | BlurEffect) => (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || locked) return;
    event.stopPropagation();
    ref.current?.setPointerCapture(event.pointerId);
    setInteraction({ kind, effect, from: toSource(event) });
  };

  // Moves are relative to where the drag began, so the original effect is kept in the interaction.
  const shown = interaction && interaction.kind !== "draw" ? segment?.scene.effects.find((e) => e.id === interaction.effect.id) : selected;
  const shape = shown && (shown.type === "zoom" ? zoomViewport(shown.target, shown.scale) : shown.type === "blur" ? { x: shown.rect.x / sourceW, y: shown.rect.y / sourceH, w: shown.rect.width / sourceW, h: shown.rect.height / sourceH } : null);

  return (
    <div
      ref={ref}
      className={`absolute inset-0 z-10 ${tool === "select" ? "" : "cursor-crosshair"}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      aria-label="Area efek: seret untuk membuat efek"
    >
      {interaction?.kind === "draw" && (
        <div className="pointer-events-none absolute border-2 border-dashed border-white bg-white/10 mix-blend-difference" style={box(rectFrom(interaction.from, interaction.to))} />
      )}
      {shown && shape && (shown.type === "zoom" || shown.type === "blur") && (
        <div
          className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.6)]"
          style={box(shape)}
          onPointerDown={startEdit("move", shown)}
          role="group"
          aria-label={shown.type === "zoom" ? "Area zoom: seret untuk memindah" : "Area blur: seret untuk memindah"}
        >
          <span className="pointer-events-none absolute -top-6 left-0 rounded-sm bg-black/70 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white">
            {shown.type === "zoom" ? `${shown.spotlightMask ? "Spotlight" : "Zoom"} ${shown.scale.toFixed(2)}×` : `Blur ${shown.blurStrength}`}
          </span>
          <div
            className="absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-[2px] border border-black bg-white"
            onPointerDown={startEdit("resize", shown)}
            role="separator"
            aria-label="Ubah ukuran"
          />
        </div>
      )}
    </div>
  );
}
