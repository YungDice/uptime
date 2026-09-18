import { isRunning, splitElapsed, type StreakStatus } from "@/core";

interface Props {
  /** Derived against the ticking clock by the caller, not stored. */
  status: StreakStatus;
}

/**
 * The one bold element on the screen: a breathing ring around the live
 * counter, floating on the background with no card behind it.
 *
 * The ring is the app's own motif rather than a borrowed flame - it echoes the
 * heartbeat that keeps a streak alive, so the thing that moves is the thing
 * the mechanic is actually about.
 */
export function PulseHero({ status }: Props) {
  const live = isRunning(status);
  const elapsed = live ? status.elapsed : status.kind === "lapsed" ? status.length : 0;
  const { days, hms } = splitElapsed(elapsed);

  const accent = live
    ? status.kind === "expiring"
      ? "var(--color-ember)"
      : "var(--color-pulse)"
    : status.kind === "lapsed"
      ? "var(--color-danger)"
      : "var(--color-muted)";

  // Only a running streak breathes. A stopped clock should look stopped.
  const ringMotion = live ? "animate-breathe" : "";
  const glowMotion = live ? "animate-breathe-soft" : "";

  return (
    <section
      className="relative flex flex-col items-center justify-center py-8"
      aria-label="Current streak"
    >
      <div className="relative flex h-72 w-72 items-center justify-center sm:h-80 sm:w-80">
        <div
          className={`absolute inset-8 rounded-full blur-2xl ${glowMotion}`}
          style={{ background: accent, opacity: live ? 0.22 : 0.07 }}
          aria-hidden="true"
        />

        <svg
          viewBox="0 0 200 200"
          className={`absolute inset-0 h-full w-full ${ringMotion}`}
          aria-hidden="true"
        >
          <circle cx="100" cy="100" r="92" fill="none" stroke={accent} strokeWidth="1" opacity="0.25" />
          <circle cx="100" cy="100" r="84" fill="none" stroke={accent} strokeWidth="2.5" opacity="0.85" />
          <circle cx="100" cy="100" r="74" fill="none" stroke={accent} strokeWidth="0.75" opacity="0.18" />
        </svg>

        <div className="relative z-10 flex flex-col items-center px-6 text-center">
          <div
            className="tnum font-mono leading-none font-medium"
            style={{ fontSize: "clamp(3rem, 15vw, 4.25rem)", letterSpacing: "-0.03em", color: accent }}
          >
            {days}
          </div>
          <div className="mt-2.5 text-[0.68rem] font-semibold tracking-[0.24em] text-muted uppercase">
            {labelFor(status)}
          </div>
          {/* The stopwatch tick, kept as a quiet second line so the dominant
              number stays a single glanceable figure. */}
          <div
            className="tnum mt-2 font-mono text-sm text-muted/80"
            role="timer"
            aria-live="off"
            aria-label="Time on the current day"
          >
            {hms}
          </div>
        </div>
      </div>
    </section>
  );
}

function labelFor(status: StreakStatus): string {
  switch (status.kind) {
    case "alive":
      return status.elapsed >= 86400 ? "day streak" : "uptime";
    case "expiring":
      return "check in soon";
    case "lapsed":
      return "streak reset";
    case "idle":
      return "not running";
  }
}
