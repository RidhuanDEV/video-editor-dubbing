/**
 * Undoable project mutations (F-CORE-1, 03 §5.4). Every change goes through a `Command`.
 * Commands hold only the slice they touch (one scene, the asset list, ...), never a full
 * manifest snapshot, and are absolute ("set X to this"), so consecutive commands with the same
 * `coalesceKey` merge safely: keep the first `revert`, the last `apply`.
 */
import type { MediaAsset, ProjectManifest, ScriptScene, VoiceConfig } from "../types";

export interface Command {
  readonly label: string;
  /** Typing in one field coalesces into a single undo step (see store). */
  readonly coalesceKey?: string;
  readonly apply: (manifest: ProjectManifest) => ProjectManifest;
  readonly revert: (manifest: ProjectManifest) => ProjectManifest;
}

type Scenes = ProjectManifest["scenes"];
export type ScenePatch = Partial<Omit<ScriptScene, "id" | "order" | "audioDurationMs" | "audioCachePath" | "audioSha256">>;

function withScenes(manifest: ProjectManifest, scenes: Scenes): ProjectManifest {
  // `order` always mirrors array position so the manifest never holds conflicting orderings.
  return { ...manifest, scenes: scenes.map((scene, index) => (scene.order === index ? scene : { ...scene, order: index })) };
}

function replaceScene(manifest: ProjectManifest, scene: ScriptScene): ProjectManifest {
  return withScenes(manifest, manifest.scenes.map((s) => (s.id === scene.id ? scene : s)));
}

/** Drops synthesized audio: it no longer matches the text or voice that produced it. */
export function withoutAudio(scene: ScriptScene): ScriptScene {
  const { audioDurationMs: _duration, audioCachePath: _path, audioSha256: _sha, ...rest } = scene;
  return rest;
}

const AUDIO_INPUTS: ReadonlyArray<keyof ScenePatch> = ["narration", "voiceOverride"];

export function updateScene(manifest: ProjectManifest, sceneId: string, patch: ScenePatch, coalesceKey?: string): Command | null {
  const before = manifest.scenes.find((s) => s.id === sceneId);
  if (!before) return null;
  const merged: ScriptScene = { ...before, ...patch };
  const after = AUDIO_INPUTS.some((key) => key in patch) ? withoutAudio(merged) : merged;
  return {
    label: "Ubah scene",
    ...(coalesceKey !== undefined && { coalesceKey }),
    apply: (m) => replaceScene(m, after),
    revert: (m) => replaceScene(m, before),
  };
}

/** Replaces the voice override (or removes it when `null`); separate because it is optional. */
export function setSceneVoice(manifest: ProjectManifest, sceneId: string, voice: Partial<VoiceConfig> | null): Command | null {
  const before = manifest.scenes.find((s) => s.id === sceneId);
  if (!before) return null;
  const { voiceOverride: _old, ...rest } = withoutAudio(before);
  const after: ScriptScene = voice === null ? rest : { ...rest, voiceOverride: voice };
  return {
    label: "Ubah suara scene",
    apply: (m) => replaceScene(m, after),
    revert: (m) => replaceScene(m, before),
  };
}

export function insertScenes(manifest: ProjectManifest, scenes: ReadonlyArray<ScriptScene>, index: number = manifest.scenes.length): Command {
  const ids = new Set(scenes.map((s) => s.id));
  return {
    label: scenes.length > 1 ? `Tambah ${scenes.length} scene` : "Tambah scene",
    apply: (m) => {
      const at = Math.min(Math.max(index, 0), m.scenes.length);
      return withScenes(m, [...m.scenes.slice(0, at), ...scenes, ...m.scenes.slice(at)]);
    },
    revert: (m) => withScenes(m, m.scenes.filter((s) => !ids.has(s.id))),
  };
}

export function removeScene(manifest: ProjectManifest, sceneId: string): Command | null {
  const index = manifest.scenes.findIndex((s) => s.id === sceneId);
  const scene = manifest.scenes[index];
  if (!scene) return null;
  return {
    label: "Hapus scene",
    apply: (m) => withScenes(m, m.scenes.filter((s) => s.id !== sceneId)),
    revert: (m) => withScenes(m, [...m.scenes.slice(0, index), scene, ...m.scenes.slice(index)]),
  };
}

function move<T>(items: ReadonlyArray<T>, from: number, to: number): ReadonlyArray<T> {
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  if (item !== undefined) copy.splice(to, 0, item);
  return copy;
}

export function moveScene(manifest: ProjectManifest, sceneId: string, delta: number): Command | null {
  const from = manifest.scenes.findIndex((s) => s.id === sceneId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= manifest.scenes.length) return null;
  return {
    label: "Pindahkan scene",
    apply: (m) => withScenes(m, move(m.scenes, from, to)),
    revert: (m) => withScenes(m, move(m.scenes, to, from)),
  };
}

export function addAssets(assets: ReadonlyArray<MediaAsset>): Command {
  const ids = new Set(assets.map((a) => a.id));
  return {
    label: assets.length > 1 ? `Impor ${assets.length} media` : "Impor media",
    apply: (m) => ({ ...m, assets: [...m.assets, ...assets] }),
    revert: (m) => ({ ...m, assets: m.assets.filter((a) => !ids.has(a.id)) }),
  };
}

/** Assets referenced by a scene cannot be removed (the manifest would become invalid). */
export function removeAsset(manifest: ProjectManifest, assetId: string): Command | null {
  const index = manifest.assets.findIndex((a) => a.id === assetId);
  const asset = manifest.assets[index];
  if (!asset || manifest.scenes.some((s) => s.videoClipId === assetId)) return null;
  return {
    label: "Hapus media",
    apply: (m) => ({ ...m, assets: m.assets.filter((a) => a.id !== assetId) }),
    revert: (m) => ({ ...m, assets: [...m.assets.slice(0, index), asset, ...m.assets.slice(index)] }),
  };
}

/** A relinked file is the same media moved elsewhere, so its existing proxy stays valid. */
export function relinkAssets(manifest: ProjectManifest, replacements: ReadonlyArray<MediaAsset>): Command | null {
  const before = manifest.assets.filter((a) => replacements.some((r) => r.id === a.id));
  if (before.length === 0) return null;
  const beforeById = new Map(before.map((a) => [a.id, a]));
  const byId = new Map(
    replacements.map((r) => {
      const proxyPath = beforeById.get(r.id)?.proxyPath;
      return [r.id, proxyPath !== undefined && r.proxyPath === undefined ? { ...r, proxyPath } : r];
    }),
  );
  return {
    label: before.length > 1 ? `Hubungkan ulang ${before.length} media` : "Hubungkan ulang media",
    apply: (m) => ({ ...m, assets: m.assets.map((a) => byId.get(a.id) ?? a) }),
    revert: (m) => ({ ...m, assets: m.assets.map((a) => beforeById.get(a.id) ?? a) }),
  };
}

/** Changing the default voice invalidates audio of scenes that inherit it. */
export function setDefaultVoice(manifest: ProjectManifest, voice: VoiceConfig): Command {
  const beforeVoice = manifest.defaultVoice;
  const beforeScenes = manifest.scenes;
  const afterScenes = manifest.scenes.map((s) => (s.voiceOverride?.voiceId === undefined ? withoutAudio(s) : s));
  return {
    label: "Ubah suara default",
    apply: (m) => withScenes({ ...m, defaultVoice: voice }, afterScenes),
    revert: (m) => withScenes({ ...m, defaultVoice: beforeVoice }, beforeScenes),
  };
}

/** Merges `next` into `previous` (same coalesce key): original revert, latest apply. */
export function coalesce(previous: Command, next: Command): Command {
  return { ...next, revert: previous.revert };
}

/** Voice actually used for a scene: project default overlaid with the scene override. */
export function effectiveVoice(manifest: ProjectManifest, scene: ScriptScene): VoiceConfig {
  // Per field: a partial override may carry explicit `undefined`, which must not erase the default.
  const base = manifest.defaultVoice;
  const override = scene.voiceOverride;
  return {
    engine: override?.engine ?? base.engine,
    voiceId: override?.voiceId ?? base.voiceId,
    rate: override?.rate ?? base.rate,
    pitch: override?.pitch ?? base.pitch,
    volume: override?.volume ?? base.volume,
  };
}

/** Clip length assumed when a video's duration is unknown (probe returned none). */
export const FALLBACK_CLIP_MS = 5000;

/**
 * New scenes for `narrations`, all on `asset`, each taking an equal slice of the clip.
 * Fine-tuning happens on the timeline (Phase 3); the schema needs a valid trim from the start.
 */
export function buildScenes(asset: MediaAsset, narrations: ReadonlyArray<string>, titleOf: (narration: string) => string): ReadonlyArray<ScriptScene> {
  const total = asset.durationMs ?? FALLBACK_CLIP_MS;
  const count = Math.max(narrations.length, 1);
  return narrations.map((narration, index) => {
    const start = Math.floor((total * index) / count);
    const end = Math.max(Math.floor((total * (index + 1)) / count), start + 1);
    return {
      id: crypto.randomUUID(),
      order: index,
      title: titleOf(narration),
      narration,
      videoClipId: asset.id,
      videoTrimStartMs: start,
      videoTrimEndMs: end,
      playbackRate: 1,
      alignmentMode: "freeze-frame",
      effects: [],
    };
  });
}

// ---------------------------------------------------------------------------
// Timeline (Phase 3)
// ---------------------------------------------------------------------------

/** One drag gesture = one command (03 §5.4): call with the final values on pointer-up. */
export function trimSceneClip(manifest: ProjectManifest, sceneId: string, startMs: number, endMs: number): Command | null {
  const command = updateScene(manifest, sceneId, { videoTrimStartMs: Math.round(startMs), videoTrimEndMs: Math.round(endMs) });
  return command && { ...command, label: "Trim klip" };
}

/**
 * Splits a scene at a source position. The left part keeps narration and audio; the right part
 * continues the same clip as a new scene with empty narration. Effects move with their start time.
 */
export function splitScene(manifest: ProjectManifest, sceneId: string, atSourceMs: number): Command | null {
  const index = manifest.scenes.findIndex((s) => s.id === sceneId);
  const scene = manifest.scenes[index];
  if (!scene || atSourceMs <= scene.videoTrimStartMs || atSourceMs >= scene.videoTrimEndMs) return null;
  const leftSceneMs = (atSourceMs - scene.videoTrimStartMs) / scene.playbackRate;
  const left: ScriptScene = {
    ...scene,
    videoTrimEndMs: atSourceMs,
    effects: scene.effects.filter((e) => e.startOffsetMs < leftSceneMs),
  };
  const right: ScriptScene = {
    id: crypto.randomUUID(),
    order: index + 1,
    title: `${scene.title} (lanjutan)`.slice(0, 255),
    narration: "",
    videoClipId: scene.videoClipId,
    videoTrimStartMs: atSourceMs,
    videoTrimEndMs: scene.videoTrimEndMs,
    playbackRate: scene.playbackRate,
    alignmentMode: scene.alignmentMode,
    effects: scene.effects
      .filter((e) => e.startOffsetMs >= leftSceneMs)
      .map((e) => ({ ...e, startOffsetMs: Math.round(e.startOffsetMs - leftSceneMs) })),
  };
  return {
    label: "Potong scene",
    apply: (m) => withScenes(m, [...m.scenes.slice(0, index), left, right, ...m.scenes.slice(index + 1)]),
    revert: (m) => withScenes(m, [...m.scenes.slice(0, index), scene, ...m.scenes.slice(index + 2)]),
  };
}

type TrackState = ProjectManifest["tracks"][number];

export function setTrackState(manifest: ProjectManifest, kind: TrackState["kind"], patch: Partial<Pick<TrackState, "muted" | "solo" | "locked">>): Command {
  const before = manifest.tracks;
  const exists = before.some((t) => t.kind === kind);
  const base: ReadonlyArray<TrackState> = exists ? before : [...before, { kind, muted: false, solo: false, locked: false }];
  const after = base.map((t) => (t.kind === kind ? { ...t, ...patch } : t));
  const verb = patch.locked !== undefined ? (patch.locked ? "Kunci" : "Buka kunci") : patch.solo !== undefined ? "Solo" : "Mute";
  return {
    label: `${verb} track`,
    apply: (m) => ({ ...m, tracks: after }),
    revert: (m) => ({ ...m, tracks: before }),
  };
}

type BgmTrack = ProjectManifest["bgmTracks"][number];

export function addBgmTrack(asset: MediaAsset, startOffsetMs: number, label: string): Command | null {
  if (asset.kind !== "audio" || asset.durationMs === undefined) return null;
  const track: BgmTrack = {
    id: crypto.randomUUID(),
    label,
    filePath: asset.filePath,
    startOffsetMs: Math.max(0, Math.round(startOffsetMs)),
    durationMs: asset.durationMs,
    volume: 0.4,
    autoDuck: true,
    duckVolume: 0.15,
  };
  return {
    label: "Tambah BGM",
    apply: (m) => ({ ...m, bgmTracks: [...m.bgmTracks, track] }),
    revert: (m) => ({ ...m, bgmTracks: m.bgmTracks.filter((t) => t.id !== track.id) }),
  };
}

export function updateBgmTrack(
  manifest: ProjectManifest,
  trackId: string,
  patch: Partial<Pick<BgmTrack, "startOffsetMs" | "durationMs" | "volume" | "autoDuck" | "duckVolume">>,
  label: string,
  coalesceKey?: string,
): Command | null {
  const before = manifest.bgmTracks.find((t) => t.id === trackId);
  if (!before) return null;
  const after: BgmTrack = { ...before, ...patch };
  const replace = (m: ProjectManifest, track: BgmTrack): ProjectManifest => ({ ...m, bgmTracks: m.bgmTracks.map((t) => (t.id === trackId ? track : t)) });
  return {
    label,
    ...(coalesceKey !== undefined && { coalesceKey }),
    apply: (m) => replace(m, after),
    revert: (m) => replace(m, before),
  };
}

export function removeBgmTrack(manifest: ProjectManifest, trackId: string): Command | null {
  const index = manifest.bgmTracks.findIndex((t) => t.id === trackId);
  const track = manifest.bgmTracks[index];
  if (!track) return null;
  return {
    label: "Hapus BGM",
    apply: (m) => ({ ...m, bgmTracks: m.bgmTracks.filter((t) => t.id !== trackId) }),
    revert: (m) => ({ ...m, bgmTracks: [...m.bgmTracks.slice(0, index), track, ...m.bgmTracks.slice(index)] }),
  };
}

// ---------------------------------------------------------------------------
// Effects (Phase 4)
// ---------------------------------------------------------------------------

type Effect = ScriptScene["effects"][number];

function withEffects(manifest: ProjectManifest, sceneId: string, label: string, map: (effects: ReadonlyArray<Effect>) => ReadonlyArray<Effect>, coalesceKey?: string): Command | null {
  const scene = manifest.scenes.find((s) => s.id === sceneId);
  if (!scene) return null;
  const command = updateScene(manifest, sceneId, { effects: map(scene.effects) }, coalesceKey);
  return command && { ...command, label };
}

export function addEffect(manifest: ProjectManifest, sceneId: string, effect: Effect): Command | null {
  return withEffects(manifest, sceneId, "Tambah efek", (effects) => [...effects, effect]);
}

/** Replaces one effect. Gizmo drags pass a coalesce key so a whole drag is one undo step. */
export function replaceEffect(manifest: ProjectManifest, sceneId: string, effect: Effect, coalesceKey?: string): Command | null {
  return withEffects(manifest, sceneId, "Ubah efek", (effects) => effects.map((e) => (e.id === effect.id ? effect : e)), coalesceKey);
}

export function removeEffect(manifest: ProjectManifest, sceneId: string, effectId: string): Command | null {
  return withEffects(manifest, sceneId, "Hapus efek", (effects) => effects.filter((e) => e.id !== effectId));
}

export function setSubtitleSettings(manifest: ProjectManifest, settings: ProjectManifest["subtitleSettings"], coalesceKey: string): Command {
  const before = manifest.subtitleSettings;
  return {
    label: "Ubah gaya subtitle",
    coalesceKey,
    apply: (m) => ({ ...m, subtitleSettings: settings }),
    revert: (m) => ({ ...m, subtitleSettings: before }),
  };
}

export function setAudioMix(manifest: ProjectManifest, patch: Partial<Pick<ProjectManifest, "loudness" | "sceneGapMs">>, coalesceKey: string): Command {
  const before = { loudness: manifest.loudness, sceneGapMs: manifest.sceneGapMs };
  return {
    label: "Ubah pengaturan audio",
    coalesceKey,
    apply: (m) => ({ ...m, ...patch }),
    revert: (m) => ({ ...m, ...before }),
  };
}
