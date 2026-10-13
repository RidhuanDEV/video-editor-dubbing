import { X } from "lucide-react";
import { useNotices, type NoticeTone } from "../lib/notices";
import { Button, IconButton, StatusText, type StatusTone } from "./ui";

const TONE: Readonly<Record<NoticeTone, StatusTone>> = { info: "info", success: "success", warning: "warning", error: "danger" };

/** Bottom-right stack; errors are announced assertively, the rest politely (08 §9). */
export function Notices() {
  const notices = useNotices((s) => s.notices);
  const dismiss = useNotices((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed right-4 bottom-14 z-50 flex w-[380px] flex-col gap-2">
      {notices.map((notice) => (
        <div
          key={notice.id}
          role={notice.tone === "error" ? "alert" : "status"}
          className="animate-pop pointer-events-auto flex items-start gap-2 rounded-md border border-line bg-raised p-3 text-ui shadow-raised"
        >
          <div className="min-w-0 flex-1 break-words">
            <StatusText tone={TONE[notice.tone]}>{notice.message}</StatusText>
          </div>
          {notice.action && (
            <Button
              size="sm"
              variant="ghost"
              className="-my-1 text-accent hover:text-accent"
              onClick={() => {
                notice.action?.run();
                dismiss(notice.id);
              }}
            >
              {notice.action.label}
            </Button>
          )}
          <IconButton icon={X} size="sm" label="Tutup notifikasi" onClick={() => dismiss(notice.id)} className="-my-1" />
        </div>
      ))}
    </div>
  );
}
