import type { ReactNode } from "react";

/**
 * The Clock app's plain list, not a grouped one: full-bleed rows divided by
 * hairlines, inset from the left the way a lap list is. No cards anywhere in
 * this app - a card would be the one thing the source material never does.
 */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      {title ? (
        <h2 className="px-5 pb-2 text-[13px] font-semibold tracking-[0.06em] text-label-2 uppercase">
          {title}
        </h2>
      ) : null}
      <div className="border-t border-hairline">{children}</div>
    </section>
  );
}

export function Row({
  label,
  value,
  tone = "default",
  sub,
  onClick,
  trailing,
  trailAnimation,
}: {
  label: ReactNode;
  value?: ReactNode;
  tone?: "default" | "run" | "bank" | "lapse";
  sub?: ReactNode;
  onClick?: () => void;
  trailing?: ReactNode;
  /** Plays the handoff sweep along this row when time lands on it. */
  trailAnimation?: boolean;
}) {
  const valueColor =
    tone === "run"
      ? "text-run"
      : tone === "bank"
        ? "text-bank"
        : tone === "lapse"
          ? "text-lapse"
          : "text-label-2";

  const body = (
    <div className="relative flex min-h-[52px] items-center gap-3 overflow-hidden py-2.5 pr-5">
      {trailAnimation ? (
        <span
          aria-hidden="true"
          className="animate-handoff pointer-events-none absolute inset-y-0 left-0 w-1/2"
          style={{
            background:
              "linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-bank) 55%, transparent), transparent)",
          }}
        />
      ) : null}
      <div className="relative min-w-0 flex-1">
        <div className="truncate text-[17px] text-label">{label}</div>
        {sub ? <div className="mt-0.5 text-[13px] text-label-2">{sub}</div> : null}
      </div>
      {value !== undefined ? (
        <div className={`tnum relative shrink-0 text-[17px] ${valueColor}`}>{value}</div>
      ) : null}
      {trailing ? <div className="relative shrink-0">{trailing}</div> : null}
    </div>
  );

  const className = "hairline w-full pl-5 text-left";

  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} active:bg-raise`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * The Clock's capsule button: a tinted fill at low alpha with the full-strength
 * colour as the label, so a control reads as its system at a glance.
 */
export function Capsule({
  children,
  onClick,
  tone = "neutral",
  disabled,
  wide,
  pressed,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "run" | "bank" | "lapse" | "neutral";
  disabled?: boolean;
  wide?: boolean;
  pressed?: boolean;
}) {
  const color =
    tone === "run"
      ? "var(--color-run)"
      : tone === "bank"
        ? "var(--color-bank)"
        : tone === "lapse"
          ? "var(--color-lapse)"
          : "var(--color-label)";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${wide ? "flex-1" : ""} ${pressed ? "animate-confirm" : ""} rounded-full px-6 py-3.5 text-[17px] font-medium transition-[background-color,opacity] disabled:opacity-35`}
      style={{
        color: disabled ? "var(--color-label-3)" : color,
        background: disabled
          ? "var(--color-raise)"
          : `color-mix(in srgb, ${color} 18%, transparent)`,
      }}
    >
      {children}
    </button>
  );
}
