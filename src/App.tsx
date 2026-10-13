import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { Dialog } from "./components/Dialog";
import { Notices } from "./components/Notices";
import { CommandPalette } from "./components/shell/CommandPalette";
import { FileDropOverlay } from "./components/shell/FileDropOverlay";
import { SettingsDialog } from "./components/shell/SettingsDialog";
import { StartScreen } from "./components/shell/StartScreen";
import { StatusBar } from "./components/shell/StatusBar";
import { TitleBar } from "./components/shell/TitleBar";
import { Studio } from "./components/studio/Studio";
import { Button } from "./components/ui";
import { useDesktopGuards } from "./lib/desktop";
import { useEncoderAutoDetect } from "./lib/engine";
import { notify } from "./lib/notices";
import { useSettings, useSettingsLoader } from "./lib/settings";
import { useTheme } from "./lib/theme";
import { dismissUpdate, installUpdate, useUpdateCheck, useUpdater } from "./lib/updater";
import { resetEditor } from "./project/editor";
import { closeProjectGuarded, hasUnsavedChanges, requestWindowClose, resolveExit, useExit } from "./project/exit";
import { useExportProgress } from "./project/exportJob";
import { importMedia, useFileDrop } from "./project/mediaActions";
import { useProxyBuilder } from "./project/proxies";
import { openProject, resolveRecovery, saveProject, useAutosave, useSessionUi } from "./project/session";
import { isDirty, useProjectStore } from "./project/store";
import { resetWaveforms } from "./project/waveforms";
import { useWorkspace } from "./project/workspace";

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA");
}

/** App-wide Ctrl/Cmd shortcuts (03 §3, §5.5). Studio-only keys live in the Studio. */
function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const store = useProjectStore.getState();
      const workspace = useWorkspace.getState();
      const run = (action: () => void): void => {
        event.preventDefault();
        action();
      };
      if (key === "k") return run(() => workspace.openDialog("palette"));
      if (key === ",") return run(() => workspace.openSettings("general"));
      if (key === "o") return run(() => void closeProjectGuarded(() => openProject()));
      if (!store.project) return;
      if (key === "s") return run(() => void saveProject().then((ok) => ok && notify("success", "Proyek disimpan.")));
      if (key === "e") return run(() => workspace.openDialog("export"));
      if (key === "i") return run(() => void importMedia("dialog"));
      // Inside text fields the field's own undo handles typing.
      if (isTypingTarget(event.target) || workspace.dialog !== null) return;
      if (key === "z" && !event.shiftKey) return run(store.undo);
      if (key === "y" || (key === "z" && event.shiftKey)) return run(store.redo);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Intercepts the window close button while there are unsaved changes. */
function useCloseGuard(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let active = true;
    getCurrentWindow()
      .onCloseRequested((event) => {
        if (hasUnsavedChanges()) {
          event.preventDefault();
          requestWindowClose();
        }
      })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch((error: Error) => console.warn("close guard unavailable", error.message));
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);
}

/** Window title mirrors the project and its save state, like other desktop editors. */
function useWindowTitle(): void {
  const title = useProjectStore((s) => s.project?.manifest.title ?? null);
  const dirty = useProjectStore(isDirty);
  const last = useRef("");
  useEffect(() => {
    const next = title === null ? "Script Studio" : `${dirty ? "• " : ""}${title} — Script Studio`;
    if (!isTauri() || next === last.current) return;
    last.current = next;
    getCurrentWindow()
      .setTitle(next)
      .catch((error: Error) => console.warn("setTitle failed", error.message));
  }, [title, dirty]);
}

export function App() {
  const theme = useTheme();
  const project = useProjectStore((s) => s.project);
  const root = project?.root ?? null;
  const pendingRecovery = useSessionUi((s) => s.pendingRecovery);
  const pendingConsent = useSettings((s) => s.pendingConsent);
  const pendingExit = useExit((s) => s.pending);
  const update = useUpdater((s) => s.available);
  const updateProgress = useUpdater((s) => s.progress);

  useDesktopGuards();
  useSettingsLoader();
  useUpdateCheck();
  useEncoderAutoDetect();
  useAutosave();
  useProxyBuilder();
  useExportProgress();
  useFileDrop();
  useGlobalShortcuts();
  useCloseGuard();
  useWindowTitle();

  // A newly opened project starts with a fresh transport and waveform cache.
  useEffect(() => {
    resetEditor();
    resetWaveforms();
  }, [root]);

  return (
    <div className="flex h-full flex-col bg-app text-fg">
      <TitleBar />
      <main className="min-h-0 flex-1">{project ? <Studio project={project} /> : <StartScreen />}</main>
      <StatusBar />
      <Notices />
      <FileDropOverlay />

      <SettingsDialog theme={theme} />
      <CommandPalette theme={theme} />

      <Dialog
        open={update !== null}
        title={`Versi ${update?.version ?? ""} tersedia`}
        width="sm"
        onClose={() => updateProgress === null && dismissUpdate()}
        actions={
          <>
            <Button onClick={dismissUpdate} disabled={updateProgress !== null}>
              Nanti
            </Button>
            <Button
              variant="primary"
              loading={updateProgress !== null}
              onClick={() => {
                // Never lose work to the restart: save first, abort the update if saving fails.
                void (async () => {
                  if (hasUnsavedChanges() && !(await saveProject())) return;
                  await installUpdate();
                })();
              }}
            >
              {updateProgress === null ? "Perbarui & mulai ulang" : `Mengunduh… ${updateProgress}%`}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <p>Pembaruan ditandatangani dan diverifikasi sebelum dipasang. Proyek yang belum disimpan akan disimpan dulu.</p>
          {update?.notes && <p className="max-h-40 overflow-auto rounded-sm bg-surface p-2 text-caption whitespace-pre-wrap text-fg-2">{update.notes}</p>}
        </div>
      </Dialog>

      <Dialog
        open={pendingConsent !== null}
        title="Pakai Edge-TTS?"
        width="md"
        onClose={() => pendingConsent?.(false)}
        actions={
          <>
            <Button
              onClick={() => {
                pendingConsent?.(false);
                useWorkspace.getState().openSettings("voice");
              }}
            >
              Pakai Azure Speech
            </Button>
            <Button variant="primary" onClick={() => pendingConsent?.(true)}>
              Saya mengerti, lanjutkan
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <p>
            Edge-TTS memakai layanan baca-keras Microsoft Edge lewat klien <strong>tidak resmi</strong>.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-ui">
            <li>Teks naskah dikirim ke server Microsoft untuk diubah menjadi suara.</li>
            <li>Layanan dapat berubah atau diblokir kapan saja tanpa pemberitahuan.</li>
            <li>Ketentuan penggunaan komersial tidak jelas; untuk karya komersial gunakan Azure Speech (resmi).</li>
          </ul>
          <p className="text-caption text-fg-2">Persetujuan dapat dicabut kapan saja di Pengaturan → Suara.</p>
        </div>
      </Dialog>

      <Dialog
        open={pendingRecovery !== null}
        title="Pulihkan perubahan?"
        width="sm"
        onClose={() => void resolveRecovery(false)}
        actions={
          <>
            <Button onClick={() => void resolveRecovery(false)}>Buang</Button>
            <Button variant="primary" onClick={() => void resolveRecovery(true)}>
              Pulihkan
            </Button>
          </>
        }
      >
        <p>Sesi sebelumnya berakhir sebelum perubahan disimpan. Ditemukan autosave yang lebih baru dari file proyek.</p>
      </Dialog>

      <Dialog
        open={pendingExit !== null}
        title="Simpan perubahan?"
        width="sm"
        onClose={() => void resolveExit("cancel")}
        actions={
          <>
            <Button onClick={() => void resolveExit("cancel")}>Batal</Button>
            <Button variant="danger" onClick={() => void resolveExit("discard")}>
              Jangan simpan
            </Button>
            <Button variant="primary" onClick={() => void resolveExit("save")}>
              Simpan
            </Button>
          </>
        }
      >
        <p>Ada perubahan pada &quot;{project?.manifest.title}&quot; yang belum disimpan.</p>
      </Dialog>
    </div>
  );
}
