import { DAY, HOUR, MINUTE } from "./constants";

/**
 * Seconds since the epoch. The app's single unit of time.
 *
 * Everything the server stores is either one of these or a duration in
 * seconds, so nothing has to be "running" for time to have passed.
 */
export type Seconds = number;

/**
 * A clock that can be corrected against the server.
 *
 * The on-screen counter is cosmetic (see the build prompt: the server is
 * always the source of truth), but a device whose clock is minutes off would
 * show a visibly wrong number. On every sync we record the offset and apply it
 * locally, so drift shows up as a one-frame correction rather than a
 * permanently wrong readout.
 */
export interface Clock {
  now(): Seconds;
}

export class SyncedClock implements Clock {
  private offset: Seconds = 0;

  constructor(private readonly source: () => number = () => Date.now()) {}

  now(): Seconds {
    return Math.floor(this.source() / 1000) + this.offset;
  }

  /** Record the gap between the server's clock and this device's. */
  syncTo(serverNow: Seconds): void {
    this.offset = serverNow - Math.floor(this.source() / 1000);
  }

  get driftSeconds(): Seconds {
    return this.offset;
  }
}

export const systemClock: Clock = { now: () => Math.floor(Date.now() / 1000) };

/** Whole days in a duration, floored. The unit streaks are counted in. */
export function toDays(seconds: Seconds): number {
  return Math.floor(seconds / DAY);
}

/**
 * The ticking readout: `12d 04:31:09`.
 *
 * Fixed-width by construction so a monospace face never reflows as digits
 * change - the reason the prompt specifies JetBrains Mono for this one string.
 */
export function formatElapsed(seconds: Seconds): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const days = Math.floor(clamped / DAY);
  const hours = Math.floor((clamped % DAY) / HOUR);
  const minutes = Math.floor((clamped % HOUR) / MINUTE);
  const secs = clamped % MINUTE;
  const hms = [hours, minutes, secs].map((n) => String(n).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${hms}` : hms;
}

/** The stopwatch readout, split so each field can be set at its own scale. */
export interface StopwatchParts {
  days: number;
  /** `HH:MM:SS` within the current day, zero-padded. */
  clock: string;
  /** Two digits, `00`-`99`. Hundredths, as the iPhone stopwatch shows them. */
  hundredths: string;
}

/**
 * Split elapsed time the way a stopwatch face does.
 *
 * Takes fractional seconds because the hundredths are the point: this app's
 * whole subject is the iPhone stopwatch nobody stopped, and a readout that
 * only moves once a second is not that object.
 *
 * The hundredths are cosmetic by construction. The server stores whole
 * seconds, so this is a local animation running from `streak_start` - which is
 * exactly what the real stopwatch does too, and why it survives a restart.
 */
export function splitStopwatch(elapsedSeconds: number): StopwatchParts {
  // Integer milliseconds, not a fractional subtraction. At 95 days the elapsed
  // float is ~8.2e6, and `x - Math.floor(x)` on a number that large returns
  // 0.4199999... for 0.42, so flooring it would show 41 instead of 42. Scaling
  // to whole milliseconds first keeps every later step exact.
  const ms = Math.max(0, Math.round(elapsedSeconds * 1000));
  const whole = Math.floor(ms / 1000);
  const days = Math.floor(whole / DAY);
  const rest = whole % DAY;

  const hh = Math.floor(rest / HOUR);
  const mm = Math.floor((rest % HOUR) / MINUTE);
  const ss = rest % MINUTE;

  // Floored, never rounded: rounding would let the readout show .00 for the
  // next second a hundredth early, so seconds and hundredths would disagree.
  const hundredths = Math.floor((ms % 1000) / 10);

  return {
    days,
    clock: [hh, mm, ss].map((n) => String(n).padStart(2, "0")).join(":"),
    hundredths: String(hundredths).padStart(2, "0"),
  };
}

/** Human duration for gifts and balances: `3d 4h`, `18h`, `45m`. */
export function formatDuration(seconds: Seconds): string {
  const clamped = Math.max(0, Math.floor(seconds));
  if (clamped < MINUTE) return `${clamped}s`;
  if (clamped < HOUR) return `${Math.floor(clamped / MINUTE)}m`;
  if (clamped < DAY) {
    const h = Math.floor(clamped / HOUR);
    const m = Math.floor((clamped % HOUR) / MINUTE);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(clamped / DAY);
  const h = Math.floor((clamped % DAY) / HOUR);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

/** Coarse countdown for the check-in window: `23 days left`. */
export function formatRemaining(seconds: Seconds): string {
  const clamped = Math.max(0, Math.floor(seconds));
  if (clamped === 0) return "window closed";
  if (clamped < HOUR) return `${Math.max(1, Math.floor(clamped / MINUTE))} min left`;
  if (clamped < DAY) return `${Math.floor(clamped / HOUR)} hr left`;
  const days = Math.floor(clamped / DAY);
  return days === 1 ? "1 day left" : `${days} days left`;
}

/**
 * Fixed to en-US rather than the device locale: the rest of the interface is
 * English, and a German month name beside English labels reads as a bug. Swap
 * this for the active locale when the app is actually localised.
 */
export function formatDate(seconds: Seconds): string {
  return new Date(seconds * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
