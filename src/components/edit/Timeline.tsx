/**
 * Multi-track timeline (F-CORE-4, 03 §2.D, 08 §8). The video track is magnetic (scenes are
 * contiguous). A drag previews live and commits one command on release (one undo step).
 */
import {
  Captions,
  Film,
  Headphones,
  Lock,
  LockOpen,
  Magnet,
  Mic,
  Music,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { formatTimecode } from "../../lib/format";
import { removeBgmTrack, removeScene, setTrackState, splitScene, trimSceneClip, updateBgmTrack } from "../../project/commands";
import { MAX_PX_PER_SEC, MIN_PX_PER_SEC, useEditor } from "../../project/editor";
import { useProjectStore } from "../../project/store";
import { isTrackLocked, layoutTimeline, snapCandidates, snapMs, splitPointAt, type TimelineLayout } from "../../project/timeline";
import type { ProjectManifest, TrackKind } from "../../types";
import { IconButton } from "../ui";

const HEADER_W = 176;
const ROW_H = 40;
const RULER_H = 28;
const SNAP_PX = 8;
const MIN_CLIP_MS = 100;
const MIN_BGM_MS = 500;

// Full class names (not built from fragments) so Tailwind's scanner can see them.
const ROWS: ReadonlyArray<{ readonly kind: TrackKind; readonly label: string; readonly icon: LucideIcon; readonly iconClass: string; readonly audio: boolean }> = [
  { kind: "subtitle", label: "Subtitle", icon: Captions, iconClass: "text-track-subtitle", audio: false },
  { kind: "effects", label: "Efek", icon: Sparkles, iconClass: "text-track-effects", audio: false },
  { kind: "narration", label: "Narasi", icon: Mic, iconClass: "text-track-narration", audio: true },
  { kind: "bgm", label: "BGM", icon: Music, iconClass: "text-track-bgm", audio: true },
  { kind: "video", label: "Video", icon: Film, iconClass: "text-track-video", audio: false },
];

interface SceneDrag {
  readonly kind: "trimStart" | "trimEnd";
  readonly sceneId: string;
  readonly originX: number;
  readonly start: number;
  readonly end: number;
  readonly current: { readonly start: number; readonly end: number };
}

interface BgmDrag {
  readonly kind: "bgmMove" | "bgmTrim";
  readonly trackId: string;
  readonly originX: number;
  readonly start: number;
  readonly duration: number;
  readonly current: { readonly start: number; readonly duration: number };
}

type Drag = SceneDrag | BgmDrag | { readonly kind: "scrub" };

function isSceneDrag(drag: Drag): drag is SceneDrag {
  return drag.kind === "trimStart" || drag.kind === "trimEnd";
}

function isBgmDrag(drag: Drag): drag is BgmDrag {
  return drag.kind === "bgmMove" || drag.kind === "bgmTrim";
}

/** Manifest with the in-progress drag applied, so the whole layout ripples live. */
function withDrag(manifest: ProjectManifest, drag: Drag | null): ProjectManifest {
  if (!drag) return manifest;
  if (isSceneDrag(drag)) {
    return {
      ...manifest,
      scenes: manifest.scenes.map((s) => (s.id === drag.sceneId ? { ...s, videoTrimStartMs: drag.current.start, videoTrimEndMs: drag.current.end } : s)),
    };
  }
  if (!isBgmDrag(drag)) return manifest;
  return {
    ...manifest,
    bgmTracks: manifest.bgmTracks.map((t) => (t.id === drag.trackId ? { ...t, startOffsetMs: drag.current.start, durationMs: drag.current.duration } : t)),
  };
}

function tickStepSec(pxPerSec: number): number {
  return [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((step) => step * pxPerSec >= 64) ?? 300;
}

function Ruler({ durationMs, pxPerMs, onScrubStart }: { readonly durationMs: number; readonly pxPerMs: number; readonly onScrubStart: (event: ReactPointerEvent<HTMLDivElement>) => void }) {
  const stepSec = tickStepSec(pxPerMs * 1000);
  const ticks: number[] = [];
  for (let t = 0; t <= durationMs / 1000 + stepSec; t += stepSec) ticks.push(t);
  return (
    <div className="relative cursor-ew-resize border-b border-line-subtle bg-panel" style={{ height: RULER_H }} onPointerDown={onScrubStart} aria-hidden>
      {ticks.map((t) => (
        <div key={t} className="absolute top-0 h-full border-l border-line" style={{ left: t * 1000 * pxPerMs }}>
          <span className="absolute top-1 left-1 font-mono text-[11px] tabular text-fg-2">{formatTimecode(t * 1000).replace(/\.0$/, "")}</span>
        </div>
      ))}
    </div>
  );
}

function PlayheadLine({ pxPerMs, scroller }: { readonly pxPerMs: number; readonly scroller: HTMLDivElement | null }) {
  const playheadMs = useEditor((s) => s.playheadMs);
  const playing = useEditor((s) => s.playing);
  const x = playheadMs * pxPerMs;
  useEffect(() => {
    // Follow the playhead while playing (page-flip, not continuous, to avoid motion sickness).
    if (!playing || !scroller) return;
    const visibleEnd = scroller.scrollLeft + scroller.clientWidth - HEADER_W;
    if (x > visibleEnd - 40 || x < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, x - 80);
  }, [x, playing, scroller]);
  return (
    <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-playhead" style={{ left: x }} aria-hidden>
      <div className="absolute -top-0.5 -left-[5px] h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-[var(--playhead)]" />
    </div>
  );
}

function TrackHeader({ manifest, row, extra }: { readonly manifest: ProjectManifest; readonly row: (typeof ROWS)[number]; readonly extra?: ReactNode }) {
  const execute = useProjectStore((s) => s.execute);
  const readOnly = useProjectStore((s) => s.project?.readOnly ?? true);
  const state = manifest.tracks.find((t) => t.kind === row.kind) ?? { kind: row.kind, muted: false, solo: false, locked: false };
  const Icon = row.icon;
  return (
    <div className="flex items-center gap-1.5 border-r border-b border-line-subtle bg-panel px-2" style={{ height: ROW_H, width: HEADER_W }}>
      <Icon size={16} strokeWidth={1.75} className={`shrink-0 ${row.iconClass}`} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{row.label}</span>
      {extra}
      {row.audio && (
        <>
          <IconButton
            icon={state.muted ? VolumeX : Volume2}
            label={`${state.muted ? "Bunyikan" : "Bisukan"} ${row.label}`}
            pressed={state.muted}
            disabled={readOnly}
            className="size-7"
            onClick={() => execute(setTrackState(manifest, row.kind, { muted: !state.muted }))}
          />
          <IconButton
            icon={Headphones}
            label={`Solo ${row.label}`}
            pressed={state.solo}
            disabled={readOnly}
            className="size-7"
            onClick={() => execute(setTrackState(manifest, row.kind, { solo: !state.solo }))}
          />
        </>
      )}
      <IconButton
        icon={state.locked ? Lock : LockOpen}
        label={`${state.locked ? "Buka kunci" : "Kunci"} track ${row.label}`}
        pressed={state.locked}
        disabled={readOnly}
        className="size-7"
        onClick={() => execute(setTrackState(manifest, row.kind, { locked: !state.locked }))}
      />
    </div>
  );
}

const HANDLE = "absolute top-0 bottom-0 z-10 w-1.5 cursor-ew-resize bg-transparent hover:bg-accent/60";

export function Timeline({ manifest, onAddBgm }: { readonly manifest: ProjectManifest; readonly onAddBgm: () => void }) {
  const execute = useProjectStore((s) => s.execute);
  const readOnly = useProjectStore((s) => s.project?.readOnly ?? true);
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const selection = useEditor((s) => s.selection);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [snapping, setSnapping] = useState(true);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const laneRef = useRef<HTMLDivElement>(null);

  const pxPerMs = pxPerSec / 1000;
  const baseLayout = useMemo(() => layoutTimeline(manifest), [manifest]);
  const layout: TimelineLayout = useMemo(() => (drag ? layoutTimeline(withDrag(manifest, drag)) : baseLayout), [drag, manifest, baseLayout]);
  const videoLocked = isTrackLocked(manifest.tracks, "video") || readOnly;
  const bgmLocked = isTrackLocked(manifest.tracks, "bgm") || readOnly;
  const contentWidth = Math.max((layout.durationMs + 10_000) * pxPerMs, 600);

  const timeAt = (clientX: number): number => {
    const lane = laneRef.current;
    return lane ? Math.max(0, (clientX - lane.getBoundingClientRect().left) / pxPerMs) : 0;
  };

  const snap = (valueMs: number, exclude: ReadonlyArray<number>): number => {
    if (!snapping) {
      setSnapLine(null);
      return valueMs;
    }
    const candidates = snapCandidates(baseLayout, useEditor.getState().playheadMs).filter((c) => !exclude.includes(c));
    const result = snapMs(valueMs, candidates, SNAP_PX / pxPerMs);
    setSnapLine(result.snappedTo);
    return result.valueMs;
  };

  // Pointer moves and release are tracked on window so a drag survives leaving the lane.
  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent): void => {
      if (!isSceneDrag(drag) && !isBgmDrag(drag)) {
        useEditor.getState().seek(timeAt(event.clientX), baseLayout.durationMs);
        return;
      }
      const dxMs = (event.clientX - drag.originX) / pxPerMs;
      if (isSceneDrag(drag)) {
        const segment = baseLayout.segments.find((s) => s.scene.id === drag.sceneId);
        const asset = manifest.assets.find((a) => a.id === segment?.scene.videoClipId);
        if (!segment) return;
        const rate = segment.scene.playbackRate;
        if (drag.kind === "trimStart") {
          const start = Math.round(Math.min(Math.max(0, drag.start + dxMs * rate), drag.end - MIN_CLIP_MS));
          setDrag({ ...drag, current: { start, end: drag.end } });
        } else {
          const edgeMs = snap(segment.startMs + (drag.end - drag.start) / rate + dxMs, [segment.videoEndMs, segment.endMs]);
          const maxEnd = asset?.durationMs ?? Number.MAX_SAFE_INTEGER;
          const end = Math.round(Math.min(Math.max(drag.start + (edgeMs - segment.startMs) * rate, drag.start + MIN_CLIP_MS), maxEnd));
          setDrag({ ...drag, current: { start: drag.start, end } });
        }
        return;
      }
      const track = manifest.bgmTracks.find((t) => t.id === drag.trackId);
      const asset = manifest.assets.find((a) => a.kind === "audio" && a.filePath === track?.filePath);
      const own = [drag.start, drag.start + drag.duration];
      if (drag.kind === "bgmMove") {
        let start = snap(drag.start + dxMs, own);
        if (start === drag.start + dxMs) start = snap(drag.start + drag.duration + dxMs, own) - drag.duration;
        setDrag({ ...drag, current: { start: Math.max(0, Math.round(start)), duration: drag.duration } });
      } else {
        const end = snap(drag.start + drag.duration + dxMs, own);
        const duration = Math.round(Math.min(Math.max(end - drag.start, MIN_BGM_MS), asset?.durationMs ?? Number.MAX_SAFE_INTEGER));
        setDrag({ ...drag, current: { start: drag.start, duration } });
      }
    };
    const onUp = (): void => {
      setSnapLine(null);
      setDrag(null);
      if (isSceneDrag(drag)) {
        if (drag.current.start !== drag.start || drag.current.end !== drag.end) execute(trimSceneClip(manifest, drag.sceneId, drag.current.start, drag.current.end));
      } else if (!isBgmDrag(drag)) {
        return;
      } else if (drag.kind === "bgmMove" && drag.current.start !== drag.start) {
        execute(updateBgmTrack(manifest, drag.trackId, { startOffsetMs: drag.current.start }, "Geser BGM"));
      } else if (drag.kind === "bgmTrim" && drag.current.duration !== drag.duration) {
        execute(updateBgmTrack(manifest, drag.trackId, { durationMs: drag.current.duration }, "Trim BGM"));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  });

  const startScrub = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    useEditor.getState().setPlaying(false);
    useEditor.getState().seek(timeAt(event.clientX), baseLayout.durationMs);
    setDrag({ kind: "scrub" });
  };

  const split = (): void => {
    if (!readOnly) splitAtPlayhead(manifest);
  };

  const deleteSelected = (): void => {
    if (selection?.type === "scene" && !videoLocked) execute(removeScene(manifest, selection.id));
    if (selection?.type === "bgm" && !bgmLocked) execute(removeBgmTrack(manifest, selection.id));
    useEditor.getState().select(null);
  };

  // Boolean selector: re-renders only when splittability flips, not on every playhead frame.
  const splittable = useEditor((s) => splitPointAt(baseLayout, s.playheadMs) !== null);
  const canSplit = !videoLocked && splittable;

  return (
    <div className="flex h-full min-h-0 flex-col bg-timeline">
      <div className="flex items-center gap-1 border-b border-line-subtle bg-panel px-2 py-1">
        <IconButton icon={Scissors} label="Potong di playhead (C)" onClick={split} disabled={!canSplit} className="disabled:opacity-40" />
        <IconButton icon={Trash2} label="Hapus yang dipilih (Delete)" onClick={deleteSelected} disabled={selection === null || readOnly} className="disabled:opacity-40" />
        <IconButton icon={Magnet} label={snapping ? "Snapping aktif" : "Snapping mati"} pressed={snapping} onClick={() => setSnapping(!snapping)} />
        <label className="ml-auto flex items-center gap-2 text-[12px] text-fg-2">
          Zoom
          <input
            type="range"
            min={MIN_PX_PER_SEC}
            max={MAX_PX_PER_SEC}
            value={pxPerSec}
            onChange={(e) => useEditor.getState().setZoom(e.target.valueAsNumber)}
            className="w-32 accent-[var(--accent)]"
          />
        </label>
      </div>

      <div
        ref={setScroller}
        className="relative min-h-0 flex-1 overflow-auto"
        onWheel={(event) => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          useEditor.getState().setZoom(pxPerSec * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
        }}
      >
        <div className="flex" style={{ width: HEADER_W + contentWidth }}>
          <div className="sticky left-0 z-30 shrink-0" style={{ width: HEADER_W }}>
            <div className="border-r border-b border-line-subtle bg-panel" style={{ height: RULER_H }} />
            {ROWS.map((row) => (
              <TrackHeader
                key={row.kind}
                manifest={manifest}
                row={row}
                {...(row.kind === "bgm" && {
                  extra: <IconButton icon={Plus} label="Tambah BGM" onClick={onAddBgm} disabled={bgmLocked} className="size-7" />,
                })}
              />
            ))}
          </div>

          <div ref={laneRef} className="relative" style={{ width: contentWidth }}>
            <Ruler durationMs={layout.durationMs} pxPerMs={pxPerMs} onScrubStart={startScrub} />

            {ROWS.map((row) => (
              <div key={row.kind} className="relative border-b border-line-subtle" style={{ height: ROW_H }} onPointerDown={startScrub}>
                {row.kind === "video" &&
                  layout.segments.map((segment) => {
                    const selected = selection?.type === "scene" && selection.id === segment.scene.id;
                    const left = segment.startMs * pxPerMs;
                    const moving = (segment.videoEndMs - segment.startMs) * pxPerMs;
                    const hold = (segment.endMs - segment.videoEndMs) * pxPerMs;
                    return (
                      <div key={segment.scene.id} className="absolute top-1 bottom-1" style={{ left, width: moving + hold }}>
                        <button
                          type="button"
                          className={`absolute top-0 bottom-0 left-0 overflow-hidden rounded-sm border-t-2 border-track-video bg-track-video/20 px-1.5 text-left text-[12px] ${
                            selected ? "outline-2 outline-accent" : ""
                          }`}
                          style={{ width: Math.max(moving, 2) }}
                          title={`${segment.index + 1}. ${segment.scene.title}`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => useEditor.getState().select({ type: "scene", id: segment.scene.id })}
                        >
                          <span className="block truncate leading-[28px]">
                            <span className="font-mono tabular text-fg-2">{String(segment.index + 1).padStart(2, "0")}</span> {segment.scene.title}
                          </span>
                        </button>
                        {hold > 1 && (
                          <div
                            className="absolute top-0 bottom-0 rounded-r-sm opacity-60"
                            style={{
                              left: moving,
                              width: hold,
                              backgroundImage: "repeating-linear-gradient(135deg, var(--track-video) 0 2px, transparent 2px 6px)",
                            }}
                            title="Frame ditahan (freeze / jeda antar-scene)"
                          />
                        )}
                        {!videoLocked && (
                          <>
                            <div
                              className={`${HANDLE} left-0`}
                              role="separator"
                              aria-label={`Trim awal scene ${segment.index + 1}`}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                const { videoTrimStartMs: start, videoTrimEndMs: end } = segment.scene;
                                setDrag({ kind: "trimStart", sceneId: segment.scene.id, originX: e.clientX, start, end, current: { start, end } });
                              }}
                            />
                            <div
                              className={HANDLE}
                              style={{ left: Math.max(moving - 6, 0) }}
                              role="separator"
                              aria-label={`Trim akhir scene ${segment.index + 1}`}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                const { videoTrimStartMs: start, videoTrimEndMs: end } = segment.scene;
                                setDrag({ kind: "trimEnd", sceneId: segment.scene.id, originX: e.clientX, start, end, current: { start, end } });
                              }}
                            />
                          </>
                        )}
                      </div>
                    );
                  })}

                {row.kind === "narration" &&
                  layout.segments.map((segment) =>
                    segment.scene.audioDurationMs !== undefined ? (
                      <div
                        key={segment.scene.id}
                        className="absolute top-1 bottom-1 truncate rounded-sm border-t-2 border-track-narration bg-track-narration/20 px-1.5 font-mono text-[11px] leading-[28px] tabular"
                        style={{ left: segment.startMs * pxPerMs, width: (segment.audioEndMs - segment.startMs) * pxPerMs }}
                        title={`Narasi scene ${segment.index + 1}`}
                      >
                        {(segment.scene.audioDurationMs / 1000).toFixed(2)}s
                      </div>
                    ) : segment.scene.narration.trim() !== "" ? (
                      <div
                        key={segment.scene.id}
                        className="absolute top-1 bottom-1 truncate rounded-sm border border-dashed border-track-narration px-1.5 text-[11px] leading-[26px] text-fg-2"
                        style={{ left: segment.startMs * pxPerMs, width: (segment.endMs - segment.startMs) * pxPerMs }}
                      >
                        Belum disintesis
                      </div>
                    ) : null,
                  )}

                {row.kind === "effects" &&
                  layout.segments.flatMap((segment) =>
                    segment.scene.effects.map((effect) => (
                      <div
                        key={effect.id}
                        className="absolute top-1 bottom-1 truncate rounded-sm border-t-2 border-track-effects bg-track-effects/20 px-1.5 text-[11px] leading-[28px]"
                        style={{ left: (segment.startMs + effect.startOffsetMs) * pxPerMs, width: effect.durationMs * pxPerMs }}
                      >
                        {effect.type}
                      </div>
                    )),
                  )}

                {row.kind === "bgm" &&
                  layout.bgm.map((track) => {
                    const selected = selection?.type === "bgm" && selection.id === track.id;
                    const width = track.durationMs * pxPerMs;
                    return (
                      <div
                        key={track.id}
                        className={`absolute top-1 bottom-1 rounded-sm border-t-2 border-track-bgm bg-track-bgm/20 ${selected ? "outline-2 outline-accent" : ""} ${
                          bgmLocked ? "" : "cursor-grab active:cursor-grabbing"
                        }`}
                        style={{ left: track.startOffsetMs * pxPerMs, width }}
                        title={track.label}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          useEditor.getState().select({ type: "bgm", id: track.id });
                          if (!bgmLocked) {
                            const { startOffsetMs: start, durationMs: duration } = track;
                            setDrag({ kind: "bgmMove", trackId: track.id, originX: e.clientX, start, duration, current: { start, duration } });
                          }
                        }}
                      >
                        <span className="block truncate px-1.5 text-[11px] leading-[28px]">{track.label}</span>
                        {!bgmLocked && (
                          <div
                            className={HANDLE}
                            style={{ left: Math.max(width - 6, 0) }}
                            role="separator"
                            aria-label={`Trim akhir ${track.label}`}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              const { startOffsetMs: start, durationMs: duration } = track;
                              setDrag({ kind: "bgmTrim", trackId: track.id, originX: e.clientX, start, duration, current: { start, duration } });
                            }}
                          />
                        )}
                      </div>
                    );
                  })}

                {row.kind === "subtitle" && layout.segments.length > 0 && (
                  <span className="pointer-events-none absolute top-0 left-2 text-[11px] leading-[40px] text-fg-muted">Subtitle dibangun di Fase 4</span>
                )}
              </div>
            ))}

            {snapLine !== null && <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-accent" style={{ left: snapLine * pxPerMs }} aria-hidden />}
            <PlayheadLine pxPerMs={pxPerMs} scroller={scroller} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Shared by the Edit page keyboard handler. */
export function splitAtPlayhead(manifest: ProjectManifest): void {
  if (isTrackLocked(manifest.tracks, "video")) return;
  const point = splitPointAt(layoutTimeline(manifest), useEditor.getState().playheadMs);
  if (point) useProjectStore.getState().execute(splitScene(manifest, point.sceneId, point.sourceMs));
}
