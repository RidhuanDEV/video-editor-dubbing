/**
 * Scene narration synthesis. Results are attached without an undo step (03 §5.4) and only if
 * the scene's text and voice are unchanged since the request started.
 */
import { create } from "zustand";
import { ttsSynthesize } from "../lib/ipc";
import { requestEdgeConsent } from "../lib/settings";
import { invalidateVoices } from "../lib/voices";
import { newJobId } from "../lib/jobs";
import { notify } from "../lib/notices";
import type { AppError, ScriptScene, VoiceConfig } from "../types";
import { effectiveVoice } from "./commands";
import { useProjectStore } from "./store";

export type SynthesisStatus = { readonly state: "loading" } | { readonly state: "error"; readonly error: AppError };

interface SynthesisStore {
  readonly byScene: ReadonlyMap<string, SynthesisStatus>;
  /** "Synthesize all" progress, shown in the status bar; null when no batch runs. */
  readonly batch: { readonly done: number; readonly total: number } | null;
}

export const useSynthesis = create<SynthesisStore>()(() => ({ byScene: new Map(), batch: null }));

function setStatus(sceneId: string, status: SynthesisStatus | null): void {
  useSynthesis.setState((state) => {
    const next = new Map(state.byScene);
    if (status === null) next.delete(sceneId);
    else next.set(sceneId, status);
    return { byScene: next };
  });
}

function signature(scene: ScriptScene, voice: VoiceConfig): string {
  return JSON.stringify([scene.narration, voice.engine, voice.voiceId, voice.rate, voice.pitch, voice.volume]);
}

export async function synthesizeScene(sceneId: string): Promise<boolean> {
  const project = useProjectStore.getState().project;
  const scene = project?.manifest.scenes.find((s) => s.id === sceneId);
  if (!project || !scene || project.readOnly) return false;
  if (scene.narration.trim() === "") {
    setStatus(sceneId, { state: "error", error: { kind: "invalidRequest", message: "Naskah scene masih kosong." } });
    return false;
  }

  const voice = effectiveVoice(project.manifest, scene);
  const requested = signature(scene, voice);
  setStatus(sceneId, { state: "loading" });
  const request = { text: scene.narration, voiceId: voice.voiceId, rate: voice.rate, pitch: voice.pitch, volume: voice.volume };
  let result = await ttsSynthesize(newJobId(), voice.engine, request);
  // Edge-TTS needs explicit consent once (ADR D6): ask, then retry a single time.
  if (!result.ok && result.error.kind === "consentRequired") {
    if (await requestEdgeConsent()) {
      invalidateVoices("edge-tts");
      result = await ttsSynthesize(newJobId(), voice.engine, request);
    }
  }

  if (!result.ok) {
    setStatus(sceneId, { state: "error", error: result.error });
    return false;
  }
  setStatus(sceneId, null);

  const latest = useProjectStore.getState().project;
  const current = latest?.manifest.scenes.find((s) => s.id === sceneId);
  if (!latest || latest.root !== project.root || !current || signature(current, effectiveVoice(latest.manifest, current)) !== requested) {
    return false; // Edited (or project switched) while synthesizing: the audio no longer matches.
  }
  useProjectStore.getState().setSceneAudio(sceneId, {
    audioDurationMs: Math.max(1, result.value.durationMs),
    audioCachePath: `cache/tts/${result.value.sha256}.mp3`,
    audioSha256: result.value.sha256,
  });
  return true;
}

/** Scenes with text but no audio yet. */
export function pendingSceneIds(scenes: ReadonlyArray<ScriptScene>): ReadonlyArray<string> {
  return scenes.filter((s) => s.audioDurationMs === undefined && s.narration.trim() !== "").map((s) => s.id);
}

/**
 * Synthesizes every scene still without audio, in the background with status-bar progress.
 * Sequential on purpose: one WebSocket at a time is kinder to an unofficial service.
 */
export async function synthesizeAll(): Promise<void> {
  if (useSynthesis.getState().batch !== null) return;
  const pending = pendingSceneIds(useProjectStore.getState().project?.manifest.scenes ?? []);
  if (pending.length === 0) return;
  let succeeded = 0;
  for (const [index, sceneId] of pending.entries()) {
    useSynthesis.setState({ batch: { done: index, total: pending.length } });
    if (await synthesizeScene(sceneId)) succeeded += 1;
  }
  useSynthesis.setState({ batch: null });
  if (succeeded === pending.length) notify("success", `${succeeded} narasi selesai disintesis.`);
  else notify("warning", `${succeeded} dari ${pending.length} narasi berhasil. Lihat scene bertanda gagal.`, { label: "Coba lagi", run: () => void synthesizeAll() });
}
