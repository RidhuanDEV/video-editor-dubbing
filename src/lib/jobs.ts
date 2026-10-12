import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { JOB_EVENT, JobEventSchema } from "../types";

/** Client-generated job id; Rust only accepts canonical UUIDs. */
export function newJobId(): string {
  return crypto.randomUUID();
}

/**
 * Latest progress message for one job, or null. Events are best-effort feedback; the command's
 * own result stays the source of truth for success or failure.
 */
export function useJobProgress(jobId: string | null): string | null {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setMessage(null);
    if (jobId === null || !isTauri()) return;

    let active = true;
    let unlisten: (() => void) | null = null;
    listen(JOB_EVENT, (event) => {
      const parsed = JobEventSchema.safeParse(event.payload);
      if (active && parsed.success && parsed.data.jobId === jobId && parsed.data.status === "progress") {
        setMessage(parsed.data.message);
      }
    })
      .then((stop) => {
        // The effect may have been cleaned up before the listener was registered.
        if (active) unlisten = stop;
        else stop();
      })
      .catch((error: Error) => console.warn("job listener failed", error.message));

    return () => {
      active = false;
      unlisten?.();
    };
  }, [jobId]);

  return message;
}
