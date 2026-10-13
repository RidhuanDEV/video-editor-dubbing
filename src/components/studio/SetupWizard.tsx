/**
 * Guided setup after "Proyek baru" (PRD 10 §4.3): step 1 (title, aspect, folder) happened on the
 * start screen; here come 2 (recordings) and 3 (script & voice). Every step can be skipped.
 */
import { Check, Film, Import } from "lucide-react";
import { useId, useState } from "react";
import { formatTimecode } from "../../lib/format";
import { setDefaultVoice } from "../../project/commands";
import { fileNameOf } from "../../project/manifest";
import { importMedia, useMediaJobs } from "../../project/mediaActions";
import { useProjectStore } from "../../project/store";
import { synthesizeAll } from "../../project/synthesis";
import { useWorkspace } from "../../project/workspace";
import { autoChunk } from "../../project/chunk";
import type { ProjectManifest } from "../../types";
import { Dialog } from "../Dialog";
import { Button, Checkbox } from "../ui";
import { VoiceFields } from "./fields";
import { createScenesFromScript, PasteScriptFields } from "./ScriptDialogs";

type Step = "media" | "script";

const STEPS: ReadonlyArray<{ readonly id: Step | "project"; readonly label: string }> = [
  { id: "project", label: "Proyek" },
  { id: "media", label: "Rekaman" },
  { id: "script", label: "Naskah & suara" },
];

function Stepper({ step }: { readonly step: Step }) {
  const current = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="mb-4 flex items-center gap-2" aria-label="Langkah">
      {STEPS.map((s, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={s.id} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={`inline-flex size-6 items-center justify-center rounded-full text-caption font-semibold ${
                done ? "bg-accent text-on-accent" : active ? "border-2 border-accent text-accent" : "border border-line text-fg-muted"
              }`}
            >
              {done ? <Check size={12} strokeWidth={3} aria-hidden /> : index + 1}
            </span>
            <span className={`text-ui ${active ? "font-semibold" : "text-fg-2"}`}>{s.label}</span>
            {index < STEPS.length - 1 && <span className="mx-1 h-px w-8 bg-line" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

export function SetupWizard({ manifest }: { readonly manifest: ProjectManifest }) {
  const idPrefix = useId();
  const open = useWorkspace((s) => s.dialog === "wizard");
  const close = useWorkspace((s) => s.closeDialog);
  const execute = useProjectStore((s) => s.execute);
  const importing = useMediaJobs((s) => s.running?.kind === "import");
  const [step, setStep] = useState<Step>("media");
  const [script, setScript] = useState("");
  const [assetId, setAssetId] = useState("");
  const [synthesize, setSynthesize] = useState(true);
  const videos = manifest.assets.filter((a) => a.kind === "video");
  const chunks = autoChunk(script);

  const finish = (): void => {
    const created = createScenesFromScript(script, assetId);
    close();
    setStep("media");
    setScript("");
    if (created > 0 && synthesize) void synthesizeAll();
  };

  const actions =
    step === "media" ? (
      <>
        <Button onClick={close}>Lewati panduan</Button>
        <Button variant="primary" onClick={() => setStep("script")}>
          {videos.length > 0 ? "Lanjut" : "Lanjut tanpa rekaman"}
        </Button>
      </>
    ) : (
      <>
        <Button onClick={() => setStep("media")}>Kembali</Button>
        <Button variant="primary" onClick={finish} disabled={videos.length > 0 && chunks.length === 0 && script.trim() !== ""}>
          {chunks.length > 0 && videos.length > 0 ? `Buat ${chunks.length} scene` : "Selesai"}
        </Button>
      </>
    );

  return (
    <Dialog open={open} title="Siapkan proyek" width="lg" onClose={close} actions={actions}>
      <Stepper step={step} />
      {step === "media" ? (
        <div className="space-y-3">
          <p>Impor rekaman layar yang ingin dijelaskan. Anda juga bisa menyeret file ke jendela aplikasi kapan saja.</p>
          <button
            type="button"
            disabled={importing}
            onClick={() => void importMedia("dialog")}
            className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line bg-surface px-6 py-8 text-center transition-colors duration-150 hover:border-accent hover:bg-hover disabled:cursor-wait"
          >
            <Import size={28} strokeWidth={1.5} className="text-accent" aria-hidden />
            <span className="text-body font-medium">{importing ? "Mengimpor…" : "Pilih rekaman video…"}</span>
            <span className="text-caption text-fg-2">MP4, MOV, MKV, WEBM · file tidak disalin, jangan dihapus dari lokasinya</span>
          </button>
          {videos.length > 0 && (
            <ul className="space-y-1" aria-label="Rekaman diimpor">
              {videos.map((v) => (
                <li key={v.id} className="flex items-center gap-2 rounded-sm bg-surface px-2 py-1.5 text-ui">
                  <Film size={14} className="text-fg-2" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{fileNameOf(v.filePath)}</span>
                  {v.durationMs !== undefined && <span className="font-mono text-caption tabular text-fg-2">{formatTimecode(v.durationMs)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {videos.length > 0 ? (
            <PasteScriptFields manifest={manifest} script={script} onScript={setScript} assetId={assetId} onAsset={setAssetId} idPrefix={idPrefix} />
          ) : (
            <p className="text-fg-2">Tanpa rekaman, naskah bisa ditempel nanti dari panel Naskah setelah video diimpor.</p>
          )}
          <section className="space-y-2">
            <h3 className="panel-title">Suara narasi</h3>
            <VoiceFields idPrefix={`${idPrefix}-voice`} voice={manifest.defaultVoice} disabled={false} onChange={(voice) => execute(setDefaultVoice(manifest, voice))} />
            <p className="text-caption text-fg-2">Edge-TTS gratis tetapi tidak resmi (perlu persetujuan sekali). Untuk karya komersial pilih Azure Speech dan isi kuncinya di Pengaturan.</p>
          </section>
          {videos.length > 0 && (
            <Checkbox checked={synthesize} onChange={setSynthesize}>
              Langsung buat suara untuk semua scene
            </Checkbox>
          )}
        </div>
      )}
    </Dialog>
  );
}
