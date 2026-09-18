import { DAY, MAX_SENT_PER_DAY, formatDuration, type Seconds } from "@/core";

interface Props {
  balance: Seconds;
  sent: Seconds;
  received: Seconds;
  sentToday: Seconds;
  onSend(): void;
  onRevive(): void;
  reviveCount: number;
}

/**
 * Banked time, in --ember.
 *
 * The colour split is the whole point: everything about the streak is
 * --pulse, everything spendable is --ember, so a user never has to read a
 * label to know which of the two systems a number belongs to.
 */
export function BankedCard({
  balance,
  sent,
  received,
  sentToday,
  onSend,
  onRevive,
  reviveCount,
}: Props) {
  const capLeft = Math.max(0, MAX_SENT_PER_DAY - sentToday);
  const nearCap = capLeft < DAY;

  return (
    <section
      className="rounded-2xl bg-surface p-5"
      style={{ boxShadow: "inset 0 0 0 1px rgba(232, 179, 76, 0.16)" }}
      aria-label="Banked time"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[0.62rem] font-semibold tracking-[0.16em] text-muted uppercase">
            banked time
          </div>
          <div className="tnum mt-1 font-mono text-3xl font-medium text-ember">
            {formatDuration(balance)}
          </div>
        </div>
        <div className="text-right text-xs text-muted">
          <div>
            gave <span className="text-ink-text">{formatDuration(sent)}</span>
          </div>
          <div className="mt-0.5">
            got <span className="text-ink-text">{formatDuration(received)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onSend}
          disabled={balance <= 0}
          className="flex-1 rounded-xl bg-ember/12 px-4 py-2.5 text-sm font-semibold text-ember transition-colors hover:bg-ember/20 disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-ember/12"
        >
          Send time
        </button>
        <button
          type="button"
          onClick={onRevive}
          disabled={reviveCount === 0}
          className="flex-1 rounded-xl bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink-text transition-colors hover:bg-surface-2/70 disabled:cursor-not-allowed disabled:text-muted"
        >
          {reviveCount > 0 ? `Revive a friend (${reviveCount})` : "Revive a friend"}
        </button>
      </div>

      {nearCap ? (
        <p className="mt-3 text-xs text-muted">
          {capLeft <= 0
            ? "You have hit today's sending limit. It resets on a rolling 24 hours."
            : `${formatDuration(capLeft)} left to send today.`}
        </p>
      ) : null}
    </section>
  );
}
