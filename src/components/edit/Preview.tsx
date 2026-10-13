/**
 * Preview (ADR D1 baseline): `<video>` plays the 540p proxy of the scene under the playhead,
 * narration and BGM play through `<audio>` elements. Ducking and loudness here are an
 * approximation; the export (FFmpeg) is the reference (01 §5).
 */
import { Loader2, Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { formatTimecode, projectFileUrl } from "../../lib/format";
import { activeEffects, contentRect } from "../../project/effects";
import { useEditor } from "../../project/editor";
import { requestProxyRebuild, useProxies } from "../../project/proxies";
import { useSessionUi } from "../../project/session";
import { cueAt, type Cue } from "../../project/subtitles";
import { audibleTracks, segmentAt, videoPositionAt, type TimelineLayout } from "../../project/timeline";
import type { AudioTrackConfig, BlurEffect, MediaAsset, ProjectManifest, SceneEffect, ZoomEffect } from "../../types";
import { IconButton, StatusText } from "../ui";
import { BlurOverlays, ScreenOverlays, SubtitleOverlay, zoomStyle } from "./EffectLayers";

/** Re-seek a playing element only past this drift; smaller corrections cause audible stutter. */
const PLAYING_DRIFT_S = 0.25;
const PAUSED_DRIFT_S = 0.03;

function syncElement(element: HTMLMediaElement | null, targetS: number, active: boolean, rate: number): void {
  if (!element || element.readyState === HTMLMediaElement.HAVE_NOTHING) return;
  if (element.playbackRate !== rate) element.playbackRate = rate;
  if (active) {
    if (Math.abs(element.currentTime - targetS) > PLAYING_DRIFT_S && !element.seeking) element.currentTime = targetS;
    if (element.paused) void element.play().catch(() => undefined);
  } else {
    if (!element.paused) element.pause();
    if (Math.abs(element.currentTime - targetS) > PAUSED_DRIFT_S && !element.seeking) element.currentTime = targetS;
  }
}

function proxyUrl(root: string, asset: MediaAsset | undefined): string | null {
  return asset?.proxyPath ? projectFileUrl(root, asset.proxyPath) : null;
}

/** Drives the playhead while playing; stops at the end of the timeline. */
function usePlaybackClock(durationMs: number): void {
  const playing = useEditor((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const { playheadMs, seek, setPlaying } = useEditor.getState();
      const next = playheadMs + (now - last);
      last = now;
      if (next >= durationMs) {
        seek(durationMs, durationMs);
        setPlaying(false);
        return;
      }
      seek(next, durationMs);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, durationMs]);
}

function BgmPlayer({ root, track, asset, playheadMs, playing, audible, ducked }: {
  readonly root: string;
  readonly track: AudioTrackConfig;
  readonly asset: MediaAsset | undefined;
  readonly playheadMs: number;
  readonly playing: boolean;
  readonly audible: boolean;
  readonly ducked: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const src = proxyUrl(root, asset);
  const offsetMs = playheadMs - track.startOffsetMs;
  const inside = offsetMs >= 0 && offsetMs < track.durationMs;
  useEffect(() => {
    const element = ref.current;
    if (element) element.volume = track.autoDuck && ducked ? Math.min(track.volume, track.duckVolume) : track.volume;
    syncElement(element, Math.max(0, offsetMs) / 1000, playing && audible && inside, 1);
  });
  return src ? <audio ref={ref} src={src} preload="auto" /> : null;
}

interface PreviewProps {
  readonly manifest: ProjectManifest;
  readonly root: string;
  readonly layout: TimelineLayout;
  readonly cues: ReadonlyArray<Cue>;
  /** Efek page: no zoom transform, so gizmos are drawn on the untouched frame. */
  readonly editMode?: boolean;
  /** Interactive overlay positioned over the canvas box. */
  readonly gizmo?: ReactNode;
}

function isZoom(effect: SceneEffect): effect is ZoomEffect {
  return effect.type === "zoom";
}

function isBlur(effect: SceneEffect): effect is BlurEffect {
  return effect.type === "blur";
}

export function Preview({ manifest, root, layout, cues, editMode = false, gizmo }: PreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const narrationRef = useRef<HTMLAudioElement>(null);
  const playheadMs = useEditor((s) => s.playheadMs);
  const playing = useEditor((s) => s.playing);
  const proxies = useProxies((s) => s.byAsset);
  const missing = useSessionUi((s) => s.missingAssetIds);
  usePlaybackClock(layout.durationMs);

  const position = videoPositionAt(layout, playheadMs);
  const scene = position?.segment.scene;
  const asset = scene ? manifest.assets.find((a) => a.id === scene.videoClipId) : undefined;
  const videoSrc = proxyUrl(root, asset);
  const audible = audibleTracks(manifest.tracks);

  const narrationSegment = segmentAt(layout, playheadMs);
  const narrationOffsetMs = narrationSegment ? playheadMs - narrationSegment.startMs : 0;
  const narrationActive = narrationSegment !== null && narrationOffsetMs < narrationSegment.audioEndMs - narrationSegment.startMs;
  const narrationSrc = narrationSegment?.scene.audioCachePath ? projectFileUrl(root, narrationSegment.scene.audioCachePath) : null;

  useEffect(() => {
    if (!position || !scene) return;
    syncElement(videoRef.current, position.sourceMs / 1000, playing && !position.frozen, scene.playbackRate);
  });

  useEffect(() => {
    syncElement(narrationRef.current, Math.max(0, narrationOffsetMs) / 1000, playing && narrationActive && audible.has("narration"), 1);
  });

  const step = (deltaMs: number): void => {
    const { seek, setPlaying } = useEditor.getState();
    setPlaying(false);
    seek(playheadMs + deltaMs, layout.durationMs);
  };
  const frameMs = 1000 / manifest.canvas.fps;
  const proxyStatus = asset ? proxies.get(asset.id) : undefined;
  const overlay = (() => {
    if (!scene) return "Belum ada scene. Tambahkan scene di halaman Naskah.";
    if (!asset) return "Klip scene ini tidak ada di media pool.";
    if (missing.has(asset.id)) return "File sumber tidak ditemukan. Hubungkan ulang di halaman Media.";
    if (proxyStatus?.state === "error") return `Proxy gagal dibuat: ${proxyStatus.message}`;
    if (!videoSrc) return proxyStatus?.state === "building" ? `Membuat proxy preview… ${proxyStatus.percent}%` : "Menyiapkan proxy preview…";
    return null;
  })();

  const { width, height, background, fit } = manifest.canvas;
  const sceneOffsetMs = narrationSegment ? playheadMs - narrationSegment.startMs : 0;
  const effects = scene ? activeEffects(scene.effects, sceneOffsetMs) : [];
  const elapsedOf = (effect: SceneEffect): number => sceneOffsetMs - effect.startOffsetMs;
  const sourceW = asset?.width ?? width;
  const sourceH = asset?.height ?? height;
  const content = contentRect(manifest.canvas, sourceW, sourceH, fit);
  const zoom = effects.find(isZoom);
  const contentStyle = editMode ? undefined : zoomStyle(zoom, zoom ? elapsedOf(zoom) : 0, content);
  const subtitle = manifest.subtitleSettings.enabled ? cueAt(cues, playheadMs) : null;
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-app p-4">
      <div className="relative flex max-h-full w-full min-h-0 flex-1 items-center justify-center">
        <div
          className="relative max-h-full max-w-full overflow-hidden rounded-sm border border-line-subtle"
          style={{ aspectRatio: `${width} / ${height}`, background, height: "100%", containerType: "size" }}
        >
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 will-change-transform" style={contentStyle}>
              {videoSrc && (
                <video
                  ref={videoRef}
                  src={videoSrc}
                  muted
                  playsInline
                  preload="auto"
                  className="absolute inset-0 h-full w-full"
                  style={{ objectFit: fit }}
                  onError={() => asset && requestProxyRebuild(asset.id)}
                />
              )}
              <BlurOverlays effects={effects.filter(isBlur)} content={content} sourceW={sourceW} sourceH={sourceH} canvas={manifest.canvas} />
            </div>
            <ScreenOverlays effects={effects} elapsedOf={elapsedOf} content={content} canvas={manifest.canvas} />
            {subtitle && <SubtitleOverlay cue={subtitle.cue} activeWord={subtitle.activeWord} settings={manifest.subtitleSettings} canvas={manifest.canvas} />}
          </div>
          {overlay && (
            <div className="absolute inset-0 flex items-center justify-center bg-timeline/80 p-6 text-center text-[13px] text-fg">
              {proxyStatus?.state === "building" ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" aria-hidden /> {overlay}
                </span>
              ) : proxyStatus?.state === "error" || (asset && missing.has(asset.id)) ? (
                <StatusText tone="danger">{overlay}</StatusText>
              ) : (
                overlay
              )}
            </div>
          )}
          {position?.frozen && !overlay && (
            <span className="absolute top-2 left-2 rounded-sm bg-black/60 px-1.5 py-0.5 text-[12px] text-white">Freeze</span>
          )}
          {gizmo}
        </div>
      </div>

      {narrationSrc && <audio ref={narrationRef} src={narrationSrc} preload="auto" />}
      {manifest.bgmTracks.map((track) => (
        <BgmPlayer
          key={track.id}
          root={root}
          track={track}
          asset={manifest.assets.find((a) => a.filePath === track.filePath && a.kind === "audio")}
          playheadMs={playheadMs}
          playing={playing}
          audible={audible.has("bgm")}
          ducked={narrationActive && audible.has("narration")}
        />
      ))}

      <div className="flex items-center gap-1" role="group" aria-label="Kontrol pemutaran">
        <IconButton icon={SkipBack} label="Ke awal (Home)" onClick={() => step(-playheadMs)} />
        <IconButton icon={StepBack} label="Mundur 1 frame (←)" onClick={() => step(-frameMs)} />
        <IconButton
          icon={playing ? Pause : Play}
          label={playing ? "Jeda (Spasi)" : "Putar (Spasi)"}
          onClick={() => useEditor.getState().setPlaying(!playing && layout.durationMs > 0)}
        />
        <IconButton icon={StepForward} label="Maju 1 frame (→)" onClick={() => step(frameMs)} />
        <IconButton icon={SkipForward} label="Ke akhir (End)" onClick={() => step(layout.durationMs - playheadMs)} />
        <span className="ml-3 font-mono text-[13px] tabular">
          {formatTimecode(playheadMs)} <span className="text-fg-2">/ {formatTimecode(layout.durationMs)}</span>
        </span>
      </div>
    </div>
  );
}
