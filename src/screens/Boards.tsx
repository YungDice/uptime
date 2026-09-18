import { useEffect, useState } from "react";
import { BOARDS, formatDuration, type BoardEntry, type BoardId } from "@/core";
import type { UptimeStore } from "@/data/store";

/**
 * Read-only queries over what the streak and ledger already store. Nothing
 * here is a maintained total, so a board can never disagree with a profile.
 */
export function Boards({ store, meId }: { store: UptimeStore; meId: string }) {
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
    <div className="flex flex-col gap-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {BOARDS.map((board) => (
          <button
            key={board.id}
            type="button"
            onClick={() => setActive(board.id)}
            className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              board.id === active
                ? "bg-pulse/15 text-pulse"
                : "bg-surface text-muted hover:text-ink-text"
            }`}
          >
            {board.label}
          </button>
        ))}
      </div>

      {meta ? <p className="text-sm text-muted">{meta.blurb}</p> : null}

      {entries === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="rounded-2xl bg-surface p-5 text-sm text-muted">
          Nothing on this board yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {entries.map((entry, index) => (
            <li
              key={entry.userId}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
                entry.userId === meId ? "bg-pulse/10" : "bg-surface"
              }`}
            >
              <span className="tnum w-6 font-mono text-xs text-muted">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-text">
                {entry.displayName}
              </span>
              <span className="tnum font-mono text-sm text-pulse">
                {entry.unit === "count"
                  ? `${entry.value}`
                  : formatDuration(entry.value)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
