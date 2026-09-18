import {
  CHECK_IN_WINDOW,
  DAY,
  formatDate,
  formatDuration,
  isRunning,
  milestoneProgress,
  statusOf,
  type Seconds,
} from "@/core";
import type { Snapshot } from "@/data/store";
import { StopwatchFace } from "@/components/StopwatchFace";
import { Capsule, Row, Section } from "@/components/List";
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

  return (
    <div className="pb-4">
      <StopwatchFace
        status={status}
        elapsed={elapsed}
        windowFraction={live ? windowFraction : 0}
        windowLabel={
          live
            ? `Check in within ${Math.ceil(windowLeft / DAY)} days`
            : snapshot.lastRun?.reason === "lapsed"
              ? "The check-in window ran out"
              : "Start the clock to begin"
        }
      />

      <div className="flex gap-3 px-5 pt-2">
        {live ? (
          <>
            <Capsule tone="lapse" onClick={onStop}>
              Stop
            </Capsule>
            <Capsule tone="run" wide onClick={onCheckIn} pressed={justCheckedIn}>
              I'm Still Here
            </Capsule>
          </>
        ) : (
          <Capsule tone="run" wide onClick={onStart}>
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

      <Section title="Run">
        <Row
          label="Started"
          value={me.streak.streakStart === null ? "--" : formatDate(me.streak.streakStart)}
        />
        <Row label="Personal best" value={formatDuration(snapshot.personalBest)} />
        {live ? (
          <Row
            label="Next milestone"
            value={milestone.nextDays === null ? "All cleared" : `${milestone.nextDays} days`}
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

      <Section title="Banked">
        <Row label="Balance" value={formatDuration(snapshot.balance)} tone="bank" />
        <Row label="Given" value={formatDuration(snapshot.totalSent)} />
        <Row label="Received" value={formatDuration(snapshot.totalReceived)} />
      </Section>

      <div className="flex gap-3 px-5 pt-5">
        <Capsule tone="bank" wide onClick={onSend} disabled={snapshot.balance <= 0}>
          Send Time
        </Capsule>
        <Capsule wide onClick={onRevive} disabled={revivable === 0}>
          {revivable > 0 ? `Revive (${revivable})` : "Revive"}
        </Capsule>
      </div>
    </div>
  );
}
