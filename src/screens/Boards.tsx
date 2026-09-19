import { useEffect, useState } from "react";
import { BOARDS, formatDuration, type BoardEntry, type BoardId } from "@/core";
import type { UptimeStore } from "@/data/store";
import { Avatar } from "@/components/Avatar";
import { Podium } from "@/components/Podium";

/**
 * Read-only queries over what the streak and ledger already store.
 *
 * The board picker was a single scrolling row of chips, which meant four of the
 * six boards were off the right edge of a phone with nothing to say they were
 * there - a horizontal scroller inside a vertical one is a gesture people do
 * not find, and "Rescues" might as well not have shipped. There are six boards
 * and there is room for six, so all six are on screen: a fixed grid, two rows
 * of three, no gesture required to see what exists.
 */
export function Boards({
  store,
  meId,
  anonymous,
  onOpenAccount,
  onOpenProfile,
}: {
  store: UptimeStore;
  meId: string;
  anonymous: boolean;
  onOpenAccount(): void;
  onOpenProfile(userId: string): void;
}) {
  const [active, setActive] = useState<BoardId>("current-streak");
  const [entries, setEntries] = useState<BoardEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    void store.board(active).then((rows) => {
      if (!cancelled) setEntries(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [active, store]);

  const meta = BOARDS.find((b) => b.id === active);

  return (
    <div className="pb-4">
      <div className="grid grid-cols-3 gap-1.5 px-5 pt-3">
        {BOARDS.map((board) => {
          const on = board.id === active;
          return (
            <button
              key={board.id}
              type="button"
              onClick={() => setActive(board.id)}
              aria-pressed={on}
              className={`rounded-xl px-2 py-2.5 text-caption leading-tight font-semibold text-balance transition-transform active:scale-[0.97] ${
                on ? "surface-tint" : "surface"
              }`}
              style={
                on
                  ? { color: "var(--color-run)", ["--tint" as string]: "var(--color-run)" }
                  : { color: "var(--color-label-2)" }
              }
            >
              {board.label}
            </button>
          );
        })}
      </div>

      {meta ? <p className="px-5 pt-3 text-footnote text-label-2">{meta.blurb}</p> : null}

      {anonymous ? (
        <button
          type="button"
          onClick={onOpenAccount}
          className="mt-3 block w-full px-5 text-left text-footnote text-label-2"
        >
          You are not ranked while playing without an account.{" "}
          <span className="text-run">Create one</span> - your streak carries over.
        </button>
      ) : null}

      {entries === null ? (
        <p className="px-5 py-10 text-center text-callout text-label-3">Loading</p>
      ) : entries.length === 0 ? (
        <p className="px-5 py-10 text-center text-callout text-label-2">
          Nothing on this board yet.
        </p>
      ) : (
        // Keyed by board, so switching boards re-plays the entrance rather than
        // swapping names inside rows that never moved.
        <div key={active} className="mt-2">
          <Podium entries={entries.slice(0, 3)} meId={meId} onOpen={onOpenProfile} />

          {/* The podium has already shown the first three; repeating them at
              the top of the list would read as a duplicate rather than as a
              recap, so the rows pick up at fourth. */}
          {entries.length > 3 ? (
            <ol className="mt-6">
              {entries.slice(3).map((entry, index) => (
                <RankRow
                  key={entry.userId}
                  entry={entry}
                  place={index + 4}
                  isMe={entry.userId === meId}
                  delay={index * 22}
                  onOpen={() => onOpenProfile(entry.userId)}
                />
              ))}
            </ol>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * One placing below the podium.
 *
 * Its own component rather than the shared `Row` because a rank row is not a
 * label-and-value pair: the numeral is a column of its own that has to stay
 * aligned down the whole list whether it is 4 or 40, and the whole row is now a
 * way into somebody's profile.
 */
function RankRow({
  entry,
  place,
  isMe,
  delay,
  onOpen,
}: {
  entry: BoardEntry;
  place: number;
  isMe: boolean;
  delay: number;
  onOpen(): void;
}) {
  return (
    <li className="animate-deal" style={{ animationDelay: `${delay}ms` }}>
      <button
        type="button"
        onClick={onOpen}
        className="hairline flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors active:bg-raise"
      >
        <span
          className="tnum w-6 shrink-0 text-callout font-medium"
          style={{ color: isMe ? "var(--color-run)" : "var(--color-label-3)" }}
        >
          {place}
        </span>
        <Avatar profile={entry} size={34} />
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-body"
            style={{ color: isMe ? "var(--color-run)" : "var(--color-label)" }}
          >
            {entry.displayName}
          </span>
          <span className="block truncate text-caption text-label-3">@{entry.handle}</span>
        </span>
        <span
          className="tnum shrink-0 text-body"
          style={{ color: isMe ? "var(--color-run)" : "var(--color-label-2)" }}
        >
          {entry.unit === "count" ? entry.value : formatDuration(entry.value)}
        </span>
        <Chevron />
      </button>
    </li>
  );
}

function Chevron() {
  return (
    <svg width="8" height="13" viewBox="0 0 8 13" aria-hidden="true" className="shrink-0">
      <path
        d="M1.5 1.5L6.5 6.5L1.5 11.5"
        fill="none"
        stroke="var(--color-label-3)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
