import { useState } from "react";
import { DAY, HOUR, checkGift, formatDuration, type Seconds } from "@/core";
import type { FriendView } from "@/data/store";

interface Props {
  friend: FriendView;
  balance: Seconds;
  sentToday: Seconds;
  onCancel(): void;
  onConfirm(amount: Seconds): void;
}

const PRESETS: Seconds[] = [HOUR, 6 * HOUR, DAY, 3 * DAY, 7 * DAY];

/**
 * The amount picker.
 *
 * Presets only. Time is the unit of the whole app, so letting someone type
 * "90000" seconds would be inviting a mistake in the one place the app has an
 * irreversible action.
 */
export function SendSheet({ friend, balance, sentToday, onCancel, onConfirm }: Props) {
  const affordable = PRESETS.filter((p) => p <= balance);
  const [amount, setAmount] = useState<Seconds>(affordable[0] ?? 0);

  const check = checkGift(amount, {
    senderBalance: balance,
    sentInLastDay: sentToday,
    connected: true,
    isSelf: false,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/80 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Send time to ${friend.profile.displayName}`}
      onClick={onCancel}
    >
      <div
        className="animate-fade-up w-full max-w-md rounded-t-3xl bg-surface p-6 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink-text">
          Send time to {friend.profile.displayName}
        </h2>
        <p className="mt-1 text-sm text-muted">
          You have {formatDuration(balance)} banked. Giving it away never shortens your own streak.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {PRESETS.map((preset) => {
            const disabled = preset > balance;
            const selected = preset === amount;
            return (
              <button
                key={preset}
                type="button"
                disabled={disabled}
                onClick={() => setAmount(preset)}
                className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                  selected
                    ? "bg-ember/20 text-ember"
                    : "bg-surface-2 text-ink-text hover:bg-surface-2/70"
                } disabled:cursor-not-allowed disabled:bg-surface-2/40 disabled:text-muted`}
              >
                {formatDuration(preset)}
              </button>
            );
          })}
        </div>

        {!check.ok ? <p className="mt-4 text-sm text-danger">{check.message}</p> : null}

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl bg-surface-2 px-4 py-3 text-sm font-semibold text-ink-text transition-colors hover:bg-surface-2/70"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!check.ok}
            onClick={() => onConfirm(amount)}
            className="flex-1 rounded-xl bg-ember px-4 py-3 text-sm font-semibold text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted"
          >
            Send {check.ok ? formatDuration(amount) : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
