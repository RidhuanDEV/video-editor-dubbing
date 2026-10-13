/**
 * Toast notices (08 §8): info/success vanish after 5 s, warnings and errors stay until closed.
 * A notice may carry one action (Urungkan, Coba lagi, Buka folder); acting dismisses it.
 */
import { create } from "zustand";

export type NoticeTone = "info" | "success" | "warning" | "error";

export interface NoticeAction {
  readonly label: string;
  readonly run: () => void;
}

export interface Notice {
  readonly id: number;
  readonly tone: NoticeTone;
  readonly message: string;
  readonly action: NoticeAction | null;
}

const AUTO_DISMISS_MS = 5000;
/** Notices with an action stay a little longer so the action can be reached. */
const ACTION_DISMISS_MS = 8000;
const MAX_NOTICES = 4;

interface NoticeStore {
  readonly notices: ReadonlyArray<Notice>;
  readonly dismiss: (id: number) => void;
}

let nextId = 1;

export const useNotices = create<NoticeStore>()((set) => ({
  notices: [],
  dismiss: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
}));

export function notify(tone: NoticeTone, message: string, action: NoticeAction | null = null): void {
  const id = nextId;
  nextId += 1;
  useNotices.setState((state) => ({ notices: [...state.notices, { id, tone, message, action }].slice(-MAX_NOTICES) }));
  if (tone === "info" || tone === "success") {
    setTimeout(() => useNotices.getState().dismiss(id), action ? ACTION_DISMISS_MS : AUTO_DISMISS_MS);
  }
}
