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

/**
 * The stopwatch readout, split so each field can be set at its own scale.
 *
 * The face reads `days` on top and `hours:minutes:seconds:milliseconds`
 * beneath it, so every field is here on its own as well as pre-joined - the
 * face captions each group, and a caption needs to know where one ends.
 */
export interface StopwatchParts {
  days: number;
  /** Zero-padded to two digits. */
  hours: string;
  minutes: string;
  seconds: string;
  /** Three digits, `000`-`999`. */
  millis: string;
  /** `HH:MM:SS` within the current day, zero-padded. */
  clock: string;
}

/**
 * Split elapsed time the way a stopwatch face does.
 *
 * Takes fractional seconds because the milliseconds are the point: this app's
 * whole subject is the stopwatch nobody stopped, and a readout that only moves
 * once a second is not that object.
 *
 * The milliseconds are cosmetic by construction. The server stores whole
 * seconds, so this is a local animation running from `streak_start` - which is
 * exactly what the real stopwatch does too, and why it survives a restart.
 */
export function splitStopwatch(elapsedSeconds: number): StopwatchParts {
  // Integer milliseconds, not a fractional subtraction. At 95 days the elapsed
  // float is ~8.2e6, and `x - Math.floor(x)` on a number that large returns
  // 0.4199999... for 0.42, so flooring it would show 419 instead of 420.
  // Scaling to whole milliseconds first keeps every later step exact.
  const total = Math.max(0, Math.round(elapsedSeconds * 1000));
  const whole = Math.floor(total / 1000);
  const days = Math.floor(whole / DAY);
  const rest = whole % DAY;

  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const hours = pad(Math.floor(rest / HOUR));
  const minutes = pad(Math.floor((rest % HOUR) / MINUTE));
  const seconds = pad(rest % MINUTE);

  return {
    days,
    hours,
    minutes,
    seconds,
    // Already an integer, so this is exact rather than rounded: the readout
    // can never show 000 for the next second while the seconds still say this
    // one.
    millis: pad(total % 1000, 3),
    clock: `${hours}:${minutes}:${seconds}`,
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
 * When something happened, for lists of past events: `3 hr ago`, `5 days ago`.
 *
 * Relative for the first month, where "how long since" is the useful answer,
 * and a date after that, where "40 days ago" makes the reader do arithmetic.
 */
export function formatAgo(at: Seconds, now: Seconds): string {
  const since = Math.max(0, Math.floor(now - at));
  if (since < MINUTE) return "just now";
  if (since < HOUR) return `${Math.floor(since / MINUTE)} min ago`;
  if (since < DAY) return `${Math.floor(since / HOUR)} hr ago`;
  const days = Math.floor(since / DAY);
  if (days === 1) return "1 day ago";
  if (days <= 30) return `${days} days ago`;
  return formatDate(at);
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
