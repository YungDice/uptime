import { useEffect, useRef, useState } from "react";
import {
  DAY,
  achievementsFor,
  formatDate,
  formatDuration,
  isRunning,
  statusOf,
  BOARDS,
  type BoardId,
  type Seconds,
} from "@/core";
import {
  ANONYMOUS_LIMITS,
  liveGiveable,
  type RankInfo,
  type Snapshot,
  type UptimeStore,
} from "@/data/store";
import { Capsule, Row, Section } from "@/components/List";
import { Avatar } from "@/components/Avatar";
import { LiveTime } from "@/components/LiveTime";
import { Medal } from "@/components/Medal";

interface Props {
  snapshot: Snapshot;
  store: UptimeStore;
  /** Ticks once a second, so the figure that grows can be seen growing. */
  now: Seconds;
  onSignUp(email: string, password: string, handle: string): void;
  onSignIn(email: string, password: string): void;
  onSignOut(): void;
  onSetHandle(handle: string): void;
  onSetDisplayName(name: string): void;
  onSetAvatar(file: File | null): void;
}

export function Account(props: Props) {
  return props.snapshot.account.isAnonymous ? <Anonymous {...props} /> : <SignedIn {...props} />;
}

/**
 * The anonymous state, written as a choice rather than a warning.
 *
 * The streak is already real and already running, so this does not beg. It
 * says what an account adds and, most importantly, that making one does not
 * cost the run - which is the only thing a user with 95 days on the clock
 * actually wants to know.
 */
function Anonymous({ snapshot, onSignUp, onSignIn }: Props) {
  const [mode, setMode] = useState<"up" | "in">("up");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const days = Math.max(0, Math.floor(snapshot.personalBest / DAY));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === "up") onSignUp(email, password, nickname);
    else onSignIn(email, password);
  };

  return (
    <div className="pb-4">
      <p className="px-5 pt-5 text-callout text-label-2">
        You're playing without an account. Your clock is running and your streak is real - it just
        stays on this device, and two things stay switched off:
      </p>
      <ul className="mt-3 px-5">
        {ANONYMOUS_LIMITS.map((limit) => (
          <li key={limit} className="flex gap-2.5 py-1 text-callout text-label">
            <span aria-hidden="true" className="text-label-3">
              &mdash;
            </span>
            {limit}
          </li>
        ))}
      </ul>

      <div className="mt-6 px-5">
        <div
          role="tablist"
          aria-label="Account"
          className="flex gap-1 rounded-full p-1"
          style={{ background: "var(--color-raise)" }}
        >
          {(["up", "in"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className="flex-1 rounded-full py-1.5 text-callout font-medium transition-colors"
              style={{
                color: mode === m ? "var(--color-run)" : "var(--color-label-2)",
                background:
                  mode === m ? "color-mix(in srgb, var(--color-run) 22%, transparent)" : "transparent",
              }}
            >
              {m === "up" ? "New account" : "Sign in"}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-2 px-5">
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === "up" ? "new-password" : "current-password"}
        />
        {mode === "up" ? (
          <Field
            label="Nickname"
            value={nickname}
            onChange={setNickname}
            hint="How friends find you. Letters, numbers and underscores."
          />
        ) : null}

        <div className="mt-3">
          {/* type="submit" is load-bearing: Capsule defaults to a plain button,
              and a form whose only control is one cannot be submitted at all -
              with three fields the browser suppresses Enter as well. */}
          <Capsule type="submit" tone="run" wide>
            {mode === "up" ? "Create account" : "Sign in"}
          </Capsule>
        </div>
      </form>

      {mode === "up" ? (
        <p className="mt-4 px-5 text-footnote text-label-2">
          {days > 0
            ? `Your ${days}-day record and your banked time carry over - creating an account upgrades this one rather than starting a new one.`
            : "Creating an account upgrades this one rather than starting a new one, so whatever is on the clock stays on it."}
        </p>
      ) : (
        <p className="mt-4 px-5 text-footnote text-label-2">
          Signing in replaces the streak on this device with the one on your account.
        </p>
      )}
    </div>
  );
}

function SignedIn({
  snapshot,
  store,
  now,
  onSignOut,
  onSetHandle,
  onSetDisplayName,
  onSetAvatar,
}: Props) {
  const { me, account } = snapshot;
  const [nickname, setNickname] = useState(me.handle);
  const [name, setName] = useState(me.displayName);
  const [editing, setEditing] = useState(false);
  const file = useRef<HTMLInputElement | null>(null);

  const running = isRunning(statusOf(me.streak, now));
  // Rank a running streak by the run itself; rank a stopped one by its record,
  // because "unranked" is a worse answer than "your best ever put you 12th".
  const placingBoard: BoardId = running ? "current-streak" : "longest-ever";
  const placing = useRank(store, placingBoard);
  const rescues = useRank(store, "most-revives");

  const achievements = achievementsFor({
    personalBest: snapshot.personalBest,
    lifetimeSeconds: me.lifetimeSeconds,
    totalSent: snapshot.totalSent,
    rescues: typeof rescues?.value === "number" ? rescues.value : 0,
    best:
      placing === null
        ? null
        : {
            position: placing.position,
            of: placing.of,
            label: BOARDS.find((b) => b.id === placingBoard)?.label ?? "Board",
          },
  });

  return (
    <div className="pb-4">
      {/* --- identity ---------------------------------------------------- */}
      <header className="flex flex-col items-center px-5 pt-4">
        <button
          type="button"
          onClick={() => file.current?.click()}
          className="relative rounded-full transition-transform active:scale-[0.97]"
          aria-label={me.avatarUrl === null ? "Add a profile picture" : "Change profile picture"}
        >
          {running ? (
            <span
              aria-hidden="true"
              className="bloom animate-breathe pointer-events-none absolute -inset-2 rounded-full"
              style={{ ["--tint" as string]: "var(--color-run)" }}
            />
          ) : null}
          <span className="relative block">
            <Avatar profile={me} size={92} ring={running ? "run" : "hairline"} />
          </span>
          <span
            aria-hidden="true"
            className="surface-2 absolute right-0.5 bottom-0.5 flex h-7 w-7 items-center justify-center rounded-full"
            style={{ boxShadow: "0 0 0 2px var(--color-void), var(--bezel-strong)" }}
          >
            <CameraIcon />
          </span>
        </button>
        {/* `image/*` rather than the three formats that get stored. The file
            is re-encoded before it is uploaded, so the stored format is not
            the picked one and naming it here only narrows the picker. It also
            buys the one case that matters: an iPhone hands a HEIC straight
            through to a filter that lists it, and transcodes it to JPEG for a
            filter that asks for images in general. */}
        <input
          ref={file}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) onSetAvatar(chosen);
            // Cleared so choosing the same file twice still fires a change.
            event.target.value = "";
          }}
        />

        <h2 className="mt-3 text-title text-label">
          {me.displayName}
        </h2>
        <p className="text-callout text-label-2">@{me.handle}</p>

        {me.avatarUrl !== null ? (
          <button
            type="button"
            onClick={() => onSetAvatar(null)}
            className="mt-1.5 text-footnote text-label-2"
          >
            Remove photo
          </button>
        ) : null}
      </header>

      {/* --- the three numbers -------------------------------------------
          Three cut surfaces rather than three columns of text on the page.
          They were floating in the black with nothing to group them, so they
          read as a caption under the avatar rather than as this account's
          headline figures. */}
      <div className="mt-6 grid grid-cols-3 gap-2 px-5">
        <Stat
          label="Rank"
          value={placing === null ? "--" : `#${placing.position}`}
          tone={placing !== null && placing.position <= 3 ? "run" : "default"}
        />
        <Stat label="Best run" value={formatDuration(snapshot.personalBest)} />
        <Stat
          label="To give"
          tone="bank"
          value={<LiveTime compact seconds={liveGiveable(snapshot, now)} />}
        />
      </div>

      {achievements.length > 0 ? (
        <Section title="Achievements">
          <ul className="grid grid-cols-3 gap-x-2 gap-y-5 px-5 pt-4">
            {achievements.map((item, index) => (
              <Medal key={item.id} achievement={item} delay={index * 50} />
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Account">
        <Row label="Email" value={account.email ?? "--"} />
        <Row label="Member since" value={formatDate(me.createdAt)} />
        <Row
          label="Time given"
          value={formatDuration(snapshot.totalSent)}
          tone={snapshot.totalSent > 0 ? "bank" : "default"}
        />
      </Section>

      {/* Editing is folded away by default: the names are set once and then
          looked at, so the fields were the loudest thing on a screen whose
          subject is supposed to be the person. */}
      <Section title="Profile">
        {editing ? (
          <div className="flex flex-col gap-2 py-3 pr-5 pl-5">
            <Field label="Display name" value={name} onChange={setName} />
            <div className="flex justify-end">
              <Pill onClick={() => onSetDisplayName(name)} disabled={name.trim() === me.displayName}>
                Save name
              </Pill>
            </div>

            <Field
              label="Nickname"
              value={nickname}
              onChange={setNickname}
              hint="How friends find you."
            />
            <div className="flex justify-end gap-2">
              <Pill
                onClick={() => onSetHandle(nickname)}
                disabled={nickname.trim().toLowerCase() === me.handle}
              >
                Save nickname
              </Pill>
              <Pill onClick={() => setEditing(false)} tone="quiet">
                Done
              </Pill>
            </div>
          </div>
        ) : (
          <Row label="Name and nickname" value="Edit" onClick={() => setEditing(true)} />
        )}
      </Section>

      <div className="px-5 pt-6">
        <div className="flex">
          <Capsule tone="lapse" wide onClick={onSignOut}>
            Sign out
          </Capsule>
        </div>
        <p className="mt-3 text-footnote text-label-2">
          Signing out leaves this device on a fresh anonymous clock. Your account keeps its streak.
        </p>
      </div>
    </div>
  );
}

/**
 * One placing, fetched once per board.
 *
 * A rank is a count over every account, so it cannot come out of the snapshot
 * the way a balance does - and it is worth exactly one round trip, not one per
 * render.
 */
function useRank(store: UptimeStore, board: BoardId): RankInfo | null {
  const [rank, setRank] = useState<RankInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void store
      .myRank(board)
      .then((value) => {
        if (!cancelled) setRank(value);
      })
      // An unranked account is an ordinary answer, and so is a board that
      // could not be read; neither is worth taking the screen down for.
      .catch(() => {
        if (!cancelled) setRank(null);
      });
    return () => {
      cancelled = true;
    };
  }, [store, board]);

  return rank;
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  /** A node, not a string: one of these is a figure that is still moving. */
  value: React.ReactNode;
  tone?: "default" | "run" | "bank";
}) {
  const color =
    tone === "run" ? "var(--color-run)" : tone === "bank" ? "var(--color-bank)" : "var(--color-label)";

  return (
    <div className="surface rounded-xl px-2 py-3 text-center">
      <div
        className="tnum truncate text-body font-semibold"
        style={{ color }}
      >
        {value}
      </div>
      <div className="mt-1 text-overline text-label-3 uppercase">
        {label}
      </div>
    </div>
  );
}

function Pill({
  children,
  onClick,
  disabled,
  tone = "run",
}: {
  children: React.ReactNode;
  onClick(): void;
  disabled?: boolean;
  tone?: "run" | "quiet";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full px-3 py-1.5 text-footnote font-medium disabled:opacity-35"
      style={
        tone === "run"
          ? {
              color: "var(--color-run)",
              background: "color-mix(in srgb, var(--color-run) 18%, transparent)",
            }
          : { color: "var(--color-label-2)", background: "var(--color-raise)" }
      }
    >
      {children}
    </button>
  );
}

function CameraIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <g
        fill="none"
        stroke="var(--color-label)"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3.5 8.8h3.1l1.4-2.2h8l1.4 2.2h3.1v10H3.5z" />
        <circle cx="12" cy="13.4" r="3.3" />
      </g>
    </svg>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  hint,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange(next: string): void;
  type?: string;
  hint?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="block pb-1 text-footnote text-label-2">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="w-full rounded-xl bg-raise px-4 py-2.5 text-body text-label placeholder:text-label-2 focus:outline-none"
      />
      {hint ? <span className="block pt-1 text-footnote text-label-2">{hint}</span> : null}
    </label>
  );
}
