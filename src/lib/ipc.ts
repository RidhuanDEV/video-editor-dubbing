/**
 * Typed IPC client. Every command response and rejection is validated with Zod, so the rest of
 * the UI only ever sees `IpcResult<T>` with a known shape.
 */
import { invoke, isTauri, type InvokeArgs } from "@tauri-apps/api/core";
import type { z } from "zod";
import {
  AppErrorSchema,
  DependencyReportSchema,
  EncoderDetectionSchema,
  TtsResultSchema,
  VoiceListSchema,
  type AppError,
  type DependencyReport,
  type EncoderDetection,
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
