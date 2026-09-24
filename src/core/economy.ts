import {
  DAY,
  MAX_SENT_PER_DAY,
  REVIVE_COST_PER_RESTORED_SECOND,
  REVIVE_RESTORE_FRACTION,
} from "./constants";
import { isRunning, type StreakRecord, type StreakStatus } from "./streak";
import type { Seconds } from "./time";

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
 * How much time a clock can give away right now: everything on it.
 *
 * There is no separate bank. Sending takes the time straight off your own
 * timer, so the most you can send is what the timer reads - and a clock that
 * is not running has nothing on it to send. A lapsed-but-unswept clock counts
 * as not running: its run is about to be filed into history, and time cannot
 * be spent out of a run that has already ended.
 */
export function sendable(status: StreakStatus): Seconds {
  return isRunning(status) ? Math.max(0, Math.floor(status.elapsed)) : 0;
}

/**
 * Move `amount` from one running clock to another.
 *
 * Nothing ticks, so a clock is `now - streakStart` and the only way to change
 * what it reads is to move its start. Taking time off the sender pushes their
 * start later; adding it to the recipient pulls theirs earlier. Both are
 * touched, because sending and receiving are each a sign of life.
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
    from: { streakStart: from.streakStart + amount, lastSeen: now },
    to: { streakStart: to.streakStart - amount, lastSeen: now },
  };
}

/**
 * Take `amount` off a running clock without giving it to anyone.
 *
 * What a revive costs: the price comes off the reviver's own timer, and what
 * the friend gets back is the restored run rather than the price itself.
 */
export function spend(from: StreakRecord, amount: Seconds, now: Seconds): StreakRecord {
  if (from.streakStart === null) {
    throw new Error("A clock that is not running has no time to spend.");
  }
  return { streakStart: from.streakStart + amount, lastSeen: now };
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
  | { ok: false; reason: "recipient-stopped"; message: string }
  | { ok: false; reason: "rate-limited"; message: string }
  | { ok: false; reason: "invalid-amount"; message: string }
  | { ok: false; reason: "self"; message: string };

export type GiftCheck = { ok: true } | GiftRejection;

export interface GiftContext {
  /** What the sender's clock reads right now - see `sendable`. */
  senderBalance: Seconds;
  /** Sent by this user in the last 24h, for the rolling cap. */
  sentInLastDay: Seconds;
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
    return {
      ok: false,
      reason: "insufficient",
      message:
        ctx.senderBalance <= 0
          ? "Your clock has no time on it to send."
          : "That's more than your clock has on it.",
    };
  }
  if (ctx.sentInLastDay + amount > MAX_SENT_PER_DAY) {
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
