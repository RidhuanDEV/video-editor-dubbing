/**
 * Searchable select for long lists (hundreds of TTS voices): type to filter, arrow keys to move,
 * Enter to pick. Grouped options keep e.g. Indonesian voices together.
 */
import { Command } from "cmdk";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { INPUT_CLASS } from "./field";

export interface ComboboxOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly detail?: string;
  readonly group: string;
  /** Extra words the search matches (e.g. locale or gender). */
  readonly keywords?: ReadonlyArray<string>;
}

interface ComboboxProps<T extends string> {
  readonly id: string;
  readonly value: T;
  readonly options: ReadonlyArray<ComboboxOption<T>>;
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly searchPlaceholder: string;
  readonly emptyText: string;
}

export function Combobox<T extends string>({ id, value, options, onChange, disabled = false, searchPlaceholder, emptyText }: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const groups = [...new Set(options.map((o) => o.group))];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button type="button" id={id} role="combobox" aria-expanded={open} className={`${INPUT_CLASS} inline-flex items-center justify-between gap-2 text-left`}>
          <span className="min-w-0 truncate">{selected?.label ?? value}</span>
          <ChevronsUpDown size={14} strokeWidth={1.75} className="shrink-0 text-fg-2" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="animate-pop z-30 w-[max(var(--radix-popover-trigger-width),320px)] overflow-hidden rounded-md border border-line bg-raised text-fg shadow-raised"
        >
          <Command loop>
            <Command.Input placeholder={searchPlaceholder} className="h-9 w-full border-b border-line-subtle bg-transparent px-3 text-ui outline-none placeholder:text-fg-muted" />
            <Command.List className="max-h-[300px] overflow-auto p-1">
              <Command.Empty className="px-2 py-6 text-center text-caption text-fg-2">{emptyText}</Command.Empty>
              {groups.map((group) => (
                <Command.Group
                  key={group}
                  heading={group}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-muted"
                >
                  {options
                    .filter((o) => o.group === group)
                    .map((option) => (
                      <Command.Item
                        key={option.value}
                        value={option.value}
                        keywords={[option.label, ...(option.keywords ?? [])]}
                        onSelect={() => {
                          onChange(option.value);
                          setOpen(false);
                        }}
                        className="flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-ui select-none data-[selected=true]:bg-hover"
                      >
                        <span className="inline-flex w-4 justify-center text-accent">{option.value === value && <Check size={14} strokeWidth={2} aria-hidden />}</span>
                        <span className="flex-1 truncate">{option.label}</span>
                        {option.detail && <span className="text-caption text-fg-muted">{option.detail}</span>}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
