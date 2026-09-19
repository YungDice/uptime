import { useEffect, useState } from "react";
import {
  DAY,
  formatDate,
  formatDuration,
  isRunning,
  splitStopwatch,
  statusOf,
  type Seconds,
} from "@/core";
import { isRevivable, type PublicProfile, type UptimeStore } from "@/data/store";
import { Avatar } from "@/components/Avatar";
import { Capsule, Row, Section } from "@/components/List";
import { Sheet } from "@/components/Sheet";

interface Props {
  userId: string;
  store: UptimeStore;
  /** Ticks once a second, so their counter runs the way yours does. */
  now: Seconds;
  /** What the viewer can give, live. Decides whether Send is offered. */
  giveable: Seconds;
  /**
   * Changes whenever the session took a new reading.
   *
   * Following, unfollowing, sending and reviving all hand back a snapshot of
   * *the viewer*, which says nothing about the person on screen - so without a
   * signal to re-read, tapping Follow here left the button saying Follow.
   */
  revision: Seconds;
  anonymous: boolean;
  onClose(): void;
  onSend(profile: PublicProfile): void;
  onRevive(profile: PublicProfile): void;
  onFollow(handle: string): void;
  onUnfollow(userId: string): void;
}

/**
 * Somebody else.
 *
 * Every name in this app has been a dead end: the friends list, the podium and
 * the rank rows all drew a person and then offered nothing to do about them
 * except, for friends you were already connected to, a Send button squeezed
 * onto the end of a row. There was nowhere to see who somebody was before
 * following them, which made the follow field - type an exact nickname, hope -
 * the only route into the entire social half of the product.
 *
 * Presented as a sheet rather than a fifth tab. It is a detour from wherever
 * you were and it should hand that place back when you are done with it: the
 * list you came from is still there behind the scrim, and closing this returns
 * you to the same scroll position rather than to the top of a tab.
 */
export function Profile({
  userId,
  store,
  now,
  giveable,
  revision,
  anonymous,
  onClose,
  onSend,
  onRevive,
  onFollow,
  onUnfollow,
}: Props) {
  const [state, setState] = useState<"loading" | "missing" | PublicProfile>("loading");

  // Two effects rather than one, and the split is the point: a *different*
  // person should blank the panel while it loads, and the same person being
  // re-read after an action should not. One effect that cleared on every run
  // would flash "Loading" over a profile you are standing on every time you
  // pressed a button on it.
  useEffect(() => {
    setState("loading");
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    void store
      .profile(userId)
      .then((found) => {
        if (!cancelled) setState(found ?? "missing");
      })
      .catch(() => {
        if (!cancelled) setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [store, userId, revision]);

  if (state === "loading") {
    return (
      <Sheet label="Profile" onClose={onClose} tall>
        <p className="py-16 text-center text-callout text-label-3">Loading</p>
      </Sheet>
    );
  }

  if (state === "missing") {
    return (
      <Sheet label="Profile" onClose={onClose} tall>
        <p className="py-16 text-center text-callout text-label-2">
          That account is no longer around.
        </p>
      </Sheet>
    );
  }

  const them = state;
  const status = statusOf(them.streak, now);
  const live = isRunning(status);
  const { days, clock } = splitStopwatch(live ? status.elapsed : 0);
  const canRevive = isRevivable(them) && them.connected;

  return (
    <Sheet label={`${them.profile.displayName}'s profile`} onClose={onClose} tall>
      <div className="pane -mx-5 min-h-0 flex-1 overflow-y-auto px-5">
        <header className="flex flex-col items-center pt-1">
          <span className="relative">
            {live ? (
              <span
                aria-hidden="true"
                className="bloom animate-breathe pointer-events-none absolute -inset-2 rounded-full"
                style={{ ["--tint" as string]: "var(--color-run)" }}
              />
            ) : null}
            <span className="relative block">
              <Avatar
                profile={them.profile}
                size={92}
                ring={live ? "run" : them.revive ? "lapse" : "hairline"}
              />
            </span>
          </span>

          <h2 className="mt-3 text-center text-title text-label">
            {them.profile.displayName}
          </h2>
          <p className="text-callout text-label-2">@{them.profile.handle}</p>

          <FollowState profile={them} />
        </header>

        {/* Their clock, run at the same scale and the same grammar as your own,
            because it is the same object. Anything smaller would make somebody
            else's 400 days look like a statistic about them rather than a
            stopwatch that is running right now. */}
        <div className="surface mt-5 rounded-2xl px-4 py-4 text-center">
          {live ? (
            <>
              <div className="flex items-baseline justify-center gap-2">
                <span
                  className="tnum text-display"
                  style={{ color: "var(--color-label)" }}
                >
                  {days}
                </span>
                <span className="text-callout font-medium text-label-2">
                  {days === 1 ? "day" : "days"}
                </span>
              </div>
              <p className="tnum mt-1.5 text-callout text-label-2">{clock}</p>
              <p className="mt-2 text-micro font-semibold tracking-[0.14em] text-run uppercase">
                Running
              </p>
            </>
          ) : them.revive ? (
            <>
              <p className="text-body text-lapse">Their streak broke</p>
              <p className="mt-1 text-footnote text-label-2">
                It ran {Math.floor(them.revive.lostLength / DAY)} days. Reviving brings back{" "}
                {Math.floor(them.revive.restores / DAY)} for {formatDuration(them.revive.cost)}.
              </p>
            </>
          ) : (
            <>
              <p className="text-body text-label-3">No streak running</p>
              <p className="mt-1 text-footnote text-label-2">
                Their clock is stopped. Nothing is counting.
              </p>
            </>
          )}
        </div>

        <div className="mt-4 flex gap-2.5">
          {them.connected ? (
            <Capsule
              tone="bank"
              solid
              wide
              disabled={anonymous || giveable <= 0}
              onClick={() => onSend(them)}
            >
              Send Time
            </Capsule>
          ) : them.iFollow ? (
            <Capsule wide onClick={() => onUnfollow(them.profile.id)}>
              Following
            </Capsule>
          ) : (
            <Capsule tone="run" solid wide onClick={() => onFollow(them.profile.handle)}>
              {them.followsMe ? "Follow back" : "Follow"}
            </Capsule>
          )}

          {canRevive ? (
            <Capsule tone="run" wide disabled={anonymous} onClick={() => onRevive(them)}>
              Revive
            </Capsule>
          ) : null}
        </div>

        {them.connected ? (
          <button
            type="button"
            onClick={() => onUnfollow(them.profile.id)}
            className="mt-3 w-full text-center text-footnote text-label-2"
          >
            Unfollow
          </button>
        ) : null}

        <Section title="Record">
          <Row label="Longest run" value={formatDuration(them.personalBest)} tone="run" />
          <Row label="Time kept in total" value={formatDuration(them.lifetimeSeconds)} />
          <Row label="Given away" value={formatDuration(them.totalSent)} tone="bank" />
          <Row label="Received" value={formatDuration(them.totalReceived)} />
          <Row label="Streaks rescued" value={`${them.rescues}`} />
          <Row label="Here since" value={formatDate(them.profile.createdAt)} />
        </Section>

        <div className="h-4" />
      </div>
    </Sheet>
  );
}

/**
 * Which way the follow points, said once, under the name.
 *
 * Three states and they are genuinely different situations, so none of them
 * gets to share a caption with another: mutual is the only one where time can
 * move, one-way-out is waiting on them, one-way-in is waiting on you.
 */
function FollowState({ profile }: { profile: PublicProfile }) {
  const { connected, iFollow, followsMe } = profile;

  const [text, tint] = connected
    ? ["You follow each other", "var(--color-bank)"]
    : followsMe
      ? ["Follows you", "var(--color-run)"]
      : iFollow
        ? ["Waiting for them to follow back", "var(--color-label-2)"]
        : ["Not connected", "var(--color-label-3)"];

  return (
    <span
      className="surface-tint mt-2.5 rounded-full px-3 py-1 text-caption font-medium"
      style={{ color: tint, ["--tint" as string]: tint }}
    >
      {text}
    </span>
  );
}
