import { revivedLength, type Gift } from "./economy";
import type { StreakRun } from "./streak";
import type { Seconds } from "./time";

/**
 * One thing that passed between this account and somebody else.
 *
 * Read off the gift ledger the snapshot already carries, so nothing new is
 * stored. The ledger was always the record of who gave what; it just was not
 * shown, so time a friend sent while you were away arrived as a bigger number
 * with no explanation.
 */
export interface ActivityItem {
  id: string;
  kind: "received" | "sent" | "revived-you" | "you-revived";
  /** The other party. */
  otherId: string;
  /**
   * What moved. For a revive this is what it cost the reviver, which is all
   * the ledger records - not what it brought back.
   */
  amount: Seconds;
  /**
   * What reviving this account's streak brought back. Only on `revived-you`,
   * and only when the run it revived can be found in the history.
   */
  restored?: Seconds;
  at: Seconds;
}

/**
 * This account's side of the ledger, newest first.
 *
 * `history` is only read to say what a revive of this account brought back.
 * Both adapters stamp the gift and the revived run with the same instant
 * (`uptime_revive` writes one `t` to both), so the run is found by that.
 */
export function activityFor(
  meId: string,
  gifts: readonly Gift[],
  history: readonly StreakRun[],
): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const gift of gifts) {
    const incoming = gift.toUserId === meId;
    if (!incoming && gift.fromUserId !== meId) continue;

    // Truthiness, not `!== undefined`: the SQL snapshot spells "not a revive"
    // as null, the local one leaves the key off.
    const revive = Boolean(gift.revivedStreakId);
    const item: ActivityItem = {
      id: gift.id,
      kind: revive ? (incoming ? "revived-you" : "you-revived") : incoming ? "received" : "sent",
      otherId: incoming ? gift.fromUserId : gift.toUserId,
      amount: gift.amount,
      at: gift.createdAt,
    };

    if (revive && incoming) {
      const run = history.find((r) => r.revivedAt === gift.createdAt);
      if (run) item.restored = revivedLength(run.length);
    }

    items.push(item);
  }

  return items.sort((a, b) => b.at - a.at);
}

/** Something that landed on this account, rather than left it. */
export function isIncoming(item: ActivityItem): boolean {
  return item.kind === "received" || item.kind === "revived-you";
}
