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
        <h2 className="flex items-center gap-2.5 px-5 pb-2 text-[12px] font-semibold tracking-[0.1em] text-label-2 uppercase">
          {title}
          {/* A rule running out from the label to the edge. The heading used to
              float above a full-width hairline that belonged to the rows below
              it, so it read as a caption for the gap rather than for the list. */}
          <span aria-hidden="true" className="h-px flex-1 bg-hairline opacity-60" />
        </h2>
      ) : null}
      {/* The section's leading rule is inset to the same margin the rows
          use, and the rows supply that margin themselves - so the inset has
          exactly one definition instead of one per container. */}
      <div className="ml-5 h-px bg-hairline" />
      {children}
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
    <div className="hairline relative flex min-h-[52px] items-center gap-3 overflow-hidden py-2.5 pr-5">
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

  const className = "w-full pl-5 text-left";

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
  solid,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "run" | "bank" | "lapse" | "neutral";
  disabled?: boolean;
  wide?: boolean;
  pressed?: boolean;
  /**
   * Struck in the colour rather than tinted with it.
   *
   * Exactly one control on a screen may be solid. The tinted capsule is the
   * app's default because a screen of solid buttons has no primary action, and
   * the home screen genuinely does have one - the tinted Stop and the tinted
   * check-in were the same object at the same weight, which is how a
   * destructive control ends up looking like the thing you press every day.
   */
  solid?: boolean;
  /**
   * Defaults to "button" so a capsule dropped inside a form cannot submit it by
   * accident. A capsule that *is* the form's submit control has to say so - and
   * must, because a form whose only control is a plain button has no way to be
   * submitted at all: with more than one text field, the browser's implicit
   * Enter-to-submit is suppressed too.
   */
  type?: "button" | "submit";
}) {
  const color =
    tone === "run"
      ? "var(--color-run)"
      : tone === "bank"
        ? "var(--color-bank)"
        : tone === "lapse"
          ? "var(--color-lapse)"
          : "var(--color-label)";

  const shared = `${wide ? "flex-1" : ""} ${
    pressed ? "animate-confirm" : ""
  } rounded-full px-6 py-3.5 text-[17px] font-semibold tracking-[-0.01em] transition-transform duration-150 active:scale-[0.97] disabled:scale-100 disabled:opacity-40`;

  if (disabled) {
    return (
      <button type={type} disabled className={shared} style={{ color: "var(--color-label-3)", background: "var(--color-raise)" }}>
        {children}
      </button>
    );
  }

  if (solid && tone !== "neutral") {
    return (
      <button
        type={type}
        onClick={onClick}
        className={shared}
        style={{
          // Black on the accent, not white: these three colours are all light
          // enough that white type on them fails contrast, and the Clock app's
          // own filled controls are dark-on-colour for the same reason.
          color: "#0b0b0c",
          background: `var(--grad-${tone})`,
          boxShadow: `inset 0 1px 0 0 rgb(255 255 255 / 40%), 0 8px 22px -10px color-mix(in srgb, ${color} 85%, transparent)`,
        }}
      >
        {children}
      </button>
    );
  }

  // Neutral is furniture: a plain raised surface, because a white "tint" is
  // just a brighter grey and it came out louder than the coloured capsules it
  // was meant to sit behind.
  if (tone === "neutral") {
    return (
      <button type={type} onClick={onClick} className={`surface-2 ${shared}`} style={{ color }}>
        {children}
      </button>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      className={`surface-tint ${shared}`}
      style={{ color, ["--tint" as string]: color }}
    >
      {children}
    </button>
  );
}
