import {
  ACCRUAL_RATE,
  DAY,
  MAX_SENT_PER_DAY,
  REVIVE_COST_PER_RESTORED_SECOND,
  REVIVE_RESTORE_FRACTION,
} from "./constants";
import type { Seconds } from "./time";

/** One row of the donation ledger. Balances are sums over these, never fields. */
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
 * Inputs to a balance. All derivable: two of them come from the user row, the
 * other two are sums over the ledger.
 */
export interface BalanceInputs {
  /** Sum of every completed run. */
  lifetimeSeconds: Seconds;
  /** Elapsed on the run in progress, if any. */
  currentElapsed: Seconds;
  sent: Seconds;
  received: Seconds;
}

/**
 * Banked time earned by keeping a streak.
 *
 * Deliberately a function of total time kept rather than a counter that ticks:
 * it can be recomputed from scratch at any moment, and a user who never opens
 * the app for a month finds exactly the balance they should have.
 */
export function accrued(lifetimeSeconds: Seconds, currentElapsed: Seconds): Seconds {
  return Math.floor(Math.max(0, lifetimeSeconds + currentElapsed) * ACCRUAL_RATE);
}

/**
 * Spendable balance.
 *
 * Floored at zero defensively: the ledger constraints should make an overdraft
 * impossible, but a balance is a display value and must never render negative.
 */
export function balance(inputs: BalanceInputs): Seconds {
  const earned = accrued(inputs.lifetimeSeconds, inputs.currentElapsed);
  return Math.max(0, earned + inputs.received - inputs.sent);
}

/** What a lapsed streak of `lostLength` comes back as. */
export function revivedLength(lostLength: Seconds): Seconds {
  return Math.floor(Math.max(0, lostLength) * REVIVE_RESTORE_FRACTION);
}

/** Banked cost to revive a lapsed streak of `lostLength`. */
export function reviveCost(lostLength: Seconds): Seconds {
  return Math.ceil(revivedLength(lostLength) * REVIVE_COST_PER_RESTORED_SECOND);
}

export type GiftRejection =
  | { ok: false; reason: "not-connected"; message: string }
  | { ok: false; reason: "insufficient"; message: string }
  | { ok: false; reason: "rate-limited"; message: string }
  | { ok: false; reason: "invalid-amount"; message: string }
  | { ok: false; reason: "self"; message: string };

export type GiftCheck = { ok: true } | GiftRejection;

export interface GiftContext {
  senderBalance: Seconds;
  /** Sent by this user in the last 24h, for the rolling cap. */
  sentInLastDay: Seconds;
  /** Whether sender and recipient follow each other. */
  connected: boolean;
  isSelf: boolean;
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
  if (amount > ctx.senderBalance) {
    return { ok: false, reason: "insufficient", message: "That's more than you have banked." };
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
