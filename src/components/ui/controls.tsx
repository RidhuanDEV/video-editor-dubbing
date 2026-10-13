/** Checkbox, slider and radio cards (08 §8): token colours, target ≥ 24 px, keyboard operable. */
import { Check, type LucideIcon } from "lucide-react";
import { Checkbox as C, RadioGroup as R, Slider as S } from "radix-ui";
import type { ReactNode } from "react";
import { labelIdFor } from "./field";

interface CheckboxProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly children: ReactNode;
}

export function Checkbox({ checked, onChange, disabled = false, children }: CheckboxProps) {
  return (
    <label className={`flex min-h-6 items-start gap-2 text-ui ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <C.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
        className="mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-line bg-surface transition-colors duration-150 hover:border-fg-muted data-[state=checked]:border-accent data-[state=checked]:bg-accent"
      >
        <C.Indicator className="text-on-accent">
          <Check size={12} strokeWidth={3} aria-hidden />
        </C.Indicator>
      </C.Root>
      <span>{children}</span>
    </label>
  );
}

interface SliderProps {
  /** Same id as the surrounding Field: the thumb is labelled by the Field's visible label. */
  readonly id: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
  /** Used when there is no Field label. */
  readonly ariaLabel?: string;
  readonly className?: string;
}

/** Arrow keys step, Shift+arrow / PageUp/PageDown take large steps (Radix). */
export function Slider({ id, value, min, max, step = 1, disabled = false, onChange, ariaLabel, className }: SliderProps) {
  return (
    <S.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(values) => {
        const next = values[0];
        if (next !== undefined) onChange(next);
      }}
      className={`relative flex h-6 w-full touch-none items-center select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 ${className ?? ""}`}
    >
      <S.Track className="relative h-1 grow overflow-hidden rounded-full bg-line">
        <S.Range className="absolute h-full rounded-full bg-accent" />
      </S.Track>
      <S.Thumb
        id={id}
        {...(ariaLabel ? { "aria-label": ariaLabel } : { "aria-labelledby": labelIdFor(id) })}
        className="block size-3.5 cursor-grab rounded-full border-2 border-accent bg-surface shadow-raised transition-transform duration-150 hover:scale-110 active:cursor-grabbing"
      />
    </S.Root>
  );
}

export interface RadioCardOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly detail?: string;
  readonly icon?: LucideIcon;
  readonly disabled?: boolean;
}

interface RadioCardsProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<RadioCardOption<T>>;
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly columns?: 1 | 2;
}

/** Card-style radio group; arrow keys move the selection (roving focus). */
export function RadioCards<T extends string>({ label, value, options, onChange, disabled = false, columns = 1 }: RadioCardsProps<T>) {
  return (
    <R.Root
      aria-label={label}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option) onChange(option.value);
      }}
      className={`grid gap-2 ${columns === 2 ? "sm:grid-cols-2" : ""}`}
    >
      {options.map(({ value: optionValue, label: optionLabel, detail, icon: Icon, disabled: optionDisabled }) => (
        <R.Item
          key={optionValue}
          value={optionValue}
          disabled={optionDisabled === true}
          className="group flex items-start gap-3 rounded-md border border-line-subtle bg-surface p-3 text-left transition-colors duration-150 hover:border-line hover:bg-hover data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-selected"
        >
          <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-line bg-surface group-data-[state=checked]:border-accent">
            <R.Indicator className="size-2 rounded-full bg-accent" />
          </span>
          {Icon && <Icon size={20} strokeWidth={1.75} className="shrink-0 text-fg-2 group-data-[state=checked]:text-accent" aria-hidden />}
          <span className="min-w-0">
            <span className="block text-ui font-medium">{optionLabel}</span>
            {detail && <span className="block text-caption text-fg-2">{detail}</span>}
          </span>
        </R.Item>
      ))}
    </R.Root>
  );
}
