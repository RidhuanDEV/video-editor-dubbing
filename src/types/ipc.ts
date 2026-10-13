/**
 * IPC contracts between the React UI and the Rust core. Shapes mirror the serde output in
 * `src-tauri/src` (camelCase). IPC is a trust boundary: every response is parsed with these schemas.
 */
import { z } from "zod";
import type { DeepReadonly } from "./readonly";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const AppErrorKindSchema = z.enum([
  "network",
  "blocked",
  "timeout",
  "protocol",
  "invalidRequest",
  "io",
  "binaryNotFound",
  "process",
  "cancelled",
]);

export const AppErrorSchema = z.object({
  kind: AppErrorKindSchema,
  message: z.string(),
});

// ---------------------------------------------------------------------------
// FFmpeg dependencies & encoders
// ---------------------------------------------------------------------------

export const BinarySourceSchema = z.enum(["custom", "bundled", "system"]);
export const FfmpegLicenseSchema = z.enum(["lgpl", "gpl", "nonfree", "undetected"]);

export const ToolStatusSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("found"),
    path: z.string(),
    source: BinarySourceSchema,
    version: z.string(),
    license: FfmpegLicenseSchema,
  }),
  z.object({
    status: z.literal("missing"),
    reason: z.string(),
  }),
]);

export const DependencyReportSchema = z.object({
  ffmpeg: ToolStatusSchema,
  ffprobe: ToolStatusSchema,
});

export const VideoEncoderIdSchema = z.enum([
  "h264_nvenc",
  "h264_qsv",
  "h264_amf",
  "h264_videotoolbox",
  "libopenh264",
]);

export const EncoderCandidateSchema = z.object({
  encoder: VideoEncoderIdSchema,
  hardware: z.boolean(),
  listed: z.boolean(),
  testPassed: z.boolean(),
  error: z.string().nullable(),
});

export const EncoderDetectionSchema = z.object({
  selected: VideoEncoderIdSchema.nullable(),
  candidates: z.array(EncoderCandidateSchema),
});

// ---------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------

export const TtsSynthesizeRequestSchema = z.object({
  text: z.string().min(1),
  voiceId: z.string().min(1),
  rate: z.string().regex(/^[+-]\d+%$/),
  pitch: z.string().regex(/^[+-]\d+Hz$/),
  volume: z.string().regex(/^[+-]\d+%$/),
});

export const WordBoundarySchema = z.object({
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});

export const TtsResultSchema = z.object({
  jobId: z.string().min(1),
  providerId: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  audioPath: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  cached: z.boolean(),
  wordBoundaries: z.array(WordBoundarySchema),
});

export const VoiceInfoSchema = z.object({
  shortName: z.string().min(1),
  locale: z.string().min(1),
  gender: z.string(),
  friendlyName: z.string(),
});

export const VoiceListSchema = z.array(VoiceInfoSchema);

// ---------------------------------------------------------------------------
// Project & media
// ---------------------------------------------------------------------------

export const OpenedProjectSchema = z.object({
  root: z.string().min(1),
  manifestJson: z.string().nullable(),
  recoveryJson: z.string().nullable(),
});

export const ProbedMediaSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["video", "audio", "image"]),
  filePath: z.string().min(1),
  fileName: z.string(),
  durationMs: z.number().int().positive().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  fps: z.number().positive().nullable(),
  thumbnailPath: z.string().nullable(),
});

export const ImportOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("imported"), media: ProbedMediaSchema }),
  z.object({ status: z.literal("failed"), fileName: z.string(), message: z.string() }),
]);

export const RelinkCandidateSchema = z.object({
  media: ProbedMediaSchema,
  durationMatches: z.boolean(),
});

// ---------------------------------------------------------------------------
// Job events: emitted by `src-tauri/src/jobs.rs` for every long-running command
// ---------------------------------------------------------------------------

export const JOB_EVENT = "job://event";

export const JobEventSchema = z.object({
  jobId: z.uuid(),
  kind: z.enum(["tts", "encoderDetection", "mediaImport", "mediaRelink", "mediaProxy", "export"]),
  status: z.enum(["started", "progress", "succeeded", "failed"]),
  message: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Export (05 §4–5)
// ---------------------------------------------------------------------------

export const RENDER_PROGRESS_EVENT = "render://progress";

export const PresetIdSchema = z.enum(["youtube1080", "youtube4k", "shorts", "whatsapp", "audioOnly"]);

export const RenderProgressSchema = z.object({
  jobId: z.string().min(1),
  stage: z.enum(["measure", "encode"]),
  percentage: z.number().min(0).max(100),
  fps: z.number().nonnegative(),
  speedMultiplier: z.number().nonnegative(),
  etaSeconds: z.number().nullable(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type AppErrorKind = z.infer<typeof AppErrorKindSchema>;
export type AppError = DeepReadonly<z.infer<typeof AppErrorSchema>>;
export type BinarySource = z.infer<typeof BinarySourceSchema>;
export type FfmpegLicense = z.infer<typeof FfmpegLicenseSchema>;
export type ToolStatus = DeepReadonly<z.infer<typeof ToolStatusSchema>>;
export type DependencyReport = DeepReadonly<z.infer<typeof DependencyReportSchema>>;
export type VideoEncoderId = z.infer<typeof VideoEncoderIdSchema>;
export type EncoderCandidate = DeepReadonly<z.infer<typeof EncoderCandidateSchema>>;
export type EncoderDetection = DeepReadonly<z.infer<typeof EncoderDetectionSchema>>;
export type TtsSynthesizeRequest = DeepReadonly<z.infer<typeof TtsSynthesizeRequestSchema>>;
export type WordBoundary = DeepReadonly<z.infer<typeof WordBoundarySchema>>;
export type TtsResult = DeepReadonly<z.infer<typeof TtsResultSchema>>;
export type VoiceInfo = DeepReadonly<z.infer<typeof VoiceInfoSchema>>;
export type JobEvent = DeepReadonly<z.infer<typeof JobEventSchema>>;
export type PresetId = z.infer<typeof PresetIdSchema>;
export type RenderProgress = DeepReadonly<z.infer<typeof RenderProgressSchema>>;
export type OpenedProject = DeepReadonly<z.infer<typeof OpenedProjectSchema>>;
export type ProbedMedia = DeepReadonly<z.infer<typeof ProbedMediaSchema>>;
export type ImportOutcome = DeepReadonly<z.infer<typeof ImportOutcomeSchema>>;
export type RelinkCandidate = DeepReadonly<z.infer<typeof RelinkCandidateSchema>>;
