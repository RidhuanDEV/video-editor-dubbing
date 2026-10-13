import { convertFileSrc } from "@tauri-apps/api/core";

/** `83450` → `1:23.4`; hours appear only when needed. */
export function formatTimecode(ms: number): string {
  const totalTenths = Math.round(ms / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const mmss = `${hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
  return mmss;
}

/** URL for a file inside the open project, served by Tauri's asset protocol (scoped to the project). */
export function projectFileUrl(root: string, relativePath: string): string {
  return convertFileSrc(`${root}/${relativePath}`);
}
