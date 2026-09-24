/**
 * Tunable rules of the game. Every one of these is a policy decision from the
 * build prompt, named here so it can be changed in one place.
 */

export const SECOND = 1;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * How long a user may go unseen before their streak lapses.
 *
 * The prompt's range is 30-90 days. 60 is the middle: long enough that an
 * active user never learns the mechanic exists, short enough that the
 * leaderboards are not full of accounts nobody has opened in a year.
 */
export const CHECK_IN_WINDOW = 60 * DAY;

/** How close to the window's end the "still here?" push should fire. */
export const CHECK_IN_NUDGE_LEAD = 7 * DAY;

/**
 * A revived streak comes back at half the length it lost, per the prompt.
 * Reviving is a rescue, not an undo.
 */
export const REVIVE_RESTORE_FRACTION = 0.5;

/**
 * Revive price, per second of streak *restored*.
 *
 * Paid out of the reviver's own running clock, because that clock is the only
 * currency there is: time you send comes off your timer and lands on theirs.
 * At a tenth, a 400-day streak restores to 200 days and costs the reviver 20
 * days of their own run - a real sacrifice, which is the point: big rescues
 * take more than one friend.
 */
export const REVIVE_COST_PER_RESTORED_SECOND = 0.1;

/** Milestone ladder, in days. Used for the "next milestone" bar. */
export const MILESTONE_DAYS = [1, 7, 30, 60, 100, 180, 365, 500, 730, 1000] as const;

/** Abuse limits. Enforced in SQL too - these are the client-side mirror. */
export const MAX_SENT_PER_DAY = 7 * DAY;
export const MIN_ACCOUNT_AGE_FOR_LEADERBOARD_CREDIT = 14 * DAY;
