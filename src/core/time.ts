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
 * Elapsed split for the hero: a dominant day count and the ticking remainder.
 *
 * The references all lead with one big number and the whole string `95d
 * 00:00:01` is too wide to sit inside the ring at phone width. Splitting keeps
 * the dominant number legible without giving up the stopwatch tick.
 */
export function splitElapsed(seconds: Seconds): { days: number; hms: string } {
  const clamped = Math.max(0, Math.floor(seconds));
  return { days: Math.floor(clamped / DAY), hms: formatElapsed(clamped % DAY) };
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
