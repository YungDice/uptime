import { DAY, MILESTONE_DAYS } from "./constants";
import type { Seconds } from "./time";

export interface MilestoneProgress {
  /** The last milestone cleared, in days. Null before the first one. */
  previousDays: number | null;
  /** The one being worked toward. Null once the ladder is exhausted. */
  nextDays: number | null;
  /** 0-1 across the gap between them, for the bar. */
  fraction: number;
  /** Whole days still to go. */
  daysRemaining: number;
}

/**
 * Where the current run sits on the milestone ladder.
 *
 * The fraction spans the gap between the last milestone and the next, not zero
 * to the next - so the bar fills steadily instead of resetting to nearly-full
 * every time a threshold is crossed.
 */
export function milestoneProgress(
  elapsed: Seconds,
  ladder: readonly number[] = MILESTONE_DAYS,
): MilestoneProgress {
  const days = elapsed / DAY;

  let previousDays: number | null = null;
  let nextDays: number | null = null;

  for (const mark of ladder) {
    if (days >= mark) previousDays = mark;
    else {
      nextDays = mark;
      break;
    }
  }

  if (nextDays === null) {
    return { previousDays, nextDays: null, fraction: 1, daysRemaining: 0 };
  }

  const floor = previousDays ?? 0;
  const span = nextDays - floor;
  const fraction = span <= 0 ? 0 : Math.min(1, Math.max(0, (days - floor) / span));

  return {
    previousDays,
    nextDays,
    fraction,
    daysRemaining: Math.max(0, Math.ceil(nextDays - days)),
  };
}
