import { useState } from "react";
import {
  activityFor,
  formatAgo,
  formatDuration,
  isIncoming,
  type ActivityItem,
  type Seconds,
} from "@/core";
import type { UserProfile } from "@/core/types";
import { personIn, type Snapshot } from "@/data/store";
import { Avatar } from "./Avatar";
import { Row, Section } from "./List";

/** Rows shown before "Show all". The snapshot carries up to twelve. */
const FOLDED = 4;

/**
 * Time that moved between you and other people, newest first.
 *
 * A gift moves two clocks and nothing else, so without this a friend's two
 * days arrived as a bigger number and no reason for it - and a rescue, the
 * biggest thing another person can do for you here, was silent.
 *
 * Incoming rows since the previous visit say "New". `windowAnchor` is the
 * `last_seen` from before this visit, which is exactly that line.
 */
export function RecentActivity({
  snapshot,
  now,
  onOpen,
}: {
  snapshot: Snapshot;
  now: Seconds;
  onOpen(userId: string): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = activityFor(snapshot.me.id, snapshot.recentGifts, snapshot.me.history);
  if (items.length === 0) return null;

  const shown = expanded ? items : items.slice(0, FOLDED);

  return (
    <Section title="Recent">
      <ul>
        {shown.map((item) => (
          <ActivityRow
            key={item.id}
            item={item}
            who={personIn(snapshot, item.otherId)}
            fresh={isIncoming(item) && item.at > snapshot.windowAnchor}
            now={now}
            onOpen={() => onOpen(item.otherId)}
          />
        ))}
      </ul>
      {items.length > shown.length ? (
        <Row
          label={<span className="text-run">Show all {items.length}</span>}
          onClick={() => setExpanded(true)}
        />
      ) : null}
    </Section>
  );
}

/**
 * One line saying what arrived while the app was closed, or null.
 *
 * Shown once, on launch. The list above keeps the detail; this exists because
 * the list is below the fold and the number on the face is not.
 */
export function arrivalNotice(snapshot: Snapshot): string | null {
  const arrived = activityFor(snapshot.me.id, snapshot.recentGifts, snapshot.me.history).filter(
    (item) => isIncoming(item) && item.at > snapshot.windowAnchor,
  );
  if (arrived.length === 0) return null;

  const name = (userId: string) => personIn(snapshot, userId)?.displayName ?? "someone";
  const parts: string[] = [];

  const revive = arrived.find((item) => item.kind === "revived-you");
  if (revive) {
    parts.push(
      `${name(revive.otherId)} revived your streak` +
        (revive.restored ? ` - ${formatDuration(revive.restored)} back` : ""),
    );
  }

  const gifts = arrived.filter((item) => item.kind === "received");
  if (gifts.length > 0) {
    const senders = new Set(gifts.map((g) => g.otherId));
    const total = gifts.reduce((sum, g) => sum + g.amount, 0);
    const who = senders.size === 1 ? name(gifts[0]!.otherId) : "friends";
    parts.push(`${who} sent you ${formatDuration(total)}`);
  }

  return `While you were away, ${parts.join(", and ")}.`;
}

/** What the row says happened, the signed amount, and its colour. */
function describe(item: ActivityItem): { what: string; value: string | null; color: string } {
  switch (item.kind) {
    case "received":
      return {
        what: "Sent you time",
        value: `+${formatDuration(item.amount)}`,
        color: "var(--color-bank)",
      };
    case "sent":
      return {
        what: "You sent them time",
        value: `−${formatDuration(item.amount)}`,
        color: "var(--color-label-2)",
      };
    case "revived-you":
      return {
        what: "Revived your streak",
        value: item.restored ? `+${formatDuration(item.restored)}` : null,
        color: "var(--color-run)",
      };
    case "you-revived":
      return {
        what: "You revived their streak",
        value: `−${formatDuration(item.amount)}`,
        color: "var(--color-label-2)",
      };
  }
}

function ActivityRow({
  item,
  who,
  fresh,
  now,
  onOpen,
}: {
  item: ActivityItem;
  who: UserProfile | null;
  fresh: boolean;
  now: Seconds;
  onOpen(): void;
}) {
  const { what, value, color } = describe(item);
  const name = who?.displayName ?? "Someone";

  return (
    <li className="pl-5">
      <button
        type="button"
        onClick={onOpen}
        className="hairline flex min-h-[52px] w-full items-center gap-3 py-2.5 pr-5 text-left transition-colors active:bg-raise"
      >
        <Avatar profile={who ?? { displayName: name, avatarUrl: null }} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-label">{name}</span>
          <span className="mt-0.5 block truncate text-footnote text-label-2">
            {fresh ? <span className="font-medium text-bank">New · </span> : null}
            {what} · {formatAgo(item.at, now)}
          </span>
        </span>
        {value !== null ? (
          <span className="tnum shrink-0 text-body" style={{ color }}>
            {value}
          </span>
        ) : null}
      </button>
    </li>
  );
}
