/**
 * Tooltip (08 §8): opens after 500 ms on hover and immediately on keyboard focus, shows the
 * shortcut. Replaces the native `title` attribute, which ignores focus and cannot show a Kbd.
 */
import { Tooltip as T } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

export function TooltipProvider({ children }: { readonly children: ReactNode }) {
  return (
    <T.Provider delayDuration={500} skipDelayDuration={300}>
      {children}
    </T.Provider>
  );
}

export function Kbd({ children }: { readonly children: ReactNode }) {
  return <kbd className="rounded-[3px] border border-line bg-surface px-1 font-mono text-caption text-fg-2">{children}</kbd>;
}

export type TooltipSide = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  readonly content: ReactNode;
  readonly shortcut?: string | undefined;
  readonly side?: TooltipSide | undefined;
  /** Wraps the trigger in a span: disabled buttons get no pointer events, so the reason would never show. */
  readonly disabled?: boolean;
  readonly children: ReactElement;
}

export function Tooltip({ content, shortcut, side = "bottom", disabled = false, children }: TooltipProps) {
  return (
    <T.Root>
      <T.Trigger asChild>{disabled ? <span className="inline-flex">{children}</span> : children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="animate-pop z-30 flex max-w-[320px] items-center gap-2 rounded-sm border border-line bg-raised px-2 py-1 text-caption text-fg shadow-raised"
        >
          <span>{content}</span>
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
