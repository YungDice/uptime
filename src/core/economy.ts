import {
  DAY,
  FREE_SEND_SHARE,
  MAX_SENT_PER_DAY,
  REVIVE_COST_PER_RESTORED_SECOND,
  REVIVE_RESTORE_FRACTION,
} from "./constants";
import { isRunning, type StreakRecord, type StreakStatus } from "./streak";
import { formatDuration, type Seconds } from "./time";

/**
 * One row of the donation ledger.
 *
 * The ledger is the audit trail and what the given/received boards count. It
 * is no longer where a balance comes from: time you can send *is* your running
 * clock, and a gift moves the clocks themselves (see `transfer`).
 */
export interface Gift {
  id: string;
  fromUserId: string;
  toUserId: string;
  amount: Seconds;
  createdAt: Seconds;
  /** Set when the gift was spent reviving, rather than given outright. */
  revivedStreakId?: string;
}

/**
 * Everything on a running clock, in whole seconds.
 *
 * There is no separate bank: what a revive costs comes straight off this, and
 * what a gift sends is some or all of it (see `sendable`). A clock that is not
 * running has nothing on it. A lapsed-but-unswept clock counts as not running:
 * its run is about to be filed into history, and time cannot be spent out of a
 * run that has already ended.
 */
export function clockTime(status: StreakStatus): Seconds {
  return isRunning(status) ? Math.max(0, Math.floor(status.elapsed)) : 0;
}

/** What decides how much of a clock one account may send. */
export interface SendRights {
  /** Bought the whole-clock upgrade. */
  sendsWholeClock: boolean;
  /** Already sent out of the run on the clock. See `StreakRecord.sentThisRun`. */
  sentThisRun: Seconds;
}

/**
 * How much time a clock can give away right now.
 *
 * With the whole-clock upgrade, everything on it. Without, a tenth of what the
 * run has held - six minutes for every hour. "Held" puts what has already been
 * sent out of the run back in, because a gift takes its time off the clock: a
 * tenth of what the clock reads *now* would let a free account send a tenth,
 * then a tenth of what was left, and so on until the clock was empty.
 *
 * Counted that way, sending leaves the total the share is measured from
 * unchanged, so the share goes down by exactly what was sent - and time
 * received adds a tenth of itself, like any other time on the clock.
 */
export function sendable(status: StreakStatus, rights: SendRights): Seconds {
  const clock = clockTime(status);
  if (clock <= 0 || rights.sendsWholeClock) return clock;
  const sent = Math.max(0, rights.sentThisRun);
  return Math.max(0, Math.min(clock, Math.floor((clock + sent) * FREE_SEND_SHARE) - sent));
}

/**
 * How much more may leave this account in the rolling 24 hours.
 *
 * On a free account, what is left of `MAX_SENT_PER_DAY`. The whole-clock
 * upgrade has no cap at all: it exists so that someone can hand a friend their
 * entire clock in one go, and a 7-day ceiling would turn a 60-day gift into
 * nine days of sending.
 */
export function sendableToday(sentInLastDay: Seconds, sendsWholeClock: boolean): Seconds {
  return sendsWholeClock ? Number.POSITIVE_INFINITY : Math.max(0, MAX_SENT_PER_DAY - sentInLastDay);
}

/**
 * Move `amount` from one running clock to another.
 *
 * Nothing ticks, so a clock is `now - streakStart` and the only way to change
 * what it reads is to move its start. Taking time off the sender pushes their
 * start later; adding it to the recipient pulls theirs earlier. Both are
 * touched, because sending and receiving are each a sign of life, and the
 * sender's run remembers what went out of it (`sentThisRun`).
 *
 * The caller has already checked the gift (`checkGift`); this is the pure
 * arithmetic both adapters and the SQL share, so the three cannot disagree
 * about which way a start moves.
 */
export function transfer(
  from: StreakRecord,
  to: StreakRecord,
  amount: Seconds,
  now: Seconds,
): { from: StreakRecord; to: StreakRecord } {
  if (from.streakStart === null || to.streakStart === null) {
    throw new Error("Both clocks must be running to move time between them.");
  }
  return {
    from: {
      ...from,
      streakStart: from.streakStart + amount,
      lastSeen: now,
      sentThisRun: (from.sentThisRun ?? 0) + amount,
    },
    to: { ...to, streakStart: to.streakStart - amount, lastSeen: now },
  };
}

/**
 * Take `amount` off a running clock without giving it to anyone.
 *
 * What a revive costs: the price comes off the reviver's own timer, and what
 * the friend gets back is the restored run rather than the price itself. Not
 * counted as sent: a free account's share shrinks with the clock, by a tenth
 * of the price, and no more.
 */
export function spend(from: StreakRecord, amount: Seconds, now: Seconds): StreakRecord {
  if (from.streakStart === null) {
    throw new Error("A clock that is not running has no time to spend.");
  }
  return { ...from, streakStart: from.streakStart + amount, lastSeen: now };
}

/** What a lapsed streak of `lostLength` comes back as. */
export function revivedLength(lostLength: Seconds): Seconds {
  return Math.floor(Math.max(0, lostLength) * REVIVE_RESTORE_FRACTION);
}

/** What reviving a lapsed streak of `lostLength` costs the reviver's clock. */
export function reviveCost(lostLength: Seconds): Seconds {
  return Math.ceil(revivedLength(lostLength) * REVIVE_COST_PER_RESTORED_SECOND);
}

export type GiftRejection =
  | { ok: false; reason: "not-connected"; message: string }
  | { ok: false; reason: "insufficient"; message: string }
  | { ok: false; reason: "free-share"; message: string }
  | { ok: false; reason: "recipient-stopped"; message: string }
  | { ok: false; reason: "rate-limited"; message: string }
  | { ok: false; reason: "invalid-amount"; message: string }
  | { ok: false; reason: "self"; message: string };

export type GiftCheck = { ok: true } | GiftRejection;

export interface GiftContext {
  /** What the sender's clock reads right now - see `clockTime`. */
  senderClock: Seconds;
  /**
   * How much of it they may send right now - see `sendable`. The whole clock
   * with the upgrade, a tenth of the run without.
   */
  senderBalance: Seconds;
  /** Sent by this user in the last 24h, for the rolling cap. */
  sentInLastDay: Seconds;
  /** Bought the whole-clock upgrade, which also lifts the rolling cap. */
  sendsWholeClock: boolean;
  /** Whether sender and recipient follow each other. */
  connected: boolean;
  isSelf: boolean;
  /**
   * Whether the recipient's clock is running.
   *
   * A gift lands on the recipient's timer, so a stopped timer has nowhere for
   * it to land. A lapsed streak is what reviving is for - letting a plain gift
   * restart one would be a revive that skipped the price.
   */
  recipientRunning: boolean;
}

/**
 * Whether a gift is allowed.
 *
 * Mirrors the SQL policies rather than replacing them - this exists so the UI
 * can explain a refusal before the round trip, not to be the thing enforcing
 * it. The server check is the real one.
 */
export function checkGift(amount: Seconds, ctx: GiftContext): GiftCheck {
  if (!Number.isFinite(amount) || amount <= 0 || Math.floor(amount) !== amount) {
    return { ok: false, reason: "invalid-amount", message: "Pick an amount of time to send." };
  }
  if (ctx.isSelf) {
    return { ok: false, reason: "self", message: "You can't send time to yourself." };
  }
  if (!ctx.connected) {
    return {
      ok: false,
      reason: "not-connected",
      message: "You can only send time to people you both follow.",
    };
  }
  if (!ctx.recipientRunning) {
    return {
      ok: false,
      reason: "recipient-stopped",
      message: "Their clock isn't running, so there's nothing to add time to.",
    };
  }
  if (amount > ctx.senderBalance) {
    // The clock has the time, but the free share does not cover it.
    if (ctx.senderClock > 0 && ctx.senderBalance < ctx.senderClock) {
      return {
        ok: false,
        reason: "free-share",
        message:
          ctx.senderBalance <= 0
            ? "You've sent all a free account can from this clock: 6 minutes for every hour on it."
            : `Free accounts can send 6 minutes for every hour on the clock - ${formatDuration(ctx.senderBalance)} right now.`,
      };
    }
    return {
      ok: false,
      reason: "insufficient",
      message:
        ctx.senderClock <= 0
          ? "Your clock has no time on it to send."
          : "That's more than your clock has on it.",
    };
  }
  if (amount > sendableToday(ctx.sentInLastDay, ctx.sendsWholeClock)) {
    const left = Math.max(0, MAX_SENT_PER_DAY - ctx.sentInLastDay);
    return {
      ok: false,
      reason: "rate-limited",
      message:
        left <= 0
          ? "You've hit today's sending limit. It resets on a rolling 24 hours."
          : `You can send ${Math.floor(left / DAY)}d more today.`,
    };
  }
  return { ok: true };
}

/** Rolling-24h total, used for the cap. */
export function sentInLastDay(gifts: readonly Gift[], userId: string, now: Seconds): Seconds {
  const cutoff = now - DAY;
  return gifts
    .filter((g) => g.fromUserId === userId && g.createdAt > cutoff)
    .reduce((sum, g) => sum + g.amount, 0);
}

export function totalSent(gifts: readonly Gift[], userId: string): Seconds {
  return gifts.filter((g) => g.fromUserId === userId).reduce((s, g) => s + g.amount, 0);
}

export function totalReceived(gifts: readonly Gift[], userId: string): Seconds {
  return gifts.filter((g) => g.toUserId === userId).reduce((s, g) => s + g.amount, 0);
}
