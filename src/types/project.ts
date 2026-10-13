/**
 * Project manifest contract (PRD 02). Every value read from disk is untrusted and must pass
 * `ProjectManifestSchema` before it reaches app state. Types are inferred, never hand-written twice.
 */
import { z } from "zod";
import type { DeepReadonly } from "./readonly";

export const SCHEMA_VERSION = "1.0.0";

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const HexColorWithAlpha = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
const Id = z.string().min(1);
const NonNegativeMs = z.number().int().nonnegative();
const PositiveMs = z.number().int().positive();

/**
 * Path stored relative to the project folder (proxy/, cache/). Rejects absolute paths and `..`
 * segments so a crafted project.json cannot point the app outside its own folder (02 §4, 01 §7).
 */
const ProjectRelativePath = z
  .string()
  .min(1)
  .refine((p) => !/^([a-zA-Z]:)?[\\/]/.test(p), { message: "Path must be relative to the project folder" })
  .refine((p) => !p.split(/[\\/]/).includes(".."), { message: "Path must not contain '..' segments" });

// ---------------------------------------------------------------------------
// 1. Settings & canvas
// ---------------------------------------------------------------------------

export const AspectRatioSchema = z.enum(["16:9", "9:16", "1:1", "4:3"]);
export const FitModeSchema = z.enum(["contain", "cover", "fill"]);
export const EncoderHardwareSchema = z.enum(["auto", "nvenc", "qsv", "amf", "videotoolbox", "openh264"]);
/** "azure-speech" added before the first release (no schema bump needed: old files stay valid). */
export const VoiceEngineSchema = z.enum(["edge-tts", "azure-speech", "kokoro-local", "custom-api"]);

export const CanvasSettingsSchema = z.object({
  width: z.number().int().min(320).max(7680),
  height: z.number().int().min(240).max(4320),
  fps: z.number().int().min(15).max(120),
  background: HexColor,
  padding: z.number().nonnegative(),
  fit: FitModeSchema,
  aspectRatio: AspectRatioSchema,
});

export const VoiceConfigSchema = z.object({
  engine: VoiceEngineSchema,
  voiceId: z.string().min(1),
  rate: z.string().regex(/^[+-]\d+%$/),
  pitch: z.string().regex(/^[+-]\d+Hz$/),
  volume: z.string().regex(/^[+-]\d+%$/),
});

// ---------------------------------------------------------------------------
// 2. Scene effects (discriminated union on `type`)
// ---------------------------------------------------------------------------

const NormalizedPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const RectSchema = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
});

const EffectTimingShape = {
  id: Id,
  startOffsetMs: NonNegativeMs,
  durationMs: PositiveMs,
};

export const ZoomEffectSchema = z.object({
  ...EffectTimingShape,
  type: z.literal("zoom"),
  scale: z.number().min(1).max(8),
  target: NormalizedPointSchema,
  spotlightMask: z.boolean(),
});

export const BlurEffectSchema = z.object({
  ...EffectTimingShape,
  type: z.literal("blur"),
  rect: RectSchema,
  blurStrength: z.number().positive().max(100),
});

export const BadgeCalloutEffectSchema = z.object({
  ...EffectTimingShape,
  type: z.literal("callout"),
  label: z.string().min(1).max(60),
  position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
});

export const SceneEffectSchema = z.discriminatedUnion("type", [
  ZoomEffectSchema,
  BlurEffectSchema,
  BadgeCalloutEffectSchema,
]);

// ---------------------------------------------------------------------------
// 3. Script scene
// ---------------------------------------------------------------------------

export const SceneAlignmentModeSchema = z.enum(["freeze-frame", "ripple-cut", "natural-pause"]);

export const ScriptSceneSchema = z
  .object({
    id: Id,
    order: z.number().int().nonnegative(),
    title: z.string().max(255),
    narration: z.string(),
    voiceOverride: VoiceConfigSchema.partial().optional(),
    videoClipId: Id,
    videoTrimStartMs: NonNegativeMs,
    videoTrimEndMs: PositiveMs,
    playbackRate: z.number().min(0.25).max(4),
    alignmentMode: SceneAlignmentModeSchema,
    effects: z.array(SceneEffectSchema),
    audioDurationMs: PositiveMs.optional(),
    audioCachePath: ProjectRelativePath.optional(),
    audioSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .refine((s) => s.videoTrimEndMs > s.videoTrimStartMs, {
    message: "videoTrimEndMs must be greater than videoTrimStartMs",
    path: ["videoTrimEndMs"],
  });

// ---------------------------------------------------------------------------
// 4. Audio tracks (BGM / overlays)
// ---------------------------------------------------------------------------

export const AudioTrackConfigSchema = z.object({
  id: Id,
  label: z.string().min(1),
  filePath: z.string().min(1),
  startOffsetMs: NonNegativeMs,
  durationMs: PositiveMs,
  volume: z.number().min(0).max(1),
  autoDuck: z.boolean(),
  duckVolume: z.number().min(0).max(1),
});

// ---------------------------------------------------------------------------
// 5. Subtitles & karaoke cues
// ---------------------------------------------------------------------------

export const SubtitleWordCueSchema = z.object({
  word: z.string().min(1),
  startMs: NonNegativeMs,
  endMs: NonNegativeMs,
});

export const SubtitleCueSchema = z.object({
  id: Id,
  startMs: NonNegativeMs,
  endMs: NonNegativeMs,
  text: z.string(),
  words: z.array(SubtitleWordCueSchema).optional(),
});

export const SubtitleSettingsSchema = z.object({
  enabled: z.boolean(),
  fontName: z.string().min(1),
  fontSize: z.number().int().min(8).max(200),
  primaryColor: HexColor,
  highlightColor: HexColor,
  backColor: HexColorWithAlpha,
  maxCharsPerChunk: z.number().int().min(20).max(200),
});

// ---------------------------------------------------------------------------
// 6. Media assets, markers, tracks, loudness
// ---------------------------------------------------------------------------

export const MediaKindSchema = z.enum(["video", "audio", "image"]);

export const MediaAssetSchema = z.object({
  id: Id,
  kind: MediaKindSchema,
  /** Absolute source path; may go missing and require relink (02 §4). */
  filePath: z.string().min(1),
  durationMs: PositiveMs.optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().optional(),
  proxyPath: ProjectRelativePath.optional(),
  interactionLogPath: z.string().min(1).optional(),
});

export const MarkerSchema = z.object({
  id: Id,
  timeMs: NonNegativeMs,
  label: z.string().max(120),
  exportAsChapter: z.boolean(),
});

export const TrackKindSchema = z.enum(["video", "narration", "bgm", "effects", "subtitle"]);

export const TrackStateSchema = z.object({
  kind: TrackKindSchema,
  muted: z.boolean(),
  solo: z.boolean(),
  locked: z.boolean(),
});

export const LoudnessSettingsSchema = z.object({
  enabled: z.boolean(),
  targetLufs: z.number().min(-30).max(-5),
});

// ---------------------------------------------------------------------------
// 7. Master manifest (project.json inside the .smbproj folder)
// ---------------------------------------------------------------------------

export const ProjectManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.uuid(),
  title: z.string().min(1).max(255),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  defaultVoice: VoiceConfigSchema,
  canvas: CanvasSettingsSchema,
  assets: z.array(MediaAssetSchema),
  scenes: z.array(ScriptSceneSchema),
  bgmTracks: z.array(AudioTrackConfigSchema),
  subtitleSettings: SubtitleSettingsSchema,
  markers: z.array(MarkerSchema),
  tracks: z.array(TrackStateSchema),
  sceneGapMs: z.number().int().min(0).max(5000),
  loudness: LoudnessSettingsSchema,
});

// ---------------------------------------------------------------------------
// Inferred, deeply readonly types
// ---------------------------------------------------------------------------

export type AspectRatio = z.infer<typeof AspectRatioSchema>;
export type FitMode = z.infer<typeof FitModeSchema>;
export type EncoderHardware = z.infer<typeof EncoderHardwareSchema>;
export type VoiceEngine = z.infer<typeof VoiceEngineSchema>;
export type CanvasSettings = DeepReadonly<z.infer<typeof CanvasSettingsSchema>>;
export type VoiceConfig = DeepReadonly<z.infer<typeof VoiceConfigSchema>>;
export type ZoomEffect = DeepReadonly<z.infer<typeof ZoomEffectSchema>>;
export type BlurEffect = DeepReadonly<z.infer<typeof BlurEffectSchema>>;
export type BadgeCalloutEffect = DeepReadonly<z.infer<typeof BadgeCalloutEffectSchema>>;
export type SceneEffect = DeepReadonly<z.infer<typeof SceneEffectSchema>>;
export type SceneAlignmentMode = z.infer<typeof SceneAlignmentModeSchema>;
export type ScriptScene = DeepReadonly<z.infer<typeof ScriptSceneSchema>>;
export type AudioTrackConfig = DeepReadonly<z.infer<typeof AudioTrackConfigSchema>>;
export type SubtitleWordCue = DeepReadonly<z.infer<typeof SubtitleWordCueSchema>>;
export type SubtitleCue = DeepReadonly<z.infer<typeof SubtitleCueSchema>>;
export type SubtitleSettings = DeepReadonly<z.infer<typeof SubtitleSettingsSchema>>;
export type MediaKind = z.infer<typeof MediaKindSchema>;
export type MediaAsset = DeepReadonly<z.infer<typeof MediaAssetSchema>>;
export type Marker = DeepReadonly<z.infer<typeof MarkerSchema>>;
export type TrackKind = z.infer<typeof TrackKindSchema>;
export type TrackState = DeepReadonly<z.infer<typeof TrackStateSchema>>;
export type LoudnessSettings = DeepReadonly<z.infer<typeof LoudnessSettingsSchema>>;
export type ProjectManifest = DeepReadonly<z.infer<typeof ProjectManifestSchema>>;
