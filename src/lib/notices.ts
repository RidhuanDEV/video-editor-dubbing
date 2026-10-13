/** Toast notices (08 §8): info/success vanish after 5 s, warnings and errors stay until closed. */
import { create } from "zustand";

export type NoticeTone = "info" | "success" | "warning" | "error";

export interface Notice {
  readonly id: number;
  readonly tone: NoticeTone;
  readonly message: string;
}

const AUTO_DISMISS_MS = 5000;
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

export function notify(tone: NoticeTone, message: string): void {
  const id = nextId;
  nextId += 1;
  useNotices.setState((state) => ({ notices: [...state.notices, { id, tone, message }].slice(-MAX_NOTICES) }));
  if (tone === "info" || tone === "success") {
    window.setTimeout(() => useNotices.getState().dismiss(id), AUTO_DISMISS_MS);
  }
}
