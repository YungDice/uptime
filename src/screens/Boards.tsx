import { useEffect, useState } from "react";
import { BOARDS, formatDuration, type BoardEntry, type BoardId } from "@/core";
import type { UptimeStore } from "@/data/store";
import { Row } from "@/components/List";

/**
 * Read-only queries over what the streak and ledger already store, presented
 * as lap rows under a segmented control - the Clock app's own way of switching
 * between views of the same thing.
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
    <div className="pb-4">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-5 pt-3 pb-1">
        {BOARDS.map((board) => {
          const on = board.id === active;
          return (
            <button
              key={board.id}
              type="button"
              onClick={() => setActive(board.id)}
              className="shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors"
              style={{
                color: on ? "var(--color-run)" : "var(--color-label-2)",
                background: on
                  ? "color-mix(in srgb, var(--color-run) 18%, transparent)"
                  : "var(--color-raise)",
              }}
            >
              {board.label}
            </button>
          );
        })}
      </div>

      {meta ? <p className="px-5 pt-2 text-[13px] text-label-2">{meta.blurb}</p> : null}

      {entries === null ? (
        <p className="px-5 py-10 text-center text-[15px] text-label-3">Loading</p>
      ) : entries.length === 0 ? (
        <p className="px-5 py-10 text-center text-[15px] text-label-2">
          Nothing on this board yet.
        </p>
      ) : (
        <div className="mt-5 border-t border-hairline">
          {entries.map((entry, index) => (
            <Row
              key={entry.userId}
              label={
                <span className="flex items-baseline gap-3">
                  <span className="tnum w-5 text-[15px] text-label-3">{index + 1}</span>
                  <span className={entry.userId === meId ? "text-run" : undefined}>
                    {entry.displayName}
                  </span>
                </span>
              }
              value={entry.unit === "count" ? `${entry.value}` : formatDuration(entry.value)}
              tone={entry.userId === meId ? "run" : "default"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
