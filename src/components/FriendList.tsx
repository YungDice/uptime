import { DAY, formatDuration, isRunning, splitStopwatch, statusOf, type Seconds } from "@/core";
import type { FriendView } from "@/data/store";
import { Section } from "@/components/List";

interface Props {
  friends: FriendView[];
  balance: Seconds;
  now: Seconds;
  onSend(friend: FriendView): void;
  onRevive(friend: FriendView): void;
  /** Id of the friend a gift is currently landing on. */
  trailingTo: string | null;
}

/**
 * Friends as lap rows. One rigid grammar per record: name on the left, their
 * run on the right in tabular figures, actions trailing. A broken streak reads
 * in the lapse colour and carries what rescuing it costs.
 */
export function FriendList({ friends, balance, now, onSend, onRevive, trailingTo }: Props) {
  if (friends.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-[15px] text-label-2">
        Nobody here yet. Follow someone by handle above - time only moves between people who
        follow each other.
      </p>
    );
  }

  const running = friends.filter((f) => isRunning(statusOf(f.streak, now)));
  const stopped = friends.filter((f) => !isRunning(statusOf(f.streak, now)));

  return (
    <>
      {running.length > 0 ? (
        <Section title="Running">
          {running.map((friend) => (
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
        </Section>
      ) : null}

      {stopped.length > 0 ? (
        <Section title="Stopped">
          {stopped.map((friend) => (
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
        </Section>
      ) : null}
    </>
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
  const { days, clock } = splitStopwatch(live ? status.elapsed : 0);

  // A second line is only worth its height when it has something to say. A
  // connected, running friend needs no explanation, so Send rides inline and
  // the row stays one line tall.
  const note = !friend.connected
    ? `Waiting for ${friend.profile.displayName} to follow you back`
    : friend.revive
      ? `Lost ${Math.floor(friend.revive.lostLength / DAY)} days - reviving brings back ${Math.floor(friend.revive.restores / DAY)}`
      : null;
  const stacked = note !== null;

  const sendButton = (
    <button
      type="button"
      onClick={onSend}
      disabled={!canGive}
      className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium disabled:opacity-35"
      style={{
        color: "var(--color-bank)",
        background: "color-mix(in srgb, var(--color-bank) 18%, transparent)",
      }}
    >
      Send
    </button>
  );

  return (
    <div className="hairline relative overflow-hidden pr-5 pl-5">
      {/* The second and last authored moment: time crossing to its recipient. */}
      {trailing ? (
        <span
          aria-hidden="true"
          className="animate-handoff pointer-events-none absolute inset-y-0 left-0 w-1/2"
          style={{
            background:
              "linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-bank) 55%, transparent), transparent)",
          }}
        />
      ) : null}

      <div className="relative flex min-h-[52px] items-center gap-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] text-label">{friend.profile.displayName}</div>
          <div className="mt-0.5 truncate text-[13px] text-label-2">@{friend.profile.handle}</div>
        </div>
        <div className="tnum shrink-0 text-right">
          {live ? (
            <span className="flex items-baseline gap-1.5">
              <span className="text-[17px] text-label">{days}d</span>
              <span className="text-[15px] text-label-2">{clock}</span>
            </span>
          ) : friend.revive ? (
            <span className="text-[15px] text-lapse">Broken</span>
          ) : (
            <span className="text-[15px] text-label-3">Stopped</span>
          )}
        </div>
        {stacked ? null : <div className="shrink-0 pl-1">{sendButton}</div>}
      </div>

      {/* The explanation and the actions share a line, so a row only grows
          when it has a reason to. At phone width a name, a running clock and
          two controls cannot sit on one line without the name wrapping. */}
      {stacked ? (
        <div className="relative flex items-center gap-2 pb-3">
          <p className="flex-1 text-[13px] text-label-2">{note}</p>
          {friend.revive ? (
            <button
              type="button"
              onClick={onRevive}
              disabled={!canAfford || !friend.connected}
              className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium disabled:opacity-35"
              style={{
                color: "var(--color-run)",
                background: "color-mix(in srgb, var(--color-run) 18%, transparent)",
              }}
            >
              Revive {formatDuration(friend.revive.cost)}
            </button>
          ) : null}
          {sendButton}
        </div>
      ) : null}
    </div>
  );
}
