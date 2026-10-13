/**
 * Scene narration synthesis. Results are attached without an undo step (03 §5.4) and only if
 * the scene's text and voice are unchanged since the request started.
 */
import { create } from "zustand";
import { ttsSynthesize } from "../lib/ipc";
import { requestEdgeConsent } from "../lib/settings";
import { invalidateVoices } from "../lib/voices";
import { newJobId } from "../lib/jobs";
import type { AppError, ScriptScene, VoiceConfig } from "../types";
import { effectiveVoice } from "./commands";
import { useProjectStore } from "./store";

export type SynthesisStatus = { readonly state: "loading" } | { readonly state: "error"; readonly error: AppError };

interface SynthesisStore {
  readonly byScene: ReadonlyMap<string, SynthesisStatus>;
}

export const useSynthesis = create<SynthesisStore>()(() => ({ byScene: new Map() }));

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

/** Sequential on purpose: one WebSocket at a time is kinder to an unofficial service. */
export async function synthesizeMissing(onProgress: (done: number, total: number) => void): Promise<number> {
  const scenes = useProjectStore.getState().project?.manifest.scenes ?? [];
  const pending = scenes.filter((s) => s.audioDurationMs === undefined && s.narration.trim() !== "").map((s) => s.id);
  let succeeded = 0;
  for (const [index, sceneId] of pending.entries()) {
    onProgress(index, pending.length);
    if (await synthesizeScene(sceneId)) succeeded += 1;
  }
  onProgress(pending.length, pending.length);
  return succeeded;
}
