import { DAY, formatDuration, formatElapsed, isRunning, statusOf, type Seconds } from "@/core";
import type { FriendView } from "@/data/store";

interface Props {
  friends: FriendView[];
  balance: Seconds;
  /** Ticking clock, so friends' counters move for the same reason yours does. */
  now: Seconds;
  onSend(friend: FriendView): void;
  onRevive(friend: FriendView): void;
  /** Id of the friend a gift is currently flying toward, for the trail. */
  trailingTo: string | null;
}

export function FriendList({ friends, balance, now, onSend, onRevive, trailingTo }: Props) {
  if (friends.length === 0) {
    return (
      <p className="rounded-2xl bg-surface p-5 text-sm text-muted">
        Nobody here yet. Follow someone by handle above - time only moves
        between people who follow each other.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {friends.map((friend) => (
        <FriendRow
          key={friend.profile.id}
          friend={friend}
          balance={balance}
          now={now}
          onSend={() => onSend(friend)}
          onRevive={() => onRevive(friend)}
          trailing={trailingTo === friend.profile.id}
        />
      ))}
    </ul>
  );
}

function FriendRow({
  friend,
  balance,
  now,
  onSend,
  onRevive,
  trailing,
}: {
  friend: FriendView;
  balance: Seconds;
  now: Seconds;
  onSend(): void;
  onRevive(): void;
  trailing: boolean;
}) {
  const status = statusOf(friend.streak, now);
  const live = isRunning(status);
  const canAfford = friend.revive ? balance >= friend.revive.cost : false;
  const canGive = friend.connected && balance > 0;

  return (
    <li className="relative overflow-hidden rounded-2xl bg-surface px-4 py-3.5">
      {/* The second and last thing that moves: a light trail the instant time
          leaves you for someone else. */}
      {trailing ? (
        <span
          aria-hidden="true"
          className="animate-trail pointer-events-none absolute inset-y-0 left-0 w-1/3"
          style={{
            background:
              "linear-gradient(90deg, transparent, var(--color-ember), transparent)",
            opacity: 0.5,
          }}
        />
      ) : null}

      <div className="relative flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink-text">
            {friend.profile.displayName}
          </div>
          <div
            className={`tnum mt-0.5 font-mono text-xs ${
              live ? (status.kind === "expiring" ? "text-ember" : "text-pulse") : "text-muted"
            }`}
          >
            {live
              ? formatElapsed(status.elapsed)
              : friend.revive
                ? "streak broken"
                : "not running"}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {friend.revive ? (
            <button
              type="button"
              onClick={onRevive}
              disabled={!canAfford || !friend.connected}
              className="rounded-lg bg-pulse/12 px-3 py-2 text-xs font-semibold text-pulse transition-colors hover:bg-pulse/20 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted"
              title={
                canAfford
                  ? `Restores ${Math.floor(friend.revive.restores / DAY)} days`
                  : `Needs ${formatDuration(friend.revive.cost)} banked`
              }
            >
              Revive {formatDuration(friend.revive.cost)}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSend}
            disabled={!canGive}
            className="rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold text-ink-text transition-colors hover:bg-surface-2/70 disabled:cursor-not-allowed disabled:text-muted"
          >
            Send
          </button>
        </div>
      </div>

      {!friend.connected ? (
        <p className="relative mt-2 text-xs text-muted">
          Waiting for {friend.profile.displayName} to follow you back. Time only moves both ways.
        </p>
      ) : null}

      {friend.connected && friend.revive ? (
        <p className="relative mt-2 text-xs text-muted">
          Lost {Math.floor(friend.revive.lostLength / DAY)} days. Reviving brings back{" "}
          {Math.floor(friend.revive.restores / DAY)}.
        </p>
      ) : null}
    </li>
  );
}
