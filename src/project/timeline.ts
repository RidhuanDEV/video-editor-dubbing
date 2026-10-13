/**
 * Timeline model derived from the manifest (04 §1). The scene track is magnetic: scenes sit
 * back to back, each lasting `sceneDurationMs` (body + breathing gap). Pure functions only.
 */
import type { AudioTrackConfig, ProjectManifest, ScriptScene, TrackKind } from "../types";
import { clipDurationMs, sceneDurationMs } from "./sync";

export interface SceneSegment {
  readonly scene: ScriptScene;
  readonly index: number;
  readonly startMs: number;
  /** Timeline time where moving video ends; after it the last frame is held. */
  readonly videoEndMs: number;
  /** Timeline time where the narration ends (equals startMs when there is no audio). */
  readonly audioEndMs: number;
  readonly endMs: number;
}

export interface TimelineLayout {
  readonly segments: ReadonlyArray<SceneSegment>;
  readonly bgm: ReadonlyArray<AudioTrackConfig>;
  readonly durationMs: number;
}

/** Moving-video length on the timeline (ripple-cut trims the clip to the narration). */
export function videoSpanMs(scene: ScriptScene): number {
  const clipMs = clipDurationMs(scene);
  const audioMs = scene.audioDurationMs ?? 0;
  return scene.alignmentMode === "ripple-cut" && audioMs > 0 && clipMs > audioMs ? audioMs : clipMs;
}

export function layoutTimeline(manifest: ProjectManifest): TimelineLayout {
  let cursor = 0;
  const segments = manifest.scenes.map((scene, index) => {
    const startMs = cursor;
    const endMs = startMs + sceneDurationMs(scene, manifest.sceneGapMs);
    cursor = endMs;
    return {
      scene,
      index,
      startMs,
      videoEndMs: startMs + videoSpanMs(scene),
      audioEndMs: startMs + (scene.audioDurationMs ?? 0),
      endMs,
    };
  });
  const bgmEnd = manifest.bgmTracks.reduce((max, t) => Math.max(max, t.startOffsetMs + t.durationMs), 0);
  return { segments, bgm: manifest.bgmTracks, durationMs: Math.max(cursor, bgmEnd) };
}

/** Segment under `timeMs` (binary search); the end of the timeline maps to the last scene. */
export function segmentAt(layout: TimelineLayout, timeMs: number): SceneSegment | null {
  const { segments } = layout;
  if (segments.length === 0) return null;
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const segment = segments[mid];
    if (segment && segment.startMs <= timeMs) low = mid;
    else high = mid - 1;
  }
  return segments[low] ?? null;
}

export interface VideoPosition {
  readonly segment: SceneSegment;
  /** Position inside the source media, in ms. */
  readonly sourceMs: number;
  /** True in the hold region (freeze padding or gap): show the last frame, do not play. */
  readonly frozen: boolean;
}

export function videoPositionAt(layout: TimelineLayout, timeMs: number): VideoPosition | null {
  const segment = segmentAt(layout, timeMs);
  if (!segment) return null;
  const { scene } = segment;
  const offset = Math.max(0, timeMs - segment.startMs);
  const span = segment.videoEndMs - segment.startMs;
  const frozen = offset >= span;
  const sourceMs = scene.videoTrimStartMs + Math.min(offset, span) * scene.playbackRate;
  return { segment, sourceMs: Math.min(sourceMs, scene.videoTrimEndMs), frozen };
}

/** Where to cut the source when splitting at `timeMs`, or null when the split is not possible. */
export function splitPointAt(layout: TimelineLayout, timeMs: number, minPartMs = 100): { readonly sceneId: string; readonly sourceMs: number } | null {
  const position = videoPositionAt(layout, timeMs);
  if (!position || position.frozen) return null;
  const { scene } = position.segment;
  const sourceMs = Math.round(position.sourceMs);
  if (sourceMs - scene.videoTrimStartMs < minPartMs || scene.videoTrimEndMs - sourceMs < minPartMs) return null;
  return { sceneId: scene.id, sourceMs };
}

/** Nearest candidate within `thresholdMs`, else the value unchanged. */
export function snapMs(valueMs: number, candidates: ReadonlyArray<number>, thresholdMs: number): { readonly valueMs: number; readonly snappedTo: number | null } {
  let best: number | null = null;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - valueMs);
    if (distance <= thresholdMs && (best === null || distance < Math.abs(best - valueMs))) best = candidate;
  }
  return best === null ? { valueMs, snappedTo: null } : { valueMs: best, snappedTo: best };
}

/** Snap targets: playhead, scene boundaries, narration ends, BGM edges. */
export function snapCandidates(layout: TimelineLayout, playheadMs: number): ReadonlyArray<number> {
  const points = [0, playheadMs, layout.durationMs];
  for (const s of layout.segments) points.push(s.startMs, s.endMs, s.audioEndMs);
  for (const t of layout.bgm) points.push(t.startOffsetMs, t.startOffsetMs + t.durationMs);
  return points;
}

/** Audible tracks after mute/solo (03 §5.3): solo wins; otherwise everything not muted. */
export function audibleTracks(tracks: ProjectManifest["tracks"]): ReadonlySet<TrackKind> {
  const anySolo = tracks.some((t) => t.solo);
  return new Set(tracks.filter((t) => (anySolo ? t.solo : !t.muted)).map((t) => t.kind));
}

export function isTrackLocked(tracks: ProjectManifest["tracks"], kind: TrackKind): boolean {
  return tracks.some((t) => t.kind === kind && t.locked);
}
