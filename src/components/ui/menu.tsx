/**
 * Context menu and dropdown menu (08 §8): shortcut right-aligned, destructive items separated
 * and red. Both share one item model so a command looks the same wherever it is offered.
 */
import type { LucideIcon } from "lucide-react";
import { ContextMenu as C, DropdownMenu as D } from "radix-ui";
import type { ReactElement } from "react";

export interface MenuItem {
  readonly label: string;
  readonly icon?: LucideIcon;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  /** Rendered last, after a separator, in the danger colour. */
  readonly danger?: boolean;
  readonly onSelect: () => void;
}

const CONTENT_CLASS = "animate-pop z-30 min-w-[220px] rounded-md border border-line bg-raised p-1 text-fg shadow-raised";
const ITEM_CLASS =
  "flex h-8 items-center gap-2 rounded-sm px-2 text-ui outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-hover";

function ItemBody({ item }: { readonly item: MenuItem }) {
  const Icon = item.icon;
  return (
    <>
      <span className="inline-flex w-4 shrink-0 justify-center">{Icon && <Icon size={16} strokeWidth={1.75} aria-hidden />}</span>
      <span className="flex-1">{item.label}</span>
      {item.shortcut && <span className="pl-4 font-mono text-caption text-fg-muted">{item.shortcut}</span>}
    </>
  );
}

function split(items: ReadonlyArray<MenuItem>): readonly [ReadonlyArray<MenuItem>, ReadonlyArray<MenuItem>] {
  return [items.filter((i) => i.danger !== true), items.filter((i) => i.danger === true)];
}

/** Right-click menu around `children` (which must accept a ref, e.g. a DOM element). */
export function ContextMenu({ items, children }: { readonly items: ReadonlyArray<MenuItem>; readonly children: ReactElement }) {
  const [normal, danger] = split(items);
  const render = (item: MenuItem) => (
    <C.Item key={item.label} disabled={item.disabled === true} onSelect={item.onSelect} className={`${ITEM_CLASS} ${item.danger ? "text-danger" : ""}`}>
      <ItemBody item={item} />
    </C.Item>
  );
  return (
    <C.Root>
      <C.Trigger asChild>{children}</C.Trigger>
      <C.Portal>
        <C.Content className={CONTENT_CLASS} collisionPadding={8}>
          {normal.map(render)}
          {danger.length > 0 && normal.length > 0 && <C.Separator className="my-1 h-px bg-line-subtle" />}
          {danger.map(render)}
        </C.Content>
      </C.Portal>
    </C.Root>
  );
}

/** Menu opened by a button (`trigger` must accept a ref). */
export function DropdownMenu({ items, trigger, align = "start" }: { readonly items: ReadonlyArray<MenuItem>; readonly trigger: ReactElement; readonly align?: "start" | "end" }) {
  const [normal, danger] = split(items);
  const render = (item: MenuItem) => (
    <D.Item key={item.label} disabled={item.disabled === true} onSelect={item.onSelect} className={`${ITEM_CLASS} ${item.danger ? "text-danger" : ""}`}>
      <ItemBody item={item} />
    </D.Item>
  );
  return (
    <D.Root>
      <D.Trigger asChild>{trigger}</D.Trigger>
      <D.Portal>
        <D.Content className={CONTENT_CLASS} align={align} sideOffset={4} collisionPadding={8}>
          {normal.map(render)}
          {danger.length > 0 && normal.length > 0 && <D.Separator className="my-1 h-px bg-line-subtle" />}
          {danger.map(render)}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
