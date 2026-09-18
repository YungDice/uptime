import {
  DAY,
  CHECK_IN_WINDOW,
  formatDate,
  formatDuration,
  isRunning,
  milestoneProgress,
  statusOf,
  type Seconds,
} from "@/core";
import type { Snapshot } from "@/data/store";
import { PulseHero } from "@/components/PulseHero";
import { MilestoneBar, StatChip, WindowBar } from "@/components/Bars";
import { BankedCard } from "@/components/BankedCard";
import { ReminderOffer } from "@/components/ReminderOffer";

interface Props {
  snapshot: Snapshot;
  now: Seconds;
  onCheckIn(): void;
  onStart(): void;
  onStop(): void;
  onSend(): void;
  onRevive(): void;
}

export function Home({ snapshot, now, onCheckIn, onStart, onStop, onSend, onRevive }: Props) {
  const { me } = snapshot;
  // Derived here rather than read off the snapshot: the snapshot's status is
  // the server's reading from the moment it was taken, which would leave the
  // counter frozen between refreshes.
  const status = statusOf(me.streak, now);
  const live = isRunning(status);
  const elapsed = live ? status.elapsed : 0;
  const milestone = milestoneProgress(elapsed);
  // Measured from the previous visit, not from the touch this visit just made.
  // See Snapshot.windowAnchor for why.
  const windowLeft = Math.max(0, snapshot.windowAnchor + CHECK_IN_WINDOW - now);
  const windowFilled = Math.min(1, windowLeft / CHECK_IN_WINDOW);
  const revivable = snapshot.friends.filter((f) => f.revive !== undefined).length;

  return (
    <div className="flex flex-col gap-6">
      <PulseHero status={status} />

      {live ? (
        <button
          type="button"
          onClick={onCheckIn}
          className="w-full rounded-2xl bg-pulse px-5 py-4 text-base font-semibold text-ink transition-opacity hover:opacity-90"
        >
          I am still here
        </button>
      ) : (
        <button
          type="button"
          onClick={onStart}
          className="w-full rounded-2xl bg-pulse px-5 py-4 text-base font-semibold text-ink transition-opacity hover:opacity-90"
        >
          {status.kind === "lapsed" ? "Start again" : "Start your clock"}
        </button>
      )}

      {/* Offered when the user came back with the window nearly out - which is
          the one moment they have a reason to say yes. */}
      {live ? <ReminderOffer elapsed={elapsed} windowRemaining={windowLeft} /> : null}

      {/* Said plainly, and about the run that actually ended - not about the
          transient `lapsed` status, which the sweep on open almost always
          resolves before anyone sees it. */}
      {!live && snapshot.lastRun?.reason === "lapsed" ? (
        <p className="text-sm text-muted">
          Your streak reset - the check-in window ran out. It ran{" "}
          {Math.floor(snapshot.lastRun.length / DAY)} days and is kept in your history.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <StatChip
          label="streak started"
          value={me.streak.streakStart === null ? "not running" : formatDate(me.streak.streakStart)}
        />
        <StatChip label="personal best" value={formatDuration(snapshot.personalBest)} />
      </div>

      {live ? (
        <div className="flex flex-col gap-5 rounded-2xl bg-surface p-5">
          <WindowBar fraction={windowFilled} remaining={windowLeft} />
          <MilestoneBar
            fraction={milestone.fraction}
            nextDays={milestone.nextDays}
            daysRemaining={milestone.daysRemaining}
          />
        </div>
      ) : null}

      <BankedCard
        balance={snapshot.balance}
        sent={snapshot.totalSent}
        received={snapshot.totalReceived}
        sentToday={snapshot.sentInLastDay}
        onSend={onSend}
        onRevive={onRevive}
        reviveCount={revivable}
      />

      {live ? (
        <button
          type="button"
          onClick={onStop}
          className="self-center text-xs text-muted underline underline-offset-4 transition-colors hover:text-danger"
        >
          Stop my clock on purpose
        </button>
      ) : null}
    </div>
  );
}
