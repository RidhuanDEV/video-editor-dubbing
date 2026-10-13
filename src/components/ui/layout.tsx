/** Layout pieces: tabs, empty state, collapsible "Lanjutan" section, segmented control (08 §8). */
import { ChevronRight, type LucideIcon } from "lucide-react";
import { Collapsible, Tabs as RadixTabs, ToggleGroup } from "radix-ui";
import { useState, type ReactNode } from "react";

export interface TabItem<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: LucideIcon;
  /** Small count shown after the label. */
  readonly badge?: number;
}

interface TabsProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly tabs: ReadonlyArray<TabItem<T>>;
  readonly onChange: (value: T) => void;
  /** One element per tab value. */
  readonly panels: Readonly<Record<T, ReactNode>>;
}

/** Active tab: primary text + 2 px accent underline; arrow keys move between tabs. */
export function Tabs<T extends string>({ label, value, tabs, onChange, panels }: TabsProps<T>) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(next) => {
        const tab = tabs.find((t) => t.value === next);
        if (tab) onChange(tab.value);
      }}
      className="flex h-full min-h-0 flex-col"
    >
      <RadixTabs.List aria-label={label} className="flex shrink-0 border-b border-line-subtle px-2">
        {tabs.map(({ value: tabValue, label: tabLabel, icon: Icon, badge }) => (
          <RadixTabs.Trigger
            key={tabValue}
            value={tabValue}
            className="-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 border-transparent px-3 text-ui font-medium text-fg-2 transition-colors duration-150 hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg"
          >
            {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden />}
            {tabLabel}
            {badge !== undefined && badge > 0 && <span className="rounded-full bg-surface px-1.5 font-mono text-caption tabular text-fg-2">{badge}</span>}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map(({ value: tabValue }) => (
        <RadixTabs.Content key={tabValue} value={tabValue} className="min-h-0 flex-1 outline-none">
          {panels[tabValue]}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}

interface EmptyStateProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly children?: ReactNode;
  /** Primary and secondary actions. */
  readonly actions?: ReactNode;
}

/** Every empty panel says what is missing and offers the action that fills it (08 §8). */
export function EmptyState({ icon: Icon, title, children, actions }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-surface text-fg-2">
        <Icon size={24} strokeWidth={1.5} aria-hidden />
      </span>
      <p className="text-body font-medium">{title}</p>
      {children && <div className="max-w-[320px] text-caption text-fg-2">{children}</div>}
      {actions && <div className="flex flex-wrap justify-center gap-2 pt-1">{actions}</div>}
    </div>
  );
}

/** Progressive disclosure for advanced settings (PRD 10 §3 principle 5). */
export function Disclosure({ title, defaultOpen = false, children }: { readonly title: string; readonly defaultOpen?: boolean; readonly children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="space-y-3">
      <Collapsible.Trigger className="group inline-flex items-center gap-1 rounded-sm text-caption font-medium text-fg-2 hover:text-fg">
        <ChevronRight size={14} strokeWidth={2} aria-hidden className="transition-transform duration-150 group-data-[state=open]:rotate-90" />
        {title}
      </Collapsible.Trigger>
      <Collapsible.Content className="space-y-3">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: LucideIcon;
}

/** Single-choice segmented control (e.g. theme, aspect ratio). */
export function Segmented<T extends string>({ label, value, options, onChange, disabled = false }: {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<SegmentOption<T>>;
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        // Radix sends "" when the active item is clicked again; a segmented control stays set.
        const option = options.find((o) => o.value === next);
        if (option) onChange(option.value);
      }}
      className="inline-flex rounded-md border border-line bg-surface p-0.5"
    >
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon }) => (
        <ToggleGroup.Item
          key={optionValue}
          value={optionValue}
          className="inline-flex h-7 items-center gap-1.5 rounded-[4px] px-2.5 text-ui text-fg-2 transition-colors duration-150 hover:text-fg data-[disabled]:opacity-50 data-[state=on]:bg-accent-subtle data-[state=on]:text-accent"
        >
          {Icon && <Icon size={14} strokeWidth={1.75} aria-hidden />}
          {optionLabel}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
