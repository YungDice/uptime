import { useState } from "react";
import {
  DAY,
  HOUR,
  MAX_SENT_PER_DAY,
  MINUTE,
  checkGift,
  formatDuration,
  formatElapsed,
  type Seconds,
} from "@/core";
import type { SendTarget } from "@/data/store";
import { Avatar } from "./Avatar";
import { Capsule } from "./List";
import { Sheet } from "./Sheet";

interface Props {
  /**
   * Structurally the smallest thing a send needs, so the same sheet opens from
   * a friend row and from a stranger's profile without either shape having to
   * know about the other.
   */
  friend: SendTarget;
  /** The live figure, recomputed by the caller on every tick. */
  giveable: Seconds;
  sentToday: Seconds;
  onCancel(): void;
  onConfirm(amount: Seconds): void;
}

/** Round amounts, offered only when there is enough to cover them. */
const PRESETS: Seconds[] = [5 * MINUTE, HOUR, 6 * HOUR, DAY, 7 * DAY];

/**
 * Sending, sized against what you actually have.
 *
 * This used to be five fixed presets starting at one hour, with the amount
 * defaulting to the first affordable one. On any account that had not been
 * running for half a day, *every* preset was greyed out, the default fell
 * through to zero, and the confirm button refused with "Pick an amount of time
 * to send" - above a screen that was, at that moment, telling the user they had
 * thirteen minutes to give. The feature was unreachable for exactly the people
 * most likely to try it.
 *
 * So the amount is a continuous choice between one minute and everything, and
 * the ceiling is the live figure rather than a snapshot of it: with the clock
 * running it rises while the sheet is open, and picking Max follows it up.
 */
export function SendSheet({ friend, giveable, sentToday, onCancel, onConfirm }: Props) {
  // The rolling cap is part of the ceiling, not a refusal after the fact. A
  // slider that lets you pick an amount the server will reject is a worse
  // control than one that cannot reach it.
  const allowance = Math.max(0, MAX_SENT_PER_DAY - sentToday);
  const max = Math.min(giveable, allowance);

  const [chosen, setChosen] = useState<Seconds>(() => Math.floor(max / 2));
  // Max is a standing instruction rather than a value, because the value it
  // means is still going up while this sheet is open.
  const [followMax, setFollowMax] = useState(false);

  const amount = Math.max(0, Math.min(followMax ? max : chosen, max));
  const step = stepFor(max);

  const check = checkGift(amount, {
    senderBalance: giveable,
    sentInLastDay: sentToday,
    connected: friend.connected,
    isSelf: false,
  });

  const pick = (value: Seconds) => {
    setFollowMax(false);
    setChosen(Math.max(0, Math.min(value, max)));
  };

  return (
    <Sheet label={`Send time to ${friend.profile.displayName}`} onClose={onCancel}>
      <header className="flex items-center gap-3">
        <Avatar profile={friend.profile} size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[20px] font-semibold tracking-[-0.01em] text-label">
            Send to {friend.profile.displayName}
          </h2>
          <p className="truncate text-[13px] text-label-2">@{friend.profile.handle}</p>
        </div>
      </header>

      {/* The amount, at the scale of the thing being decided. */}
      <div className="mt-6 flex items-baseline justify-center gap-2">
        <span
          className="tnum text-[42px] leading-none font-light tracking-[-0.03em]"
          style={{ color: amount > 0 ? "var(--color-bank)" : "var(--color-label-3)" }}
        >
          {formatElapsed(amount)}
        </span>
      </div>
      <p className="mt-1.5 text-center text-[13px] text-label-2">
        of <span className="tnum">{formatElapsed(max)}</span> you can give
        {allowance < giveable ? " today" : ""}
      </p>

      <div className="mt-5">
        <input
          type="range"
          min={0}
          max={Math.max(step, max)}
          step={step}
          value={amount}
          disabled={max <= 0}
          onChange={(event) => pick(Number(event.target.value))}
          aria-label="Amount of time to send"
          className="range-bank w-full"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {PRESETS.filter((preset) => preset <= max).map((preset) => (
          <Chip key={preset} on={!followMax && amount === preset} onClick={() => pick(preset)}>
            {formatDuration(preset)}
          </Chip>
        ))}
        {max > 0 ? (
          <Chip
            on={followMax}
            onClick={() => {
              setFollowMax(true);
              setChosen(max);
            }}
          >
            Max
          </Chip>
        ) : null}
      </div>

      <p className="mt-4 text-[13px] text-label-2">
        {max <= 0 && allowance <= 0
          ? "You've hit today's sending limit. It resets on a rolling 24 hours."
          : max <= 0
            ? "Nothing to give yet. Your clock has to run a while first."
            : "Giving time away never shortens your own streak."}
      </p>

      {!check.ok && max > 0 && amount > 0 ? (
        <p className="mt-2 text-[13px] text-lapse">{check.message}</p>
      ) : null}

      <div className="mt-6 flex gap-3">
        <Capsule wide onClick={onCancel}>
          Cancel
        </Capsule>
        <Capsule tone="bank" solid wide disabled={!check.ok} onClick={() => onConfirm(amount)}>
          Send
        </Capsule>
      </div>
    </Sheet>
  );
}

function Chip({
  children,
  on,
  onClick,
}: {
  children: React.ReactNode;
  on: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tnum rounded-full px-3.5 py-2 text-[13px] font-semibold transition-transform active:scale-95 ${
        on ? "surface-tint" : "surface-2"
      }`}
      style={
        on
          ? { color: "var(--color-bank)", ["--tint" as string]: "var(--color-bank)" }
          : { color: "var(--color-label)" }
      }
    >
      {children}
    </button>
  );
}

/**
 * How coarse the slider is, scaled to what is on it.
 *
 * A fixed step is wrong at both ends: one second across seven days is 604,800
 * positions, and five minutes across a twelve-minute balance is three. The
 * granularity people want is roughly a hundred stops, so the step tracks the
 * ceiling instead of the unit.
 */
function stepFor(max: Seconds): Seconds {
  if (max <= 30 * MINUTE) return 10;
  if (max <= 6 * HOUR) return MINUTE;
  if (max <= 2 * DAY) return 5 * MINUTE;
  return HOUR;
}
