/**
 * The running export (05 §4–5, 08 §8). Lives outside the export dialog so the dialog can be
 * closed while rendering: progress moves to the status bar and Cancel stays reachable.
 */
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { create } from "zustand";
import { exportCancel, exportStart, type ExportRequest } from "../lib/ipc";
import { newJobId } from "../lib/jobs";
import { notify } from "../lib/notices";
import { RENDER_PROGRESS_EVENT, RenderProgressSchema, type AppError, type RenderProgress } from "../types";

export type ExportState =
  | { readonly state: "idle" }
  | { readonly state: "running"; readonly jobId: string; readonly progress: RenderProgress | null }
  | { readonly state: "done"; readonly path: string }
  | { readonly state: "error"; readonly error: AppError };

export const useExportJob = create<{ readonly job: ExportState }>()(() => ({ job: { state: "idle" } }));

function isExportRunning(): boolean {
  return useExportJob.getState().job.state === "running";
}

export async function startExport(request: ExportRequest): Promise<void> {
  if (isExportRunning()) return;
  const jobId = newJobId();
  useExportJob.setState({ job: { state: "running", jobId, progress: null } });
  const result = await exportStart(jobId, request);
  if (!result.ok) {
    if (result.error.kind === "cancelled") {
      useExportJob.setState({ job: { state: "idle" } });
      notify("info", "Ekspor dibatalkan. Tidak ada file setengah jadi yang tersisa.");
    } else {
      useExportJob.setState({ job: { state: "error", error: result.error } });
      notify("error", `Ekspor gagal: ${result.error.message}`);
    }
    return;
  }
  if (result.value === null) {
    useExportJob.setState({ job: { state: "idle" } }); // save dialog cancelled
    return;
  }
  useExportJob.setState({ job: { state: "done", path: result.value } });
  notify("success", `Ekspor selesai: ${result.value}`);
}

export function cancelExport(): void {
  const { job } = useExportJob.getState();
  if (job.state === "running") void exportCancel(job.jobId);
}

/** Back to the form after a finished or failed export. */
export function resetExport(): void {
  if (!isExportRunning()) useExportJob.setState({ job: { state: "idle" } });
}

/** Mount once (App): routes render progress events to the running job. */
export function useExportProgress(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    listen(RENDER_PROGRESS_EVENT, (event) => {
      const parsed = RenderProgressSchema.safeParse(event.payload);
      if (!active || !parsed.success) return;
      const { job } = useExportJob.getState();
      if (job.state === "running" && job.jobId === parsed.data.jobId) useExportJob.setState({ job: { ...job, progress: parsed.data } });
    })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch((error: Error) => console.warn("render progress listener failed", error.message));
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "menghitung…";
  const s = Math.max(0, Math.round(seconds));
  return s >= 60 ? `${Math.floor(s / 60)} m ${s % 60} d` : `${s} dtk`;
}
