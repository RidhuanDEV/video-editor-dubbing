/** Token-styled select (08 §8) replacing the native <select>, which ignores the theme on Windows. */
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Select as S } from "radix-ui";
import { INPUT_CLASS } from "./field";

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Secondary text, right-aligned in the list only. */
  readonly detail?: string;
}

interface SelectProps<T extends string> {
  readonly id: string;
  readonly value: T;
  readonly options: ReadonlyArray<SelectOption<T>>;
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function Select<T extends string>({ id, value, options, onChange, disabled = false, className }: SelectProps<T>) {
  // Radix reports a plain string; map it back to the typed option instead of casting.
  const handleChange = (next: string): void => {
    const option = options.find((o) => o.value === next);
    if (option) onChange(option.value);
  };
  return (
    <S.Root value={value} onValueChange={handleChange} disabled={disabled}>
      <S.Trigger id={id} className={`${INPUT_CLASS} inline-flex items-center justify-between gap-2 text-left ${className ?? ""}`}>
        <span className="min-w-0 truncate">
          <S.Value />
        </span>
        <S.Icon className="shrink-0 text-fg-2">
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="animate-pop z-30 max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-line bg-raised text-fg shadow-raised"
        >
          <S.ScrollUpButton className="flex h-6 items-center justify-center text-fg-2">
            <ChevronUp size={14} aria-hidden />
          </S.ScrollUpButton>
          <S.Viewport className="p-1">
            {options.map((option) => (
              <S.Item
                key={option.value}
                value={option.value}
                className="relative flex h-8 items-center gap-3 rounded-sm pr-2 pl-7 text-ui outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover"
              >
                <S.ItemIndicator className="absolute left-2 inline-flex text-accent">
                  <Check size={14} strokeWidth={2} aria-hidden />
                </S.ItemIndicator>
                <S.ItemText>{option.label}</S.ItemText>
                {option.detail && <span className="ml-auto text-caption text-fg-muted">{option.detail}</span>}
              </S.Item>
            ))}
          </S.Viewport>
          <S.ScrollDownButton className="flex h-6 items-center justify-center text-fg-2">
            <ChevronDown size={14} aria-hidden />
          </S.ScrollDownButton>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
