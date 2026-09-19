import { formatDuration, type BoardEntry } from "@/core";
import { Avatar } from "./Avatar";

/**
 * The top three, standing on blocks.
 *
 * A leaderboard's first rows are not the same kind of information as its
 * fortieth, and a uniform list says they are. Giving the podium its own shape
 * is the one place this screen spends vertical space, so it is also the only
 * place the board gets a figure larger than a row.
 *
 * Read order is the catch: first place belongs in the middle, which is not
 * where a list would put it. The columns are therefore rendered 2-1-3 and the
 * markup is ordered to match what the eye does, while the surrounding list
 * keeps the honest ordering for anyone reading it linearly.
 *
 * The blocks are struck in their metals now. Three identical grey plinths with
 * a numeral on each was a bar chart of a quantity nobody cares about - the
 * heights were already saying the order, so the colour was spare, and gold,
 * silver and bronze are the one place in this app where a colour is the name of
 * the thing rather than a decoration on it.
 */
export function Podium({
  entries,
  meId,
  onOpen,
}: {
  entries: BoardEntry[];
  meId: string;
  onOpen(userId: string): void;
}) {
  const [first, second, third] = entries;
  if (first === undefined) return null;

  // With one or two entries there is no podium to speak of - three blocks
  // holding one person reads as a mistake rather than as a win.
  if (second === undefined) {
    return (
      <div className="flex justify-center px-5 pt-6">
        <Step entry={first} place={1} meId={meId} onOpen={onOpen} />
      </div>
    );
  }

  return (
    <div className="px-5 pt-7">
      {/* A hairline crack rather than a gap: the blocks are one podium, and
          spacing them apart turns it into three unrelated plinths. */}
      <ol className="flex items-end justify-center gap-px">
        <Step entry={second} place={2} meId={meId} onOpen={onOpen} />
        <Step entry={first} place={1} meId={meId} onOpen={onOpen} />
        {third !== undefined ? (
          <Step entry={third} place={3} meId={meId} onOpen={onOpen} />
        ) : (
          <span className="w-1/3" />
        )}
      </ol>
      {/* The floor. Without it the blocks stop mid-air against a true-black
          page and read as three clipped rectangles rather than as a podium
          standing on something. */}
      <div
        aria-hidden="true"
        className="h-px w-full"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--color-hairline) 12%, var(--color-hairline) 88%, transparent)",
        }}
      />
    </div>
  );
}

const SHAPE = {
  1: { avatar: 74, pedestal: 72, metal: "gold" as const, delay: 0 },
  2: { avatar: 54, pedestal: 50, metal: "silver" as const, delay: 70 },
  3: { avatar: 54, pedestal: 36, metal: "bronze" as const, delay: 140 },
};

function Step({
  entry,
  place,
  meId,
  onOpen,
}: {
  entry: BoardEntry;
  place: 1 | 2 | 3;
  meId: string;
  onOpen(userId: string): void;
}) {
  const shape = SHAPE[place];
  const isMe = entry.userId === meId;
  const metal = `var(--color-${shape.metal})`;

  return (
    <li
      className="animate-deal flex w-1/3 min-w-0 flex-col items-center justify-end"
      value={place}
      style={{ animationDelay: `${shape.delay}ms` }}
    >
      <button
        type="button"
        onClick={() => onOpen(entry.userId)}
        className="flex w-full min-w-0 flex-col items-center transition-transform active:scale-[0.97]"
        aria-label={`Open ${entry.displayName}'s profile`}
      >
        <span className="relative">
          {/* First place gets a halo. It is the only element on this screen
              that is purely celebratory, and one is the right number. */}
          {place === 1 ? (
            <span
              aria-hidden="true"
              className="bloom pointer-events-none absolute -inset-3 rounded-full"
              style={{ ["--tint" as string]: metal }}
            />
          ) : null}
          <span className="relative block">
            <Avatar profile={entry} size={shape.avatar} ring={shape.metal} />
          </span>
        </span>

        {/* Fixed height, so how high a face stands is decided by its block alone.
            Left to the text, a two-line name would push its own avatar up and
            quietly outrank the person above it. */}
        <span className="mt-2 flex h-[42px] w-full flex-col justify-start">
          <span
            className={`w-full truncate text-center text-[13px] font-semibold ${
              isMe ? "text-run" : "text-label"
            }`}
          >
            {entry.displayName}
          </span>
          <span className="tnum w-full truncate text-center text-[13px] text-label-2">
            {entry.unit === "count" ? entry.value : formatDuration(entry.value)}
          </span>
        </span>

        <span
          className="flex w-full items-start justify-center rounded-t-xl pt-2"
          style={{
            height: shape.pedestal,
            // The block is the metal, at low alpha so a name above it still
            // reads, with the full-strength metal as a lit top edge.
            background: `linear-gradient(180deg, color-mix(in srgb, ${metal} 26%, #141416) 0%, color-mix(in srgb, ${metal} 7%, #121214) 100%)`,
            boxShadow: `inset 0 2px 0 0 ${metal}`,
          }}
        >
          <span
            aria-hidden="true"
            className="tnum text-[22px] font-bold"
            style={{ color: metal }}
          >
            {place}
          </span>
        </span>
      </button>
    </li>
  );
}
