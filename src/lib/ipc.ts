/**
 * Typed IPC client. Every command response and rejection is validated with Zod, so the rest of
 * the UI only ever sees `IpcResult<T>` with a known shape.
 */
import { invoke, isTauri, type InvokeArgs } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  AppErrorSchema,
  DependencyReportSchema,
  EncoderDetectionSchema,
  ImportOutcomeSchema,
  OpenedProjectSchema,
  RelinkCandidateSchema,
  TtsResultSchema,
  VoiceListSchema,
  type AppError,
  type DependencyReport,
  type EncoderDetection,
  type ImportOutcome,
  type OpenedProject,
  type RelinkCandidate,
  type TtsResult,
  type TtsSynthesizeRequest,
  type VoiceInfo,
} from "../types";

export type IpcResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AppError };

async function call<S extends z.ZodType>(
  command: string,
  schema: S,
  args?: InvokeArgs,
): Promise<IpcResult<z.output<S>>> {
  if (!isTauri()) {
    return {
      ok: false,
      error: { kind: "process", message: "Engine Rust tidak tersedia. Jalankan aplikasi lewat `npm run tauri dev`." },
    };
  }
  try {
    const parsed = schema.safeParse(await invoke(command, args));
    if (parsed.success) return { ok: true, value: parsed.data };
    return {
      ok: false,
      error: { kind: "protocol", message: `Respons '${command}' tidak sesuai kontrak: ${parsed.error.message}` },
    };
  } catch (rejection) {
    const error = AppErrorSchema.safeParse(rejection);
    if (error.success) return { ok: false, error: error.data };
    return { ok: false, error: { kind: "process", message: `Perintah '${command}' gagal: ${String(rejection)}` } };
  }
}

export function checkDependencies(customFfmpegPath: string | null): Promise<IpcResult<DependencyReport>> {
  return call("check_dependencies", DependencyReportSchema, { customFfmpegPath });
}

export function detectEncoder(jobId: string, customFfmpegPath: string | null): Promise<IpcResult<EncoderDetection>> {
  return call("detect_encoder", EncoderDetectionSchema, { jobId, customFfmpegPath });
}

export function ttsSynthesize(jobId: string, request: TtsSynthesizeRequest): Promise<IpcResult<TtsResult>> {
  return call("tts_synthesize", TtsResultSchema, { jobId, request });
}

export function ttsListVoices(): Promise<IpcResult<ReadonlyArray<VoiceInfo>>> {
  return call("tts_list_voices", VoiceListSchema);
}

// ---------------------------------------------------------------------------
// Project (folders always come from native dialogs opened by Rust)
// ---------------------------------------------------------------------------

const NullSchema = z.null();

/** `null` value = the user cancelled the dialog. */
export function projectCreate(title: string): Promise<IpcResult<OpenedProject | null>> {
  return call("project_create", OpenedProjectSchema.nullable(), { title });
}

export function projectOpen(): Promise<IpcResult<OpenedProject | null>> {
  return call("project_open", OpenedProjectSchema.nullable());
}

export function projectSave(manifestJson: string): Promise<IpcResult<null>> {
  return call("project_save", NullSchema, { manifestJson });
}

export function projectAutosave(manifestJson: string): Promise<IpcResult<null>> {
  return call("project_autosave", NullSchema, { manifestJson });
}

export function projectDiscardRecovery(): Promise<IpcResult<null>> {
  return call("project_discard_recovery", NullSchema);
}

export function projectClose(): Promise<IpcResult<null>> {
  return call("project_close", NullSchema);
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export function mediaImport(jobId: string): Promise<IpcResult<ReadonlyArray<ImportOutcome>>> {
  return call("media_import", z.array(ImportOutcomeSchema), { jobId });
}

export function mediaCheckPaths(paths: ReadonlyArray<string>): Promise<IpcResult<ReadonlyArray<boolean>>> {
  return call("media_check_paths", z.array(z.boolean()), { paths });
}

export function mediaRelinkFile(assetId: string, expectedDurationMs: number | null): Promise<IpcResult<RelinkCandidate | null>> {
  return call("media_relink_file", RelinkCandidateSchema.nullable(), { assetId, expectedDurationMs });
}

export interface MissingAssetRef {
  readonly id: string;
  readonly fileName: string;
  readonly durationMs: number | null;
}

export function mediaRelinkFolder(jobId: string, missing: ReadonlyArray<MissingAssetRef>): Promise<IpcResult<ReadonlyArray<RelinkCandidate>>> {
  return call("media_relink_folder", z.array(RelinkCandidateSchema), { jobId, missing });
}

export function mediaBuildProxy(
  jobId: string,
  assetId: string,
  filePath: string,
  durationMs: number | null,
  kind: "video" | "audio",
): Promise<IpcResult<string>> {
  return call("media_build_proxy", z.string().min(1), { jobId, assetId, filePath, durationMs, kind });
}
