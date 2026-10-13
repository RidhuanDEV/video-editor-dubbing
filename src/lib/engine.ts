/**
 * Encoder detection state (PRD 10 W6): detected automatically once per launch so the status bar
 * never says "not detected"; Settings can re-run it. Rust caches the result for proxies/export.
 */
import { isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { create } from "zustand";
import type { AppError, EncoderReport } from "../types";
import { detectEncoder } from "./ipc";
import { newJobId } from "./jobs";

export type EncoderState =
  | { readonly state: "idle" }
  | { readonly state: "detecting"; readonly jobId: string }
  | { readonly state: "done"; readonly report: EncoderReport }
  | { readonly state: "error"; readonly error: AppError };

export const useEngine = create<{ readonly encoders: EncoderState }>()(() => ({ encoders: { state: "idle" } }));

export async function redetectEncoders(): Promise<void> {
  if (useEngine.getState().encoders.state === "detecting") return;
  const jobId = newJobId();
  useEngine.setState({ encoders: { state: "detecting", jobId } });
  const result = await detectEncoder(jobId);
  useEngine.setState({ encoders: result.ok ? { state: "done", report: result.value } : { state: "error", error: result.error } });
}

/** Mount once (App). */
export function useEncoderAutoDetect(): void {
  useEffect(() => {
    if (isTauri()) void redetectEncoders();
  }, []);
}
