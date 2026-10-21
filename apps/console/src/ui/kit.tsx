/**
 * The Rosh 27 component kit, as React. Styling lives in styles/components.css;
 * these components only pick the right classes and keep the accessibility rules
 * (status always carries a word, icons are hidden from screen readers unless labelled).
 */
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { ICON_POINTS, type IconName } from "./icon-points";

export type { IconName };
export type Tone = "positive" | "caution" | "alarm" | "info" | "tint" | "neutral";

export function Icon({ name, fill, weight, size, className = "", label, style }: { name: IconName; fill?: boolean; weight?: number; size?: number; className?: string; label?: string; style?: CSSProperties }) {
  const s = { ...(size ? { fontSize: size } : {}), ...(fill ? { "--icon-fill": 1 } : {}), ...(weight ? { "--icon-wght": weight } : {}), ...style } as CSSProperties;
  return (
    <span className={`icon ${className}`} style={s} aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
      {String.fromCodePoint(ICON_POINTS[name])}
    </span>
  );
}

export function Spinner({ className = "", label }: { className?: string; label?: string }) {
  return <span className={`spinner ${className}`} role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: "prominent" | "tinted" | "gray" | "outline" | "plain" | "destructive" | "glass";
  size?: "mini" | "small" | "regular" | "large" | "hero";
  icon?: IconName;
  iconAfter?: IconName;
  iconOnly?: boolean;
  loading?: boolean;
};

export function Button({ variant = "gray", size = "regular", icon, iconAfter, iconOnly, loading, className = "", children, type = "button", ...rest }: ButtonProps) {
  const cls = ["btn", `btn-${variant}`, size !== "regular" ? `btn-${size}` : "", iconOnly ? "btn-icon" : "", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} data-loading={loading ? "true" : undefined} aria-busy={loading || undefined} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
      {iconAfter && <Icon name={iconAfter} />}
      {loading && <Spinner />}
    </button>
  );
}

const TONE_ICON: Partial<Record<Tone, IconName>> = { positive: "check_circle", caution: "warning", alarm: "error", info: "info" };

export function Tag({ tone = "neutral", icon, dot, children, className = "", title }: { tone?: Tone; icon?: IconName; dot?: boolean; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={`tag ${tone !== "neutral" ? `tag-${tone}` : ""} ${dot ? "tag-dot" : ""} ${className}`} title={title}>
      {icon && <Icon name={icon} fill />}
      {children}
    </span>
  );
}

export function Banner({ tone = "info", icon, busy, title, children, className = "", role }: { tone?: Tone; icon?: IconName; busy?: boolean; title?: ReactNode; children?: ReactNode; className?: string; role?: string }) {
  const glyph = icon ?? TONE_ICON[tone] ?? "info";
  return (
    <div className={`banner ${tone === "neutral" ? "banner-neutral" : tone !== "info" ? `banner-${tone}` : ""} ${className}`} role={role}>
      {busy ? <Spinner /> : <Icon name={glyph} />}
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={title ? "mt-0.5 text-label-2" : ""}>{children}</div>}
      </div>
    </div>
  );
}

export function Seal({ tone = "neutral", icon, size = 56, className = "" }: { tone?: Tone; icon: IconName; size?: number; className?: string }) {
  return (
    <span className={`seal ${tone !== "neutral" ? `seal-${tone}` : ""} ${className}`} style={{ "--seal": `${size}px` } as CSSProperties} aria-hidden>
      <Icon name={icon} fill />
    </span>
  );
}

export function Card({ children, className = "", pad = true, as: As = "section", ...rest }: { children: ReactNode; className?: string; pad?: boolean; as?: "section" | "div" | "aside" | "article" } & Record<string, unknown>) {
  return (
    <As className={`card ${pad ? "card-pad" : ""} ${className}`} {...rest}>
      {children}
    </As>
  );
}

/** Card header: Heading title, optional caption beneath, accessories trailing. */
export function CardHeader({ title, caption, icon, children, className = "", id }: { title: ReactNode; caption?: ReactNode; icon?: IconName; children?: ReactNode; className?: string; id?: string }) {
  return (
    <header className={`flex items-start justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <Icon name={icon} size={20} className="mt-px text-label-2" />}
        <div className="min-w-0">
          <h2 id={id} className="text-heading text-label-1">
            {title}
          </h2>
          {caption && <p className="mt-0.5 text-footnote text-label-2">{caption}</p>}
        </div>
      </div>
      {children && <div className="flex flex-none flex-wrap items-center justify-end gap-2">{children}</div>}
    </header>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, className = "" }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label?: string; icon?: IconName; title?: string }>; label: string; className?: string }) {
  return (
    <div className={`seg ${className}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} title={o.title} aria-label={o.label ? undefined : o.title}>
          {o.icon && <Icon name={o.icon} fill={o.value === value} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Live({ connected }: { connected: boolean }) {
  return (
    <span className="live" data-state={connected ? "on" : "off"} role="status" title={connected ? "Receiving live updates" : "Reconnecting to the server"}>
      {connected ? "Live" : "Reconnecting"}
    </span>
  );
}

export function Empty({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-glyph">
        <Icon name={icon} />
      </div>
      <h2 className="mt-4 text-title-3">{title}</h2>
      {children && <p className="mt-1.5 max-w-[34ch] text-footnote text-label-2">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** The HomePulse mark: Champagne silk tile with a white shield. */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <span className="mark" style={{ "--size": `${size}px` } as CSSProperties} aria-hidden>
      <Icon name="shield_lock" />
    </span>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-[-0.03em] ${className}`}>
      Home<span className="text-tint">Pulse</span>
    </span>
  );
}

/** "ALLOWED" from the server reads as "Allowed": sentence case everywhere. */
export function sentence(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

/** Inline style for the staggered entrance (24 ms per item, capped at 8 in CSS). */
export const stagger = (i: number) => ({ "--i": i }) as CSSProperties;
