import { useState } from "react";
import {
  CHECK_IN_WINDOW,
  DAY,
  WHOLE_CLOCK_PRICE_LABEL,
  formatDate,
  formatDuration,
  isRunning,
  milestoneProgress,
  statusOf,
  type Clock,
  type Seconds,
  type StreakRun,
} from "@/core";
import { isRevivable, liveGiveable, liveSendableNow, type Snapshot } from "@/data/store";
import { StopwatchFace } from "@/components/StopwatchFace";
import { Capsule, Row, Section } from "@/components/List";
import { LiveTime } from "@/components/LiveTime";
import { RecentActivity } from "@/components/Activity";

interface Props {
  snapshot: Snapshot;
  /** Whole seconds, for everything that is not the face. */
  now: Seconds;
  /** The corrected clock, which the face reads per frame on its own. */
  clock: Clock;
  justCheckedIn: boolean;
  onCheckIn(): void;
  onStart(): void;
  onStop(): void;
  onSend(): void;
  onRevive(): void;
  onOpenAccount(): void;
  onOpenProfile(userId: string): void;
  /** Start buying the whole-clock upgrade. Absent where it is not on offer. */
  onUnlock?: () => void;
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
  clock,
  justCheckedIn,
  onCheckIn,
  onStart,
  onStop,
  onSend,
  onRevive,
  onOpenAccount,
  onOpenProfile,
  onUnlock,
}: Props) {
  const { me } = snapshot;
  // Derived here rather than read off the snapshot: the snapshot's status is
  // the server's reading from the moment it was taken, which would leave the
  // face frozen between refreshes.
  const status = statusOf(me.streak, now);
  const live = isRunning(status);
  const milestone = milestoneProgress(live ? status.elapsed : 0);

  // Measured from the previous visit, not from the touch this visit just made.
  // See Snapshot.windowAnchor for why.
  const windowLeft = Math.max(0, snapshot.windowAnchor + CHECK_IN_WINDOW - now);
  const windowFraction = Math.min(1, windowLeft / CHECK_IN_WINDOW);
  const revivable = snapshot.friends.filter(isRevivable).length;
  const anonymous = snapshot.account.isAnonymous;

  // What you may send off your running clock, recomputed against the ticking
  // clock rather than read off the snapshot - see liveGiveable.
  const giveable = liveSendableNow(snapshot, now);
  // The daily cap, not the share, is what is holding the figure down.
  const capped = giveable < liveGiveable(snapshot, now);

  return (
    <div className="pb-4">
      <StopwatchFace
        status={status}
        streakStart={me.streak.streakStart}
        clock={clock}
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
        <p className="px-5 pt-4 text-footnote text-label-2">
          Your streak reset - the check-in window ran out. It ran{" "}
          {Math.floor(snapshot.lastRun.length / DAY)} days and is kept under Past runs.
        </p>
      ) : null}

      <GivePanel
        giveable={giveable}
        live={live}
        anonymous={anonymous}
        wholeClock={snapshot.sendsWholeClock}
        capped={capped}
        revivable={revivable}
        onSend={anonymous ? onOpenAccount : onSend}
        onRevive={anonymous ? onOpenAccount : onRevive}
        onOpenAccount={onOpenAccount}
        {...(onUnlock && !anonymous ? { onUnlock } : {})}
      />

      <RecentActivity snapshot={snapshot} now={now} onOpen={onOpenProfile} />

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

      <PastRuns history={me.history} />
    </div>
  );
}

/**
 * Every run that ended, newest first.
 *
 * The record is never edited - a lapse, a stop and a rescue all leave the run
 * on file, and the reset message has always said so. Until this there was
 * nowhere to see it.
 */
function PastRuns({ history }: { history: readonly StreakRun[] }) {
  const [expanded, setExpanded] = useState(false);
  if (history.length === 0) return null;

  const runs = [...history].sort((a, b) => b.endedAt - a.endedAt);
  const shown = expanded ? runs : runs.slice(0, 4);

  return (
    <Section title="Past runs">
      {shown.map((run, index) => {
        const end = howItEnded(run);
        const days = Math.floor(run.length / DAY);
        return (
          <Row
            key={`${run.endedAt}-${index}`}
            label={days === 0 ? formatDuration(run.length) : `${days} ${days === 1 ? "day" : "days"}`}
            sub={`${formatDate(run.startedAt)} - ${formatDate(run.endedAt)}`}
            value={end.label}
            tone={end.tone}
          />
        );
      })}
      {runs.length > shown.length ? (
        <Row
          label={<span className="text-run">Show all {runs.length}</span>}
          onClick={() => setExpanded(true)}
        />
      ) : null}
    </Section>
  );
}

function howItEnded(run: StreakRun): { label: string; tone: "default" | "run" | "lapse" } {
  // Loose on purpose: the SQL snapshot sends null for a run nobody revived,
  // the local one leaves the key off.
  if (run.revivedAt != null) return { label: "Revived", tone: "run" };
  switch (run.reason) {
    case "lapsed":
      return { label: "Lapsed", tone: "lapse" };
    case "voluntary":
      return { label: "Stopped", tone: "default" };
    case "reset":
      return { label: "Reset", tone: "default" };
  }
}

/**
 * Sending time, and reviving with it.
 *
 * There is no separate bank: the time you give is your clock. Whatever you send
 * comes straight off your own timer and is added to the other person's, and
 * time sent to you lands on yours. So the figure here is the most you could
 * hand over right now - all of the running clock with the upgrade, a tenth of
 * the run without - and it is seen moving, because it is.
 */
function GivePanel({
  giveable,
  live,
  anonymous,
  wholeClock,
  capped,
  revivable,
  onSend,
  onRevive,
  onOpenAccount,
  onUnlock,
}: {
  giveable: Seconds;
  live: boolean;
  anonymous: boolean;
  wholeClock: boolean;
  capped: boolean;
  revivable: number;
  onSend(): void;
  onRevive(): void;
  onOpenAccount(): void;
  onUnlock?: () => void;
}) {
  return (
    <section className="mt-7 px-5">
      <div className="surface relative overflow-hidden rounded-2xl px-4 pt-4 pb-4">
        {/* A very faint wash of the giving colour from the top-right, so the
            panel is legibly about giving before a word of it is read. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -right-12 h-40 w-40 rounded-full"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-bank) 16%, transparent) 0%, transparent 70%)",
          }}
        />

        <div className="relative flex items-baseline justify-between">
          <h2 className="text-overline text-label-2 uppercase">
            You can send
          </h2>
          {live ? (
            <span className="flex items-center gap-1.5 text-micro font-medium text-bank">
              <span
                aria-hidden="true"
                className="animate-breathe h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--color-bank)" }}
              />
              {capped ? "today's limit" : wholeClock ? "your clock" : "a tenth of your clock"}
            </span>
          ) : null}
        </div>

        <div className="relative mt-1.5">
          <LiveTime
            seconds={giveable}
            className="tnum text-display"
            // Zero is not an amount of time to give, so it does not get the
            // colour that means one. Green nothing reads as a system error.
            style={{ color: giveable > 0 ? "var(--color-bank)" : "var(--color-label-3)" }}
          />
        </div>

        <p className="relative mt-2 text-footnote text-label-2">
          {!live
            ? "Your clock isn't running, so there's no time to send - and nowhere for a friend's gift to land. Start it to take part."
            : wholeClock
              ? "Whatever you send comes straight off your clock and is added to theirs. Time friends send you is added to yours."
              : "You can send 6 minutes for every hour on your clock. It comes straight off yours and is added to theirs, and time friends send you is added to yours."}
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
          className="mt-3 block w-full text-left text-footnote text-label-2"
        >
          Sending time needs an account. <span className="text-run">Create one</span> - your streak
          carries over.
        </button>
      ) : null}

      {onUnlock ? (
        <button
          type="button"
          onClick={onUnlock}
          className="mt-3 block w-full text-left text-footnote text-label-2"
        >
          Want to give someone your whole clock?{" "}
          <span className="text-run">Unlock it for {WHOLE_CLOCK_PRICE_LABEL}</span> - one payment,
          yours for good.
        </button>
      ) : null}
    </section>
  );
}
