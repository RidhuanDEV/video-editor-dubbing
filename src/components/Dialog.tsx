/**
 * Modal dialog on the native <dialog> element: `showModal()` makes the rest of the page inert
 * (focus stays inside), Esc closes, and focus returns to the trigger on close (08 §8).
 */
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./ui";

interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Buttons, primary last (rendered bottom-right). */
  readonly actions: ReactNode;
  readonly width?: "sm" | "md" | "lg";
}

const WIDTH = { sm: "w-[420px]", md: "w-[560px]", lg: "w-[760px]" } satisfies Record<NonNullable<DialogProps["width"]>, string>;

export function Dialog({ open, title, onClose, children, actions, width = "md" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={`${WIDTH[width]} max-w-[calc(100vw-32px)] rounded-lg border border-line-subtle bg-raised p-0 text-fg shadow-raised backdrop:bg-black/50`}
    >
      <header className="flex items-center justify-between border-b border-line-subtle px-5 py-3">
        <h2 id={titleId} className="text-[18px] leading-[26px] font-semibold">
          {title}
        </h2>
        <IconButton icon={X} label="Tutup" onClick={onClose} />
      </header>
      <div className="max-h-[70vh] overflow-auto px-5 py-4 text-[14px] leading-[22px]">{children}</div>
      <footer className="flex justify-end gap-2 border-t border-line-subtle px-5 py-3">{actions}</footer>
    </dialog>
  );
}
