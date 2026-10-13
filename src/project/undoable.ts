/** Destructive edits run immediately and offer "Urungkan" instead of a confirmation dialog (08 §8). */
import { notify } from "../lib/notices";
import type { Command } from "./commands";
import { useProjectStore } from "./store";

export function executeWithUndo(command: Command | null, message: string): void {
  if (!command) return;
  const store = useProjectStore.getState();
  store.execute(command);
  // execute() ignores commands on read-only projects; only offer undo when it actually ran.
  if (useProjectStore.getState().past.at(-1) !== command) return;
  notify("info", message, {
    label: "Urungkan",
    run: () => {
      const { past, undo } = useProjectStore.getState();
      // Only undo this exact step; anything done since then stays (Ctrl+Z still walks history).
      if (past.at(-1) === command) undo();
      else notify("info", "Sudah ada perubahan lain sesudahnya. Gunakan Ctrl+Z untuk mundur bertahap.");
    },
  });
}
