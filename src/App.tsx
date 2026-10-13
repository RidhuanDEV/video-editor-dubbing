import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { AppShell, type ProjectHeader, type ViewId } from "./components/AppShell";
import { Dialog } from "./components/Dialog";
import { EditPage } from "./components/edit/EditPage";
import { EngineView } from "./components/EngineView";
import { MediaPage } from "./components/MediaPage";
import { Notices } from "./components/Notices";
import { ScriptPage } from "./components/ScriptPage";
import { StartScreen } from "./components/StartScreen";
import { Button } from "./components/ui";
import { WorkspacePage } from "./components/WorkspacePage";
import { notify } from "./lib/notices";
import { useTheme } from "./lib/theme";
import { resetEditor } from "./project/editor";
import { useProxyBuilder } from "./project/proxies";
import { closeProject, resolveRecovery, saveProject, useAutosave, useSessionUi } from "./project/session";
import { isDirty, useProjectStore } from "./project/store";
import type { VideoEncoderId } from "./types";

/** What to do once unsaved changes are dealt with. */
type PendingExit = "closeProject" | "closeWindow" | null;

async function finishExit(exit: Exclude<PendingExit, null>): Promise<void> {
  if (exit === "closeProject") await closeProject();
  else await getCurrentWindow().destroy();
}

/** Ctrl/Cmd+S save, Ctrl/Cmd+Z undo, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z redo (03 §3). */
function useProjectShortcuts(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const store = useProjectStore.getState();
      if (!store.project) return;
      if (key === "s") {
        event.preventDefault();
        void saveProject().then((ok) => ok && notify("success", "Proyek disimpan."));
      } else if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        store.undo();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        store.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Intercepts the window close button while there are unsaved changes. */
function useCloseGuard(onBlocked: () => void): void {
  const blockedRef = useRef(onBlocked);
  blockedRef.current = onBlocked;
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let active = true;
    getCurrentWindow()
      .onCloseRequested((event) => {
        if (isDirty(useProjectStore.getState()) && useProjectStore.getState().project) {
          event.preventDefault();
          blockedRef.current();
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

export function App() {
  const theme = useTheme();
  const [view, setView] = useState<ViewId>("script");
  const [encoder, setEncoder] = useState<VideoEncoderId | null>(null);
  const [pendingExit, setPendingExit] = useState<PendingExit>(null);
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore(isDirty);
  const undoLabel = useProjectStore((s) => s.past[s.past.length - 1]?.label ?? null);
  const redoLabel = useProjectStore((s) => s.future[0]?.label ?? null);
  const pendingRecovery = useSessionUi((s) => s.pendingRecovery);

  const root = project?.root ?? null;

  useAutosave();
  useProxyBuilder();
  useProjectShortcuts();

  // Each opened project starts on the Edit page (03 §5.1) with a fresh transport.
  useEffect(() => {
    resetEditor();
    if (root !== null) setView("edit");
  }, [root]);
  useCloseGuard(() => setPendingExit("closeWindow"));

  const requestClose = (): void => {
    if (dirty) setPendingExit("closeProject");
    else void closeProject();
  };

  const header: ProjectHeader | null = project && {
    title: project.manifest.title,
    readOnly: project.readOnly,
    dirty,
    undoLabel,
    redoLabel,
    onUndo: () => useProjectStore.getState().undo(),
    onRedo: () => useProjectStore.getState().redo(),
    onSave: () => void saveProject(),
    onClose: requestClose,
  };

  const content = (() => {
    if (view === "engine") return <EngineView onEncoderDetected={setEncoder} />;
    if (!project) return <StartScreen />;
    if (view === "media") return <MediaPage />;
    if (view === "script") return <ScriptPage onGoToMedia={() => setView("media")} />;
    if (view === "edit") return <EditPage />;
    return <WorkspacePage page={view} />;
  })();

  return (
    <>
      <AppShell view={view} onNavigate={setView} theme={theme} encoder={encoder} project={header}>
        {content}
      </AppShell>
      <Notices />

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
        <p>Sesi sebelumnya berakhir sebelum perubahan disimpan. Autosave yang lebih baru dari file proyek ditemukan.</p>
      </Dialog>

      <Dialog
        open={pendingExit !== null}
        title="Simpan perubahan?"
        width="sm"
        onClose={() => setPendingExit(null)}
        actions={
          <>
            <Button onClick={() => setPendingExit(null)}>Batal</Button>
            <Button
              onClick={() => {
                const exit = pendingExit;
                setPendingExit(null);
                if (exit) void finishExit(exit);
              }}
            >
              Jangan simpan
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const exit = pendingExit;
                setPendingExit(null);
                // A failed save keeps the project open (the error toast explains why).
                if (exit) void saveProject().then((ok) => (ok ? finishExit(exit) : undefined));
              }}
            >
              Simpan
            </Button>
          </>
        }
      >
        <p>Ada perubahan pada &quot;{project?.manifest.title}&quot; yang belum disimpan.</p>
      </Dialog>
    </>
  );
}
