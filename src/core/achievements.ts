import { DAY, MILESTONE_DAYS } from "./constants";
import { formatDuration, type Seconds } from "./time";

/**
 * Something the account has done, worked out at read time.
 *
 * Derived rather than stored, for the same reason the balance is: an
 * achievements table would be a second place for the truth to live and a
 * migration every time the ladder changes. Everything here is a comparison
 * against numbers the snapshot already carries, so a rule can be retuned in
 * this file alone and every account is re-judged on the next read.
 */
export interface Achievement {
  id: string;
  /** Two or three words, shown as the tile's title. */
  label: string;
  /** One line saying what earned it, or what would. */
  detail: string;
  earned: boolean;
  /**
   * Which face to strike the medal with.
   *
   * Named here rather than chosen by the component, because what an award is
   * *of* is a property of the award. A renderer picking art off the id would
   * put the decision two files away from the rule that grants it, and the day
   * a tier is added the medal silently falls back to a generic disc.
   */
  glyph: Glyph;
  /**
   * The metal. Earned awards only; a locked one is drawn as an empty setting
   * whatever it would eventually be struck in, because showing the finish
   * before it is won is the thing that makes a badge wall feel like a slot
   * machine.
   */
  metal: Metal;
  /**
   * 0-1 toward earning it, for the one in progress.
   *
   * Only ever set on unearned entries - a filled bar under something already
   * won is noise.
   */
  progress?: number;
}

/** The struck faces. One per kind of thing this app can recognise. */
export type Glyph = "rank" | "week" | "month" | "century" | "year" | "summit" | "rescue" | "given";

/**
 * What a medal is made of.
 *
 * The three metals rank against each other and are used where the award itself
 * is a ranking. `run` and `bank` are the app's own two systems, for awards that
 * are about keeping time and about giving it away - an award for generosity
 * struck in gold would read as a placing, which it is not.
 */
export type Metal = "gold" | "silver" | "bronze" | "run" | "bank";

/** A placing, narrowed so `core` does not have to know about the data layer. */
export interface Placing {
  position: number;
  of: number;
  /** Which board, for the caption. */
  label: string;
}

export interface AchievementInput {
  /** Longest run ever, current or past. */
  personalBest: Seconds;
  /** Total time kept across every run, including the one in progress. */
  lifetimeSeconds: Seconds;
  /** Time given away. */
  totalSent: Seconds;
  /** Streaks this account has brought back for someone else. */
  rescues: number;
  /** Best current placing across the boards, if the account is ranked at all. */
  best: Placing | null;
}

/**
 * The milestone ladder as named tiers.
 *
 * Only a few of `MILESTONE_DAYS` get a name: a badge for every rung would make
 * the wall of them meaningless, and the ones worth naming are the ones a
 * person would actually say out loud.
 */
const TIERS: { days: number; label: string; glyph: Glyph; metal: Metal }[] = [
  { days: 7, label: "First week", glyph: "week", metal: "bronze" },
  { days: 30, label: "First month", glyph: "month", metal: "bronze" },
  { days: 100, label: "Century", glyph: "century", metal: "silver" },
  { days: 365, label: "Full year", glyph: "year", metal: "gold" },
  { days: 1000, label: "Four figures", glyph: "summit", metal: "gold" },
];

/** A placing is struck in the metal it placed in, and only the top three are. */
function metalForPlacing(position: number): Metal {
  if (position === 1) return "gold";
  if (position === 2) return "silver";
  if (position === 3) return "bronze";
  return "run";
}

export function achievementsFor(input: AchievementInput): Achievement[] {
  const bestDays = input.personalBest / DAY;
  const out: Achievement[] = [];

  if (input.best !== null) {
    const { position, of, label } = input.best;
    out.push({
      id: "rank",
      label: ordinal(position),
      detail: `${label} - ${position} of ${of}`,
      earned: true,
      glyph: "rank",
      metal: metalForPlacing(position),
    });
  }

  for (const tier of TIERS) {
    const earned = bestDays >= tier.days;
    const entry: Achievement = {
      id: `tier-${tier.days}`,
      label: tier.label,
      detail: earned
        ? `${tier.days} days in one run`
        : `${Math.max(1, Math.ceil(tier.days - bestDays))} days to go`,
      earned,
      glyph: tier.glyph,
      metal: tier.metal,
    };
    if (!earned) entry.progress = Math.min(1, Math.max(0, bestDays / tier.days));
    out.push(entry);
  }

  if (input.rescues > 0) {
    out.push({
      id: "rescues",
      label: input.rescues === 1 ? "Rescuer" : `${input.rescues} rescues`,
      detail: input.rescues === 1 ? "Brought a streak back" : "Streaks brought back",
      earned: true,
      glyph: "rescue",
      metal: "run",
    });
  }

  if (input.totalSent > 0) {
    out.push({
      id: "given",
      label: "Benefactor",
      // A duration, not whole days: time now comes off a running clock, so an
      // hour is a real gift and "0d given away" undersold every one of them.
      detail: `${formatDuration(input.totalSent)} given away`,
      earned: true,
      glyph: "given",
      metal: "bank",
    });
  }

  return out;
}

/**
 * The next rung and how far up it the account is.
 *
 * Separate from the list because it is the one thing worth putting a bar
 * under, and the home screen wants it without the rest.
 */
export function nextMilestone(elapsed: Seconds): { days: number; fraction: number } | null {
  const days = elapsed / DAY;
  const next = MILESTONE_DAYS.find((mark) => days < mark);
  if (next === undefined) return null;

  const floor = [...MILESTONE_DAYS].reverse().find((mark) => days >= mark) ?? 0;
  const span = next - floor;
  return { days: next, fraction: span <= 0 ? 0 : (days - floor) / span };
}

/** 1 -> "1st". Used for placings, where "1th" would be conspicuous. */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
