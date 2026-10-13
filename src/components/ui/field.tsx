/** Form layout, text inputs, status text and cards (08 §8). */
import { AlertCircle, CheckCircle2, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "info";

const TONE: Readonly<Record<StatusTone, { readonly icon: LucideIcon; readonly className: string }>> = {
  success: { icon: CheckCircle2, className: "text-success" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  danger: { icon: AlertCircle, className: "text-danger" },
  info: { icon: Info, className: "text-info" },
};

/** Status is always icon + text, never color alone (08 §1.3). */
export function StatusText({ tone, children }: { readonly tone: StatusTone; readonly children: ReactNode }) {
  const { icon: Icon, className } = TONE[tone];
  return (
    <span className={`inline-flex items-start gap-1.5 ${className}`}>
      <Icon size={14} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </span>
  );
}

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly children: ReactNode;
}

/** Id of a Field's visible label, for controls that are not labelable elements (sliders). */
export function labelIdFor(id: string): string {
  return `${id}-label`;
}

/** Visible label above every control; never placeholder-only (08 §8). */
export function Field({ id, label, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label id={labelIdFor(id)} htmlFor={id} className="text-caption font-medium text-fg-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-caption text-fg-muted">{hint}</p>}
    </div>
  );
}

export const INPUT_CLASS =
  "h-8 w-full rounded-sm border border-line bg-surface px-2.5 text-ui text-fg transition-colors duration-150 placeholder:text-fg-muted hover:border-fg-muted focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-50";

interface NumberFieldProps {
  readonly id: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly disabled?: boolean;
  /** Called with in-range values only. If the caller ignores it, the field shows `value` again. */
  readonly onCommit: (value: number) => void;
}

/**
 * Numeric input that edits a local draft and commits on blur or Enter. Committing on every
 * keystroke would reject intermediate text such as "-" or "0." and fight the user's typing.
 */
export function NumberField({ id, value, min, max, step, disabled = false, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    const parsed = Number(draft.replace(",", "."));
    if (draft.trim() !== "" && Number.isFinite(parsed) && parsed >= min && parsed <= max) onCommit(parsed);
    // Either way the field goes back to showing the store value (new or unchanged).
    setDraft(null);
  };
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      className={`${INPUT_CLASS} font-mono tabular`}
      value={draft ?? String(value)}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const delta = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
          const next = Math.min(max, Math.max(min, Math.round((value + delta) / step) * step));
          onCommit(Number(next.toFixed(6)));
          setDraft(null);
        }
      }}
    />
  );
}
