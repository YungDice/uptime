import type { StreakRecord, StreakRun } from "./streak";
import type { Seconds } from "./time";

export interface UserProfile {
  id: string;
  handle: string;
  displayName: string;
  /**
   * Public URL of the profile picture, or null for none.
   *
   * Nullable rather than optional: every read path returns the column, so a
   * missing value means "this person has no photo", never "we did not ask".
   * The distinction matters because the fallback is a drawn monogram, and a
   * monogram shown because the field was forgotten is a bug that looks like a
   * design.
   */
  avatarUrl: string | null;
  createdAt: Seconds;
}

/**
 * Everything about one user, as the server stores it.
 *
 * Note what is absent: no elapsed, no balance, no rank. Those are all derived
 * at read time from these fields plus the ledger.
 */
export interface UserState extends UserProfile {
  /**
   * Whether this account is still anonymous.
   *
   * Carried on the user rather than looked up, because the leaderboards have
   * to exclude anonymous accounts for *other* people too, not just the caller.
   * The server reads it from auth.users, which Supabase updates itself on an
   * upgrade, so there is no flag of ours to keep in sync.
   */
  isAnonymous?: boolean;
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
