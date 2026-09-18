import { useState } from "react";
import { DAY, HOUR, checkGift, formatDuration, type Seconds } from "@/core";
import type { FriendView } from "@/data/store";
import { Capsule } from "./List";

interface Props {
  friend: FriendView;
  balance: Seconds;
  sentToday: Seconds;
  onCancel(): void;
  onConfirm(amount: Seconds): void;
}

const PRESETS: Seconds[] = [HOUR, 6 * HOUR, DAY, 3 * DAY, 7 * DAY];

/**
 * The Clock app's sheet: a rounded panel rising from the bottom edge over a
 * dimmed field. Presets only - time is this app's unit, and letting someone
 * type a number of seconds invites a mistake in the one irreversible action.
 */
export function SendSheet({ friend, balance, sentToday, onCancel, onConfirm }: Props) {
  const affordable = PRESETS.filter((p) => p <= balance);
  const [amount, setAmount] = useState<Seconds>(affordable[0] ?? 0);

  const check = checkGift(amount, {
    senderBalance: balance,
    sentInLastDay: sentToday,
    connected: friend.connected,
    isSelf: false,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "color-mix(in srgb, var(--color-void) 62%, transparent)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Send time to ${friend.profile.displayName}`}
      onClick={onCancel}
    >
      <div
        className="animate-rise w-full max-w-md rounded-t-[22px] border-t border-hairline bg-raise px-5 pt-5 pb-8"
        style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-5 h-1 w-9 rounded-full bg-raise-2" aria-hidden="true" />

        <h2 className="text-[20px] font-semibold text-label">
          Send time to {friend.profile.displayName}
        </h2>
        <p className="mt-1.5 text-[15px] text-label-2">
          You have <span className="tnum text-bank">{formatDuration(balance)}</span> banked. Giving
          it away never shortens your own streak.
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
                className="tnum rounded-full px-4 py-2.5 text-[15px] font-medium disabled:opacity-30"
                style={{
                  color: selected ? "var(--color-bank)" : "var(--color-label)",
                  background: selected
                    ? "color-mix(in srgb, var(--color-bank) 20%, transparent)"
                    : "var(--color-raise-2)",
                }}
              >
                {formatDuration(preset)}
              </button>
            );
          })}
        </div>

        {!check.ok ? <p className="mt-4 text-[13px] text-lapse">{check.message}</p> : null}

        <div className="mt-6 flex gap-3">
          <Capsule wide onClick={onCancel}>
            Cancel
          </Capsule>
          <Capsule tone="bank" wide disabled={!check.ok} onClick={() => onConfirm(amount)}>
            Send {check.ok ? formatDuration(amount) : ""}
          </Capsule>
        </div>
      </div>
    </div>
  );
}
