/**
 * Phase 0/1 engine diagnostics: FFmpeg resolver + real-encode encoder detection, and the
 * native Edge-TTS spike (WebSocket, SHA-256 cache, WordBoundary).
 */
import { AudioLines, Cpu, SearchCheck } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { checkDependencies, detectEncoder, ttsSynthesize, type IpcResult } from "../lib/ipc";
import { newJobId, useJobProgress } from "../lib/jobs";
import {
  TtsSynthesizeRequestSchema,
  type AppError,
  type BinarySource,
  type DependencyReport,
  type EncoderDetection,
  type FfmpegLicense,
  type ToolStatus,
  type TtsResult,
  type VideoEncoderId,
} from "../types";
import { Button, Card, Field, INPUT_CLASS, StatusText } from "./ui";

type Remote<T> =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "done"; readonly value: T }
  | { readonly state: "error"; readonly error: AppError };

function toRemote<T>(result: IpcResult<T>): Remote<T> {
  return result.ok ? { state: "done", value: result.value } : { state: "error", error: result.error };
}

const ERROR_HINT: Readonly<Record<AppError["kind"], string>> = {
  network: "Periksa koneksi internet, lalu coba lagi.",
  blocked: "Layanan menolak permintaan (mungkin diblokir atau jam sistem tidak sinkron). Coba lagi nanti atau ganti engine.",
  timeout: "Layanan tidak merespons tepat waktu. Coba lagi.",
  protocol: "Respons tidak dikenali. Kemungkinan protokol layanan berubah.",
  invalidRequest: "Periksa isian lalu coba lagi.",
  io: "Gagal membaca/menulis file. Periksa izin folder.",
  binaryNotFound: "Atur path FFmpeg kustom atau pasang FFmpeg.",
  process: "Proses eksternal gagal. Lihat pesan di bawah.",
  cancelled: "Proses dibatalkan.",
};

function ErrorBox({ error }: { readonly error: AppError }) {
  return (
    <div role="alert" className="space-y-1 rounded-md border border-danger bg-surface p-3 text-[13px]">
      <StatusText tone="danger">{ERROR_HINT[error.kind]}</StatusText>
      <p className="font-mono text-[12px] break-all text-fg-2">{error.message}</p>
    </div>
  );
}

const LICENSE_TONE: Readonly<Record<FfmpegLicense, { readonly tone: "success" | "warning"; readonly text: string }>> = {
  lgpl: { tone: "success", text: "LGPL" },
  gpl: { tone: "warning", text: "GPL (bukan build yang dibundle)" },
  nonfree: { tone: "warning", text: "nonfree (tidak boleh didistribusikan)" },
  undetected: { tone: "warning", text: "lisensi tidak terdeteksi" },
};

const SOURCE_LABEL: Readonly<Record<BinarySource, string>> = { custom: "path kustom", bundled: "dibundle", system: "PATH sistem" };

function ToolRow({ name, status }: { readonly name: string; readonly status: ToolStatus }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 border-b border-line-subtle py-2 last:border-b-0">
      <span className="font-mono text-[13px]">{name}</span>
      {status.status === "found" ? (
        <div className="min-w-0 space-y-1">
          <StatusText tone="success">Ditemukan ({SOURCE_LABEL[status.source]})</StatusText>
          <p className="truncate font-mono text-[12px] text-fg-2" title={status.path}>
            {status.path}
          </p>
          <p className="text-[12px] text-fg-2">{status.version}</p>
          <StatusText tone={LICENSE_TONE[status.license].tone}>{LICENSE_TONE[status.license].text}</StatusText>
        </div>
      ) : (
        <StatusText tone="danger">{status.reason}</StatusText>
      )}
    </div>
  );
}

function EncoderTable({ detection }: { readonly detection: EncoderDetection }) {
  return (
    <div className="space-y-3">
      {detection.selected ? (
        <StatusText tone={detection.selected === "libopenh264" ? "warning" : "success"}>
          Encoder terpilih: <span className="font-mono">{detection.selected}</span>
          {detection.selected === "libopenh264" && " — encoder software dengan kualitas dasar. Untuk kualitas lebih tinggi gunakan GPU atau FFmpeg milik sendiri."}
        </StatusText>
      ) : (
        <StatusText tone="danger">Tidak ada encoder H.264 yang lolos uji. Atur path FFmpeg kustom.</StatusText>
      )}
      <table className="w-full text-left text-[13px]">
        <thead className="text-[12px] text-fg-2">
          <tr className="border-b border-line-subtle">
            <th className="py-1.5 font-medium">Encoder</th>
            <th className="py-1.5 font-medium">Jenis</th>
            <th className="py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {detection.candidates.map((c) => (
            <tr key={c.encoder} className="border-b border-line-subtle last:border-b-0 align-top">
              <td className="py-1.5 font-mono">{c.encoder}</td>
              <td className="py-1.5 text-fg-2">{c.hardware ? "GPU" : "CPU"}</td>
              <td className="py-1.5">
                {c.testPassed ? (
                  <StatusText tone="success">Lolos uji encode</StatusText>
                ) : c.listed ? (
                  <StatusText tone="warning">Terdaftar, uji gagal{c.error ? `: ${c.error}` : ""}</StatusText>
                ) : (
                  <span className="text-fg-muted">Tidak ada di build ini</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FfmpegCard({ onEncoderDetected }: { readonly onEncoderDetected: (encoder: VideoEncoderId | null) => void }) {
  const pathId = useId();
  const [customPath, setCustomPath] = useState("");
  const [deps, setDeps] = useState<Remote<DependencyReport>>({ state: "idle" });
  const [encoders, setEncoders] = useState<Remote<EncoderDetection>>({ state: "idle" });
  const [detectJobId, setDetectJobId] = useState<string | null>(null);
  const detectProgress = useJobProgress(detectJobId);
  const custom = customPath.trim() === "" ? null : customPath.trim();

  const runCheck = async (): Promise<void> => {
    setDeps({ state: "loading" });
    setDeps(toRemote(await checkDependencies(custom)));
  };

  const runDetect = async (): Promise<void> => {
    const jobId = newJobId();
    setDetectJobId(jobId);
    setEncoders({ state: "loading" });
    const result = await detectEncoder(jobId, custom);
    setEncoders(toRemote(result));
    if (result.ok) onEncoderDetected(result.value.selected);
  };

  return (
    <Card title="FFmpeg (sidecar LGPL)">
      <Field id={pathId} label="Path FFmpeg kustom (opsional)" hint="Urutan resolver: path kustom → biner yang dibundle → PATH sistem.">
        <input
          id={pathId}
          className={`${INPUT_CLASS} font-mono`}
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
          placeholder="C:\ffmpeg\bin\ffmpeg.exe"
          spellCheck={false}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button icon={SearchCheck} loading={deps.state === "loading"} onClick={() => void runCheck()}>
          Periksa dependensi
        </Button>
        <Button icon={Cpu} loading={encoders.state === "loading"} onClick={() => void runDetect()}>
          Deteksi encoder
        </Button>
      </div>
      {deps.state === "done" && (
        <div>
          <ToolRow name="ffmpeg" status={deps.value.ffmpeg} />
          <ToolRow name="ffprobe" status={deps.value.ffprobe} />
        </div>
      )}
      {deps.state === "error" && <ErrorBox error={deps.error} />}
      {encoders.state === "loading" && (
        <p aria-live="polite" className="text-[12px] text-fg-2">
          {detectProgress ?? "Membaca daftar encoder…"}
        </p>
      )}
      {encoders.state === "done" && <EncoderTable detection={encoders.value} />}
      {encoders.state === "error" && <ErrorBox error={encoders.error} />}
    </Card>
  );
}

const DEFAULT_TEXT = "Selamat datang di tutorial aplikasi SUMBA. Pada video ini kita akan membuat manifest baru.";

function TtsCard() {
  const ids = { text: useId(), voice: useId(), rate: useId(), pitch: useId() };
  const [text, setText] = useState(DEFAULT_TEXT);
  const [voiceId, setVoiceId] = useState("id-ID-GadisNeural");
  const [rate, setRate] = useState("+0%");
  const [pitch, setPitch] = useState("+0Hz");
  const [result, setResult] = useState<Remote<TtsResult>>({ state: "idle" });

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const request = TtsSynthesizeRequestSchema.safeParse({ text: text.trim(), voiceId: voiceId.trim(), rate, pitch, volume: "+0%" });
    if (!request.success) {
      setResult({ state: "error", error: { kind: "invalidRequest", message: request.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } });
      return;
    }
    setResult({ state: "loading" });
    setResult(toRemote(await ttsSynthesize(newJobId(), request.data)));
  };

  return (
    <Card title="Edge-TTS native (spike)">
      <StatusText tone="warning">Edge-TTS adalah layanan tidak resmi: dapat berubah atau diblokir kapan saja.</StatusText>
      <form className="space-y-3" onSubmit={(e) => void submit(e)}>
        <Field id={ids.text} label="Naskah" hint={`${text.length} karakter`}>
          <textarea
            id={ids.text}
            className={`${INPUT_CLASS} h-24 resize-y py-2 text-[14px] leading-[22px]`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
          <Field id={ids.voice} label="Suara">
            <input id={ids.voice} className={`${INPUT_CLASS} font-mono`} value={voiceId} onChange={(e) => setVoiceId(e.target.value)} spellCheck={false} />
          </Field>
          <Field id={ids.rate} label="Rate">
            <input id={ids.rate} className={`${INPUT_CLASS} font-mono`} value={rate} onChange={(e) => setRate(e.target.value)} spellCheck={false} />
          </Field>
          <Field id={ids.pitch} label="Pitch">
            <input id={ids.pitch} className={`${INPUT_CLASS} font-mono`} value={pitch} onChange={(e) => setPitch(e.target.value)} spellCheck={false} />
          </Field>
        </div>
        <Button type="submit" variant="primary" icon={AudioLines} loading={result.state === "loading"}>
          Sintesis suara
        </Button>
      </form>

      <div aria-live="polite">
        {result.state === "error" && <ErrorBox error={result.error} />}
        {result.state === "done" && (
          <div className="space-y-2 text-[13px]">
            <StatusText tone="success">
              Selesai{result.value.cached ? " (dari cache)" : ""} — durasi{" "}
              <span className="font-mono tabular">{(result.value.durationMs / 1000).toFixed(2)} dtk</span>,{" "}
              {result.value.wordBoundaries.length} kata
            </StatusText>
            <p className="truncate font-mono text-[12px] text-fg-2" title={result.value.audioPath}>
              {result.value.audioPath}
            </p>
            <p className="font-mono text-[12px] text-fg-muted">
              job {result.value.jobId} · sha256 {result.value.sha256.slice(0, 16)}…
            </p>
            <ol className="flex flex-wrap gap-1.5" aria-label="Word boundary">
              {result.value.wordBoundaries.map((w, index) => (
                <li key={`${index}-${w.startMs}`} className="rounded-sm bg-accent-subtle px-1.5 py-0.5 text-[12px]">
                  {w.text} <span className="font-mono tabular text-fg-2">{w.startMs}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Card>
  );
}

export function EngineView({ onEncoderDetected }: { readonly onEncoderDetected: (encoder: VideoEncoderId | null) => void }) {
  return (
    <div className="mx-auto grid max-w-[1200px] gap-4 p-4 lg:grid-cols-2">
      <FfmpegCard onEncoderDetected={onEncoderDetected} />
      <TtsCard />
    </div>
  );
}
