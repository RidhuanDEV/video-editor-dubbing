/**
 * Settings (PRD 10 §4.5) as one dialog with sections, instead of a page behind a button
 * labelled with the encoder. Reachable from the title bar, the status bar and Ctrl+,.
 */
import { isTauri } from "@tauri-apps/api/core";
import { Cpu, Download, FileSearch, Info, Keyboard, KeyRound, Monitor, Moon, Palette, RotateCcw, ShieldCheck, Sun, Trash2, Video, Mic, type LucideIcon } from "lucide-react";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { redetectEncoders, useEngine } from "../../lib/engine";
import {
  checkDependencies,
  settingsClearAzure,
  settingsClearFfmpeg,
  settingsPickFfmpeg,
  settingsSetAzure,
  settingsSetEdgeConsent,
  type IpcResult,
} from "../../lib/ipc";
import { useJobProgress } from "../../lib/jobs";
import { notify } from "../../lib/notices";
import { setSettings, useSettings } from "../../lib/settings";
import { SHORTCUT_GROUPS } from "../../lib/shortcuts";
import type { ThemeState } from "../../lib/theme";
import { checkForUpdates } from "../../lib/updater";
import { invalidateVoices } from "../../lib/voices";
import { useWorkspace, type SettingsSection } from "../../project/workspace";
import type { AppError, BinarySource, DependencyReport, EncoderDetection, FfmpegLicense, ThemePreference, ToolStatus, VideoEncoderId } from "../../types";
import { Dialog } from "../Dialog";
import { Button, Field, INPUT_CLASS, Kbd, Segmented, StatusText } from "../ui";

const SECTIONS: ReadonlyArray<{ readonly id: SettingsSection; readonly label: string; readonly icon: LucideIcon }> = [
  { id: "general", label: "Umum", icon: Palette },
  { id: "voice", label: "Suara (TTS)", icon: Mic },
  { id: "video", label: "Video & GPU", icon: Video },
  { id: "shortcuts", label: "Pintasan", icon: Keyboard },
  { id: "about", label: "Tentang", icon: Info },
];

function Group({ title, children, description }: { readonly title: string; readonly description?: string; readonly children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line-subtle pb-5 last:border-b-0" aria-label={title}>
      <div>
        <h3 className="text-ui font-semibold">{title}</h3>
        {description && <p className="text-caption text-fg-2">{description}</p>}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------

const THEMES: ReadonlyArray<{ readonly value: ThemePreference; readonly label: string; readonly icon: LucideIcon }> = [
  { value: "system", label: "Sistem", icon: Monitor },
  { value: "light", label: "Terang", icon: Sun },
  { value: "dark", label: "Gelap", icon: Moon },
];

function GeneralSection({ theme }: { readonly theme: ThemeState }) {
  return (
    <>
      <Group title="Tema" description="Ctrl+Shift+L berpindah tema kapan saja.">
        <Segmented label="Tema" value={theme.preference} options={THEMES} onChange={theme.setPreference} />
      </Group>
      <Group title="Penyimpanan" description="Proyek disimpan dengan Ctrl+S. Autosave cadangan ditulis tiap 30 detik saat ada perubahan, dan ditawarkan untuk dipulihkan jika aplikasi tertutup mendadak.">
        <p className="text-caption text-fg-2">Ukuran panel Studio diingat otomatis di komputer ini.</p>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------

function VoiceSection() {
  const ids = { region: useId(), key: useId() };
  const settings = useSettings((s) => s.settings);
  const [region, setRegion] = useState("");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  const setConsent = async (consent: boolean): Promise<void> => {
    const result = await settingsSetEdgeConsent(consent);
    if (!result.ok) return notify("error", result.error.message);
    setSettings(result.value);
    invalidateVoices("edge-tts");
  };

  const saveAzure = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    const result = await settingsSetAzure(region.trim(), key.trim());
    setSaving(false);
    if (!result.ok) return notify("error", `Azure: ${result.error.message}`);
    setKey("");
    if (settings) setSettings({ ...settings, azureRegion: region.trim(), azureKeyStored: true });
    invalidateVoices("azure-speech");
    notify("success", `Azure Speech terhubung (${result.value} suara). Kunci disimpan di penyimpanan kredensial Windows.`);
  };

  const clearAzure = async (): Promise<void> => {
    const result = await settingsClearAzure();
    if (!result.ok) return notify("error", result.error.message);
    setSettings(result.value);
    invalidateVoices("azure-speech");
  };

  return (
    <>
      <Group
        title="Edge-TTS · gratis, tidak resmi"
        description="Memakai layanan baca-keras Microsoft Edge lewat klien tidak resmi: teks naskah dikirim ke server Microsoft, layanan dapat berubah atau diblokir kapan saja, dan ketentuan komersialnya tidak jelas."
      >
        {settings?.edgeTtsConsent ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusText tone="success">Disetujui</StatusText>
            <Button size="sm" onClick={() => void setConsent(false)}>
              Cabut persetujuan
            </Button>
          </div>
        ) : (
          <Button icon={ShieldCheck} onClick={() => void setConsent(true)}>
            Saya mengerti, aktifkan Edge-TTS
          </Button>
        )}
      </Group>
      <Group
        title="Azure AI Speech · resmi"
        description="Disarankan untuk penggunaan komersial. Ada kuota gratis bulanan; tagihan di luar kuota ditanggung pemilik kunci. Subtitle scene Azure memakai timing perkiraan."
      >
        {settings?.azureKeyStored && settings.azureRegion ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusText tone="success">Terhubung · region {settings.azureRegion}</StatusText>
            <Button size="sm" variant="danger" icon={Trash2} onClick={() => void clearAzure()}>
              Hapus kunci
            </Button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => void saveAzure(e)}>
            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <Field id={ids.region} label="Region" hint="mis. southeastasia">
                <input id={ids.region} className={`${INPUT_CLASS} font-mono`} value={region} onChange={(e) => setRegion(e.target.value)} spellCheck={false} />
              </Field>
              <Field id={ids.key} label="Kunci (Key 1 atau Key 2)">
                <input id={ids.key} type="password" autoComplete="off" className={`${INPUT_CLASS} font-mono`} value={key} onChange={(e) => setKey(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" icon={KeyRound} loading={saving} disabled={region.trim() === "" || key.trim() === ""}>
              Uji & simpan
            </Button>
          </form>
        )}
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------

type Remote<T> = { readonly state: "loading" } | { readonly state: "done"; readonly value: T } | { readonly state: "error"; readonly error: AppError };

function toRemote<T>(result: IpcResult<T>): Remote<T> {
  return result.ok ? { state: "done", value: result.value } : { state: "error", error: result.error };
}

const LICENSE_TONE: Readonly<Record<FfmpegLicense, { readonly tone: "success" | "warning"; readonly text: string }>> = {
  lgpl: { tone: "success", text: "LGPL" },
  gpl: { tone: "warning", text: "GPL (bukan build bawaan)" },
  nonfree: { tone: "warning", text: "nonfree (tidak boleh didistribusikan)" },
  undetected: { tone: "warning", text: "lisensi tidak terdeteksi" },
};
const SOURCE_LABEL: Readonly<Record<BinarySource, string>> = { custom: "kustom", bundled: "bawaan aplikasi", system: "PATH sistem" };

function ToolRow({ name, status }: { readonly name: string; readonly status: ToolStatus }) {
  return (
    <div className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 py-1.5">
      <span className="font-mono text-ui">{name}</span>
      {status.status === "found" ? (
        <div className="min-w-0 space-y-0.5">
          <p className="text-ui">
            {status.version} · {SOURCE_LABEL[status.source]} · <StatusText tone={LICENSE_TONE[status.license].tone}>{LICENSE_TONE[status.license].text}</StatusText>
          </p>
          <p className="truncate font-mono text-caption text-fg-muted" title={status.path}>
            {status.path}
          </p>
        </div>
      ) : (
        <StatusText tone="danger">{status.reason}</StatusText>
      )}
    </div>
  );
}

const SOFTWARE_NOTE: Readonly<Partial<Record<VideoEncoderId, string>>> = {
  libopenh264: "Encoder CPU kualitas dasar. GPU atau FFmpeg sendiri memberi hasil lebih baik.",
  libsvtav1: "Encoder CPU berkualitas baik; lebih lambat daripada GPU.",
};

function EncoderList({ title, detection }: { readonly title: string; readonly detection: EncoderDetection }) {
  const note = detection.selected ? SOFTWARE_NOTE[detection.selected] : undefined;
  return (
    <div className="space-y-2">
      <p className="text-ui font-medium">{title}</p>
      {detection.selected ? (
        <StatusText tone={note ? "info" : "success"}>
          Dipakai: <span className="font-mono">{detection.selected}</span>
          {note ? ` — ${note}` : ""}
        </StatusText>
      ) : (
        <StatusText tone="danger">Tidak ada encoder yang lolos uji. Pilih FFmpeg kustom.</StatusText>
      )}
      <ul className="space-y-0.5 text-caption">
        {detection.candidates.map((c) => (
          <li key={c.encoder} className="flex items-center gap-2">
            <span className="w-32 font-mono">{c.encoder}</span>
            <span className="w-10 text-fg-2">{c.hardware ? "GPU" : "CPU"}</span>
            {c.testPassed ? (
              <StatusText tone="success">lolos uji</StatusText>
            ) : c.listed ? (
              <span className="truncate text-warning" title={c.error ?? undefined}>
                gagal uji
              </span>
            ) : (
              <span className="text-fg-muted">tidak ada di build ini</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VideoSection() {
  const settings = useSettings((s) => s.settings);
  const encoders = useEngine((s) => s.encoders);
  const progress = useJobProgress(encoders.state === "detecting" ? encoders.jobId : null);
  const [deps, setDeps] = useState<Remote<DependencyReport>>({ state: "loading" });
  const [picking, setPicking] = useState(false);

  const refresh = (): void => {
    setDeps({ state: "loading" });
    void checkDependencies().then((r) => setDeps(toRemote(r)));
  };
  useEffect(() => {
    if (isTauri()) refresh();
  }, []);

  const afterChange = (): void => {
    refresh();
    void redetectEncoders();
  };
  const pick = async (): Promise<void> => {
    setPicking(true);
    const result = await settingsPickFfmpeg();
    setPicking(false);
    if (!result.ok) return notify("error", `FFmpeg kustom ditolak: ${result.error.message}`);
    if (!result.value) return;
    setSettings(result.value);
    notify("success", "FFmpeg kustom dipakai untuk preview dan ekspor.");
    afterChange();
  };
  const clear = async (): Promise<void> => {
    const result = await settingsClearFfmpeg();
    if (!result.ok) return notify("error", result.error.message);
    setSettings(result.value);
    afterChange();
  };

  return (
    <>
      <Group title="FFmpeg" description="Urutan: FFmpeg kustom → bawaan aplikasi (LGPL) → PATH sistem. Build kustom (mis. dengan libx264) berada di bawah lisensinya sendiri.">
        {deps.state === "loading" && <p className="text-caption text-fg-2">Memeriksa…</p>}
        {deps.state === "error" && <StatusText tone="danger">{deps.error.message}</StatusText>}
        {deps.state === "done" && (
          <div>
            <ToolRow name="ffmpeg" status={deps.value.ffmpeg} />
            <ToolRow name="ffprobe" status={deps.value.ffprobe} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button icon={FileSearch} loading={picking} onClick={() => void pick()}>
            {settings?.customFfmpegPath ? "Ganti FFmpeg kustom…" : "Pilih FFmpeg kustom…"}
          </Button>
          {settings?.customFfmpegPath && (
            <Button variant="ghost" icon={RotateCcw} onClick={() => void clear()}>
              Pakai bawaan
            </Button>
          )}
        </div>
      </Group>
      <Group title="Encoder" description="Diuji otomatis saat aplikasi dibuka dengan encode percobaan sungguhan; GPU dipakai bila lolos, jika tidak jatuh ke CPU.">
        {encoders.state === "detecting" && <p className="text-caption text-fg-2">{progress ?? "Menguji encoder…"}</p>}
        {encoders.state === "error" && <StatusText tone="danger">{encoders.error.message}</StatusText>}
        {encoders.state === "done" && (
          <div className="grid gap-4 md:grid-cols-2">
            <EncoderList title="AV1 (ekspor default)" detection={encoders.report.av1} />
            <EncoderList title="H.264 (kompatibel & preview)" detection={encoders.report.h264} />
          </div>
        )}
        <Button icon={Cpu} loading={encoders.state === "detecting"} onClick={() => void redetectEncoders()}>
          Deteksi ulang
        </Button>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------

function ShortcutsSection() {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title} className="space-y-2" aria-label={group.title}>
          <h3 className="panel-title">{group.title}</h3>
          <dl className="space-y-1.5">
            {group.items.map((item) => (
              <div key={item.keys} className="flex items-center justify-between gap-3 text-ui">
                <dt className="text-fg-2">{item.label}</dt>
                <dd>
                  <Kbd>{item.keys}</Kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function AboutSection() {
  const [checking, setChecking] = useState(false);
  const check = async (): Promise<void> => {
    setChecking(true);
    try {
      if (!(await checkForUpdates())) notify("info", "Anda sudah memakai versi terbaru.");
    } catch (error) {
      notify("error", `Gagal memeriksa pembaruan: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <Group title="Script Studio" description="Editor video tutorial berbasis naskah. Open source, Apache-2.0.">
        <Button icon={Download} loading={checking} disabled={!isTauri()} onClick={() => void check()}>
          Periksa pembaruan
        </Button>
        <p className="text-caption text-fg-2">Pembaruan ditandatangani dan diverifikasi sebelum dipasang. Installer tidak memakai sertifikat berbayar, jadi Windows SmartScreen bertanya sekali saat pemasangan.</p>
      </Group>
      <Group title="Komponen pihak ketiga">
        <p className="text-caption text-fg-2">
          FFmpeg 8.1 (LGPL-3.0-or-later) dibundel sebagai program terpisah; sumbernya tersedia di rilis ffmpeg-8.1-lgpl repositori proyek. Font Inter dan JetBrains Mono (SIL OFL 1.1). Daftar lengkap: THIRD_PARTY_NOTICES.md.
        </p>
      </Group>
      <Group title="Log">
        <p className="font-mono text-caption break-all text-fg-2">%LOCALAPPDATA%\dev.ridhuan.scriptstudio\logs</p>
        <p className="text-caption text-fg-muted">Lampirkan file log saat melaporkan masalah. Log tidak berisi kunci API.</p>
      </Group>
    </>
  );
}

export function SettingsDialog({ theme }: { readonly theme: ThemeState }) {
  const open = useWorkspace((s) => s.dialog === "settings");
  const section = useWorkspace((s) => s.settingsSection);
  const close = useWorkspace((s) => s.closeDialog);
  const openSettings = useWorkspace((s) => s.openSettings);

  return (
    <Dialog
      open={open}
      title="Pengaturan"
      width="lg"
      onClose={close}
      actions={
        <Button variant="primary" onClick={close}>
          Selesai
        </Button>
      }
    >
      <div className="grid min-h-[420px] grid-cols-[168px_1fr] gap-5">
        <nav aria-label="Bagian pengaturan" className="space-y-0.5">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              onClick={() => openSettings(id)}
              className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-ui transition-colors duration-150 ${
                section === id ? "bg-accent-subtle font-medium text-accent" : "text-fg-2 hover:bg-hover hover:text-fg"
              }`}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden />
              {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-5">
          {section === "general" && <GeneralSection theme={theme} />}
          {section === "voice" && <VoiceSection />}
          {section === "video" && <VideoSection />}
          {section === "shortcuts" && <ShortcutsSection />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </Dialog>
  );
}
