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

/**
 * How much of a running clock a free account may send: a tenth, which is six
 * minutes for every hour on it - the ratio the old bank accrued at.
 *
 * Counted across the whole run rather than per gift (see `sendable`), or a
 * tenth and then a tenth of what is left would empty the clock ten percent at
 * a time. The whole-clock upgrade lifts it; revives are paid off the whole
 * clock either way. SQL: `uptime_free_send_share()`.
 */
export const FREE_SEND_SHARE = 0.1;

/**
 * What the whole-clock upgrade costs, as the app shows it.
 *
 * Display only. The amount actually charged is set where the Stripe Checkout
 * Session is created, `UPGRADE_PRICE` in `supabase/functions/_shared/stripe.ts`,
 * so a client can never decide its own price. Change the two together.
 */
export const WHOLE_CLOCK_PRICE_LABEL = "$5";

/** Milestone ladder, in days. Used for the "next milestone" bar. */
export const MILESTONE_DAYS = [1, 7, 30, 60, 100, 180, 365, 500, 730, 1000] as const;

/**
 * Abuse limits. Enforced in SQL too - these are the client-side mirror.
 *
 * The daily cap applies to free accounts only: the whole-clock upgrade lifts
 * it along with the free share (see `sendableToday`).
 */
export const MAX_SENT_PER_DAY = 7 * DAY;
export const MIN_ACCOUNT_AGE_FOR_LEADERBOARD_CREDIT = 14 * DAY;
