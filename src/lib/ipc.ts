/**
 * Typed IPC client. Every command response and rejection is validated with Zod, so the rest of
 * the UI only ever sees `IpcResult<T>` with a known shape.
 */
import { invoke, isTauri, type InvokeArgs } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  AppErrorSchema,
  DependencyReportSchema,
  EncoderReportSchema,
  ImportOutcomeSchema,
  OpenedProjectSchema,
  RecentProjectSchema,
  RelinkCandidateSchema,
  SettingsViewSchema,
  TtsResultSchema,
  VoiceListSchema,
  WordBoundarySchema,
  type AppError,
  type DependencyReport,
  type Codec,
  type EncoderReport,
  type ImportOutcome,
  type OpenedProject,
  type PresetId,
  type RecentProject,
  type RelinkCandidate,
  type SettingsView,
  type VoiceEngine,
  type TtsResult,
  type TtsSynthesizeRequest,
  type VoiceInfo,
  type WordBoundary,
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

/** Diagnostics for the FFmpeg every job uses (custom from Settings → bundled → PATH). */
export function checkDependencies(): Promise<IpcResult<DependencyReport>> {
  return call("check_dependencies", DependencyReportSchema);
}

export function detectEncoder(jobId: string): Promise<IpcResult<EncoderReport>> {
  return call("detect_encoder", EncoderReportSchema, { jobId });
}

export function ttsSynthesize(jobId: string, engine: VoiceEngine, request: TtsSynthesizeRequest): Promise<IpcResult<TtsResult>> {
  return call("tts_synthesize", TtsResultSchema, { jobId, engine, request });
}

export function ttsListVoices(engine: VoiceEngine): Promise<IpcResult<ReadonlyArray<VoiceInfo>>> {
  return call("tts_list_voices", VoiceListSchema, { engine });
}

export function settingsGet(): Promise<IpcResult<SettingsView>> {
  return call("settings_get", SettingsViewSchema);
}

export function settingsSetEdgeConsent(consent: boolean): Promise<IpcResult<SettingsView>> {
  return call("settings_set_edge_consent", SettingsViewSchema, { consent });
}

/** Verifies the key with Azure before storing it in the OS keychain; returns the voice count. */
export function settingsSetAzure(region: string, key: string): Promise<IpcResult<number>> {
  return call("settings_set_azure", z.number().int().nonnegative(), { region, key });
}

export function settingsClearAzure(): Promise<IpcResult<SettingsView>> {
  return call("settings_clear_azure", SettingsViewSchema);
}

/** Native file dialog in Rust; the binary is verified before it is stored. `null` = cancelled. */
export function settingsPickFfmpeg(): Promise<IpcResult<SettingsView | null>> {
  return call("settings_pick_ffmpeg", SettingsViewSchema.nullable());
}

export function settingsClearFfmpeg(): Promise<IpcResult<SettingsView>> {
  return call("settings_clear_ffmpeg", SettingsViewSchema);
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

export function recentProjects(): Promise<IpcResult<ReadonlyArray<RecentProject>>> {
  return call("recent_projects", z.array(RecentProjectSchema));
}

export function recentProjectsForget(path: string): Promise<IpcResult<null>> {
  return call("recent_projects_forget", NullSchema, { path });
}

/** Only paths from the recent list are accepted by Rust. */
export function projectOpenRecent(path: string): Promise<IpcResult<OpenedProject>> {
  return call("project_open_recent", OpenedProjectSchema, { path });
}

/** Opens a project folder dropped on the window (paths captured in Rust). `null` = none in the drop. */
export function projectOpenDropped(): Promise<IpcResult<OpenedProject | null>> {
  return call("project_open_dropped", OpenedProjectSchema.nullable());
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

/** Imports the media files of the last drop on the window (paths captured in Rust). */
export function mediaImportDropped(jobId: string): Promise<IpcResult<ReadonlyArray<ImportOutcome>>> {
  return call("media_import_dropped", z.array(ImportOutcomeSchema), { jobId });
}

/** Waveform peaks, 50 per second, 0–255. */
export function audioPeaks(path: string): Promise<IpcResult<ReadonlyArray<number>>> {
  return call("audio_peaks", z.array(z.number().int().min(0).max(255)), { path });
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

export function ttsWordBoundaries(sha256s: ReadonlyArray<string>): Promise<IpcResult<Readonly<Record<string, ReadonlyArray<WordBoundary>>>>> {
  return call("tts_word_boundaries", z.record(z.string(), z.array(WordBoundarySchema)), { sha256s });
}

// ---------------------------------------------------------------------------
// Export (output path comes from a save dialog opened by Rust)
// ---------------------------------------------------------------------------

export interface ExportRequest {
  readonly manifestJson: string;
  readonly title: string;
  readonly preset: PresetId;
  readonly codec: Codec;
  readonly overlayAss: string | null;
  readonly srt: string | null;
}

/** `null` value = the user cancelled the save dialog. */
export function exportStart(jobId: string, request: ExportRequest): Promise<IpcResult<string | null>> {
  return call("export_start", z.string().nullable(), { jobId, request });
}

export function exportCancel(jobId: string): Promise<IpcResult<boolean>> {
  return call("export_cancel", z.boolean(), { jobId });
}
