import type { StreakRecord, StreakRun } from "./streak";
import type { Seconds } from "./time";

export interface UserProfile {
  id: string;
  handle: string;
  displayName: string;
  createdAt: Seconds;
}

/**
 * Everything about one user, as the server stores it.
 *
 * Note what is absent: no elapsed, no balance, no rank. Those are all derived
 * at read time from these fields plus the ledger.
 */
export interface UserState extends UserProfile {
  streak: StreakRecord;
  lifetimeSeconds: Seconds;
  history: StreakRun[];
}

/** A mutual follow. Gate for donations. */
export interface Connection {
  userId: string;
  otherId: string;
  since: Seconds;
}
