import { DAY, formatDuration, isRunning, splitStopwatch, statusOf, type Seconds } from "@/core";
import type { FriendView } from "@/data/store";
import { Section } from "@/components/List";
import { Avatar } from "./Avatar";

interface Props {
  friends: FriendView[];
  /** What the viewer can give, live. Decides whether Send is offered. */
  giveable: Seconds;
  now: Seconds;
  onSend(friend: FriendView): void;
  onRevive(friend: FriendView): void;
  onOpen(friend: FriendView): void;
  /** Id of the friend a gift is currently landing on. */
  trailingTo: string | null;
}

/**
 * Friends as lap rows. One rigid grammar per record: name on the left, their
 * run on the right in tabular figures, actions trailing. A broken streak reads
 * in the lapse colour and carries what rescuing it costs.
 *
 * The name half of every row is now a button into that person's profile, and
 * the action buttons sit outside it - a row cannot be one big button with
 * smaller buttons inside it, and the two jobs are different enough that they
 * should not have been sharing a target anyway.
 */
export function FriendList({ friends, giveable, now, onSend, onRevive, onOpen, trailingTo }: Props) {
  if (friends.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-callout text-label-2">
        Nobody here yet. Follow someone by nickname above - time only moves between people who
        follow each other.
      </p>
    );
  }

  const running = friends.filter((f) => isRunning(statusOf(f.streak, now)));
  const stopped = friends.filter((f) => !isRunning(statusOf(f.streak, now)));

  const rows = (list: FriendView[]) =>
    list.map((friend, index) => (
      <FriendRow
        key={friend.profile.id}
        friend={friend}
        giveable={giveable}
        now={now}
        delay={index * 24}
        onSend={() => onSend(friend)}
        onRevive={() => onRevive(friend)}
        onOpen={() => onOpen(friend)}
        trailing={trailingTo === friend.profile.id}
      />
    ));

  return (
    <>
      {running.length > 0 ? (
        <Section title={`Running (${running.length})`}>{rows(running)}</Section>
      ) : null}
      {stopped.length > 0 ? <Section title="Stopped">{rows(stopped)}</Section> : null}
    </>
  );
}

function FriendRow({
  friend,
  giveable,
  now,
  delay,
  onSend,
  onRevive,
  onOpen,
  trailing,
}: {
  friend: FriendView;
  giveable: Seconds;
  now: Seconds;
  delay: number;
  onSend(): void;
  onRevive(): void;
  onOpen(): void;
  trailing: boolean;
}) {
  const status = statusOf(friend.streak, now);
  const live = isRunning(status);
  const canAfford = friend.revive ? giveable >= friend.revive.cost : false;
  // A gift lands on their running clock, so a stopped one has nowhere to put
  // it. A lapsed one gets the Revive button instead.
  const canGive = friend.connected && giveable > 0 && live;
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
      className="surface-tint shrink-0 rounded-full px-3.5 py-1.5 text-footnote font-semibold transition-transform active:scale-95 disabled:opacity-35"
      style={{ color: "var(--color-bank)", ["--tint" as string]: "var(--color-bank)" }}
    >
      Send
    </button>
  );

  return (
    <div
      className="animate-deal relative overflow-hidden pl-5"
      style={{ animationDelay: `${delay}ms` }}
    >
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

      <div className="relative flex min-h-[52px] items-center gap-3 py-3 pr-5">
        <button
          type="button"
          onClick={onOpen}
          className="-my-1 flex min-w-0 flex-1 items-center gap-3 py-1 text-left transition-opacity active:opacity-60"
        >
          <Avatar
            profile={friend.profile}
            size={42}
            ring={live ? "run" : friend.revive ? "lapse" : undefined}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body text-label">
              {friend.profile.displayName}
            </span>
            <span className="mt-0.5 block truncate text-footnote text-label-2">
              @{friend.profile.handle}
            </span>
          </span>
          <span className="tnum shrink-0 text-right">
            {live ? (
              <span className="flex items-baseline gap-1.5">
                <span className="text-body text-label">{days}d</span>
                <span className="text-callout text-label-2">{clock}</span>
              </span>
            ) : friend.revive ? (
              <span className="text-callout text-lapse">Broken</span>
            ) : (
              <span className="text-callout text-label-3">Stopped</span>
            )}
          </span>
        </button>
        {stacked ? null : <div className="shrink-0">{sendButton}</div>}
      </div>
      {stacked ? null : <div className="hairline" />}

      {/* The explanation and the actions share a line, so a row only grows
          when it has a reason to. At phone width a name, a running clock and
          two controls cannot sit on one line without the name wrapping. */}
      {stacked ? (
        <div className="hairline relative flex items-center gap-2 pr-5 pb-3">
          <p className="flex-1 text-footnote text-label-2">{note}</p>
          {friend.revive ? (
            <button
              type="button"
              onClick={onRevive}
              disabled={!canAfford || !friend.connected}
              className="surface-tint shrink-0 rounded-full px-3.5 py-1.5 text-footnote font-semibold transition-transform active:scale-95 disabled:opacity-35"
              style={{ color: "var(--color-run)", ["--tint" as string]: "var(--color-run)" }}
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
