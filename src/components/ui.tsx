/** Small design-system primitives (PRD 08 §8). Semantic token classes only, no raw hex. */
import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

const VARIANT_CLASS: Readonly<Record<ButtonVariant, string>> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "bg-surface text-fg border border-line hover:bg-hover",
  ghost: "text-fg-2 hover:bg-hover hover:text-fg",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly icon?: LucideIcon;
  readonly loading?: boolean;
}

export function Button({ variant = "secondary", icon: Icon, loading = false, disabled, children, className, ...rest }: ButtonProps) {
  const LeadingIcon = loading ? Loader2 : Icon;
  return (
    <button
      type="button"
      disabled={disabled === true || loading}
      aria-busy={loading}
      className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASS[variant]} ${className ?? ""}`}
      {...rest}
    >
      {LeadingIcon && <LeadingIcon size={16} strokeWidth={1.75} className={loading ? "animate-spin" : undefined} aria-hidden />}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly pressed?: boolean;
}

/** Icon-only button: label doubles as aria-label and tooltip (08 §8, §10). */
export function IconButton({ icon: Icon, label, pressed, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`inline-flex size-8 items-center justify-center rounded-md transition-colors duration-150 ${
        pressed === true ? "bg-accent-subtle text-accent" : "text-fg-2 hover:bg-hover hover:text-fg"
      } ${className ?? ""}`}
      {...rest}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

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
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Icon size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
      <span>{children}</span>
    </span>
  );
}

export function Card({ title, actions, children }: { readonly title: string; readonly actions?: ReactNode; readonly children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line-subtle bg-panel" aria-label={title}>
      <header className="flex h-11 items-center justify-between border-b border-line-subtle px-4">
        <h2 className="panel-title">{title}</h2>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}

/** Visible label above every control; never placeholder-only (08 §8). */
export function Field({ id, label, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] font-medium text-fg-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-[12px] text-fg-muted">{hint}</p>}
    </div>
  );
}

export const INPUT_CLASS =
  "h-8 w-full rounded-sm border border-line bg-surface px-2.5 text-[13px] text-fg placeholder:text-fg-muted hover:border-fg-muted focus-visible:outline-2 focus-visible:outline-offset-0";

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
