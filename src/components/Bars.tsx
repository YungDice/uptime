import { formatRemaining, type Seconds } from "@/core";

/**
 * The check-in window, as ambient awareness rather than a daily grid.
 *
 * A seven-day strip would be lying about a sixty-day cycle. This reads full
 * right after a check-in and dims as the window runs down, which is the only
 * thing a user needs to know about a mechanic they will usually never meet.
 */
export function WindowBar({ fraction, remaining }: { fraction: number; remaining: Seconds }) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  const low = fraction <= 0.12;

  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[0.68rem] font-semibold tracking-[0.18em] text-muted uppercase">
          check-in window
        </span>
        <span className={`text-xs ${low ? "text-ember" : "text-muted"}`}>
          {formatRemaining(remaining)}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Check-in window remaining"
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            background: low ? "var(--color-ember)" : "var(--color-pulse)",
            opacity: 0.35 + fraction * 0.65,
          }}
        />
      </div>
    </div>
  );
}

/** Progress to the next threshold. Same shape as the references, recoloured. */
export function MilestoneBar({
  fraction,
  nextDays,
  daysRemaining,
}: {
  fraction: number;
  nextDays: number | null;
  daysRemaining: number;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);

  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[0.68rem] font-semibold tracking-[0.18em] text-muted uppercase">
          next milestone
        </span>
        <span className="text-xs text-muted">
          {nextDays === null
            ? "every milestone cleared"
            : `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} to ${nextDays}`}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progress to next milestone"
      >
        <div
          className="h-full rounded-full bg-pulse transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** A compact fact. Two of these sit under the hero. */
export function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-surface px-4 py-3">
      <span className="text-[0.62rem] font-semibold tracking-[0.16em] text-muted uppercase">
        {label}
      </span>
      <span className="text-sm font-medium text-ink-text">{value}</span>
    </div>
  );
}
