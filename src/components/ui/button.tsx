/** Buttons (08 §8). Semantic token classes only, no raw hex. */
import { Loader2, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { Tooltip, type TooltipSide } from "./tooltip";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const VARIANT_CLASS: Readonly<Record<ButtonVariant, string>> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover active:brightness-95",
  secondary: "bg-surface text-fg border border-line hover:bg-hover hover:border-fg-muted active:bg-selected",
  ghost: "text-fg-2 hover:bg-hover hover:text-fg active:bg-selected",
  danger: "bg-surface text-danger border border-danger/50 hover:bg-danger hover:text-on-accent hover:border-danger",
};

const SIZE_CLASS: Readonly<Record<ButtonSize, string>> = {
  sm: "h-7 gap-1.5 px-2.5",
  md: "h-8 gap-2 px-3",
};

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: LucideIcon;
  readonly loading?: boolean;
  /** Optional tooltip; also explains why a disabled button is disabled. */
  readonly tooltip?: string;
  readonly shortcut?: string;
}

export function Button({ variant = "secondary", size = "md", icon: Icon, loading = false, tooltip, shortcut, disabled, children, className, ...rest }: ButtonProps) {
  const LeadingIcon = loading ? Loader2 : Icon;
  const isDisabled = disabled === true || loading;
  const button = (
    <button
      type="button"
      disabled={isDisabled}
      aria-busy={loading}
      className={`inline-flex shrink-0 items-center justify-center rounded-md text-ui font-medium whitespace-nowrap transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${className ?? ""}`}
      {...rest}
    >
      {LeadingIcon && <LeadingIcon size={16} strokeWidth={1.75} className={loading ? "animate-spin" : undefined} aria-hidden />}
      {children}
    </button>
  );
  if (tooltip === undefined && shortcut === undefined) return button;
  return (
    <Tooltip content={tooltip ?? children} shortcut={shortcut} disabled={isDisabled}>
      {button}
    </Tooltip>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly shortcut?: string;
  readonly pressed?: boolean;
  readonly tooltipSide?: TooltipSide;
  readonly size?: ButtonSize;
}

/** Icon-only button: label doubles as aria-label and tooltip (08 §8, §10). */
export function IconButton({ icon: Icon, label, shortcut, pressed, tooltipSide, size = "md", disabled, className, ...rest }: IconButtonProps) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide} disabled={disabled === true}>
      <button
        type="button"
        aria-label={shortcut ? `${label} (${shortcut})` : label}
        aria-pressed={pressed}
        disabled={disabled}
        className={`inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
          size === "sm" ? "size-7" : "size-8"
        } ${pressed === true ? "bg-accent-subtle text-accent hover:bg-accent-subtle" : "text-fg-2 hover:bg-hover hover:text-fg active:bg-selected"} ${className ?? ""}`}
        {...rest}
      >
        <Icon size={16} strokeWidth={1.75} aria-hidden />
      </button>
    </Tooltip>
  );
}
