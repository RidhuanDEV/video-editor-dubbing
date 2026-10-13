/**
 * Modal dialog (08 §8) on Radix Dialog: focus is trapped inside, Esc closes, focus returns to
 * the trigger, and popovers (select, tooltip) portal above it on the same layer system.
 */
import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";
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
  return (
    <D.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <D.Portal>
        <D.Overlay className="animate-fade fixed inset-0 z-40 bg-black/50" />
        <D.Content
          aria-describedby={undefined}
          className={`${WIDTH[width]} animate-pop fixed top-1/2 left-1/2 z-40 flex max-h-[calc(100vh-64px)] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line-subtle bg-raised text-fg shadow-raised`}
        >
          <header className="flex shrink-0 items-center justify-between border-b border-line-subtle px-5 py-3">
            <D.Title className="text-title font-semibold">{title}</D.Title>
            <IconButton icon={X} label="Tutup" shortcut="Esc" onClick={onClose} />
          </header>
          <div className="min-h-0 overflow-auto px-5 py-4 text-body">{children}</div>
          <footer className="flex shrink-0 justify-end gap-2 border-t border-line-subtle px-5 py-3">{actions}</footer>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
