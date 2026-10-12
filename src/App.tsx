import { useState } from "react";
import { AppShell, type ViewId } from "./components/AppShell";
import { EngineView } from "./components/EngineView";
import { WorkspacePage } from "./components/WorkspacePage";
import { useTheme } from "./lib/theme";
import type { VideoEncoderId } from "./types";

export function App() {
  const theme = useTheme();
  const [view, setView] = useState<ViewId>("edit");
  const [encoder, setEncoder] = useState<VideoEncoderId | null>(null);

  return (
    <AppShell view={view} onNavigate={setView} theme={theme} encoder={encoder}>
      {view === "engine" ? <EngineView onEncoderDetected={setEncoder} /> : <WorkspacePage page={view} />}
    </AppShell>
  );
}
