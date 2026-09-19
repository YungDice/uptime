import {
  ACCRUAL_RATE,
  CHECK_IN_WINDOW,
  DAY,
  HOUR,
  formatDate,
  formatDuration,
  isRunning,
  milestoneProgress,
  statusOf,
  type Seconds,
} from "@/core";
import { liveGiveable, type Snapshot } from "@/data/store";
import { StopwatchFace } from "@/components/StopwatchFace";
import { Capsule, Row, Section } from "@/components/List";
import { LiveTime } from "@/components/LiveTime";
import { ReminderOffer } from "@/components/ReminderOffer";

interface Props {
  snapshot: Snapshot;
  /** Whole seconds, for everything that is not the face. */
  now: Seconds;
  /** Fractional seconds, for the face alone. */
  fractionalNow: number;
  justCheckedIn: boolean;
  onCheckIn(): void;
  onStart(): void;
  onStop(): void;
  onSend(): void;
  onRevive(): void;
  onOpenAccount(): void;
}

/** The window is a countdown, so it reaches 1 and then 0 and must read right. */
function checkInLabel(days: number): string {
  if (days <= 0) return "The window has closed";
  if (days === 1) return "Check in today";
  return `Check in within ${days} days`;
}

export function Home({
  snapshot,
  now,
  fractionalNow,
  justCheckedIn,
  onCheckIn,
  onStart,
  onStop,
  onSend,
  onRevive,
  onOpenAccount,
}: Props) {
  const { me } = snapshot;
  // Derived here rather than read off the snapshot: the snapshot's status is
  // the server's reading from the moment it was taken, which would leave the
  // face frozen between refreshes.
  const status = statusOf(me.streak, now);
  const live = isRunning(status);
  const elapsed = live ? fractionalNow - (me.streak.streakStart ?? 0) : 0;
  const milestone = milestoneProgress(live ? status.elapsed : 0);

  // Measured from the previous visit, not from the touch this visit just made.
  // See Snapshot.windowAnchor for why.
  const windowLeft = Math.max(0, snapshot.windowAnchor + CHECK_IN_WINDOW - now);
  const windowFraction = Math.min(1, windowLeft / CHECK_IN_WINDOW);
  const revivable = snapshot.friends.filter((f) => f.revive !== undefined).length;
  const anonymous = snapshot.account.isAnonymous;

  // Recomputed against the ticking clock rather than read off the snapshot -
  // see liveGiveable. This is the number the whole Give panel is about.
  const giveable = liveGiveable(snapshot, now);

  return (
    <div className="pb-4">
      <StopwatchFace
        status={status}
        elapsed={elapsed}
        windowFraction={live ? windowFraction : 0}
        windowLabel={
          live
            ? checkInLabel(Math.ceil(windowLeft / DAY))
            : snapshot.lastRun?.reason === "lapsed"
              ? "The check-in window ran out"
              : "Start the clock to begin"
        }
      />

      <div className="flex gap-3 px-5 pt-4">
        {live ? (
          <>
            {/* Not `wide`: the two controls are not peers. One of them you press
                every day and the other ends the run, and giving them equal
                width was most of why the second one was dangerous. */}
            <Capsule tone="lapse" onClick={onStop}>
              Stop
            </Capsule>
            <Capsule tone="run" solid wide onClick={onCheckIn} pressed={justCheckedIn}>
              I'm Still Here
            </Capsule>
          </>
        ) : (
          <Capsule tone="run" solid wide onClick={onStart}>
            {snapshot.lastRun?.reason === "lapsed" ? "Start Again" : "Start"}
          </Capsule>
        )}
      </div>

      {!live && snapshot.lastRun?.reason === "lapsed" ? (
        <p className="px-5 pt-4 text-[13px] text-label-2">
          Your streak reset - the check-in window ran out. It ran{" "}
          {Math.floor(snapshot.lastRun.length / DAY)} days and is kept in your history.
        </p>
      ) : null}

      {live ? <ReminderOffer elapsed={status.elapsed} windowRemaining={windowLeft} /> : null}

      <GivePanel
        giveable={giveable}
        live={live}
        anonymous={anonymous}
        revivable={revivable}
        onSend={anonymous ? onOpenAccount : onSend}
        onRevive={anonymous ? onOpenAccount : onRevive}
        onOpenAccount={onOpenAccount}
      />

      <Section title="Run">
        <Row
          label="Started"
          value={me.streak.streakStart === null ? "--" : formatDate(me.streak.streakStart)}
        />
        <Row label="Personal best" value={formatDuration(snapshot.personalBest)} />
        {live ? (
          <Row
            label="Next milestone"
            value={
              milestone.nextDays === null
                ? "All cleared"
                : `${milestone.nextDays} ${milestone.nextDays === 1 ? "day" : "days"}`
            }
            sub={
              milestone.nextDays === null
                ? undefined
                : `${milestone.daysRemaining} ${milestone.daysRemaining === 1 ? "day" : "days"} to go`
            }
            tone="run"
          />
        ) : null}
        {live ? <Row label="Window closes" value={formatDate(now + windowLeft)} /> : null}
      </Section>

      <Section title="Given and received">
        <Row label="Given away" value={formatDuration(snapshot.totalSent)} />
        <Row label="Received" value={formatDuration(snapshot.totalReceived)} />
      </Section>
    </div>
  );
}

/**
 * The time you can give away, and the two things you can do with it.
 *
 * This replaces a list row reading "Balance - 13m" inside a section headed
 * "Banked", and the reason it is now a panel with a running readout in it is
 * that the old one was a lie of omission. The figure grows continuously while
 * the clock runs, but the snapshot it came from was only ever refetched when
 * something was pressed - so it sat perfectly still for an hour and then jumped
 * eight minutes the instant you stopped the clock, which looks exactly like the
 * app making numbers up. It never was a balance in an account that something
 * deposits into; it is a tenth of the time you have kept, and it should be seen
 * moving.
 */
function GivePanel({
  giveable,
  live,
  anonymous,
  revivable,
  onSend,
  onRevive,
  onOpenAccount,
}: {
  giveable: Seconds;
  live: boolean;
  anonymous: boolean;
  revivable: number;
  onSend(): void;
  onRevive(): void;
  onOpenAccount(): void;
}) {
  // Said in the unit the user is watching accrue, not as a rate: "6m an hour"
  // is a sentence, "0.1x" is a spreadsheet.
  const perHour = formatDuration(HOUR * ACCRUAL_RATE);

  return (
    <section className="mt-7 px-5">
      <div className="surface relative overflow-hidden rounded-2xl px-4 pt-4 pb-4">
        {/* A very faint wash of the bank colour from the top-right, so the panel
            is legibly about giving before a word of it is read. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -right-12 h-40 w-40 rounded-full"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-bank) 16%, transparent) 0%, transparent 70%)",
          }}
        />

        <div className="relative flex items-baseline justify-between">
          <h2 className="text-[12px] font-semibold tracking-[0.1em] text-label-2 uppercase">
            To give
          </h2>
          {live ? (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-bank">
              <span
                aria-hidden="true"
                className="animate-breathe h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--color-bank)" }}
              />
              rising
            </span>
          ) : null}
        </div>

        <div className="relative mt-1.5">
          <LiveTime
            seconds={giveable}
            className="tnum text-[40px] leading-none font-light tracking-[-0.03em]"
            // Zero is not an amount of time to give, so it does not get the
            // colour that means one. Green nothing reads as a system error.
            style={{ color: giveable > 0 ? "var(--color-bank)" : "var(--color-label-3)" }}
          />
        </div>

        <p className="relative mt-2 text-[13px] text-label-2">
          {live
            ? `Grows by ${perHour} for every hour your clock keeps running. Giving it away never shortens your own streak.`
            : `A tenth of the time you keep. Start the clock and it grows by ${perHour} an hour.`}
        </p>

        <div className="relative mt-4 flex gap-2.5">
          <Capsule tone="bank" wide onClick={onSend} disabled={!anonymous && giveable <= 0}>
            Send Time
          </Capsule>
          <Capsule wide onClick={onRevive} disabled={!anonymous && revivable === 0}>
            {!anonymous && revivable > 0 ? `Revive (${revivable})` : "Revive"}
          </Capsule>
        </div>
      </div>

      {/* Said before the tap, not after it. Both controls still lead somewhere
          rather than sitting dead, so the limit reads as a door. */}
      {anonymous ? (
        <button
          type="button"
          onClick={onOpenAccount}
          className="mt-3 block w-full text-left text-[13px] text-label-2"
        >
          Sending time needs an account. <span className="text-run">Create one</span> - your streak
          carries over.
        </button>
      ) : null}
    </section>
  );
}
