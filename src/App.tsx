import { useEffect, useMemo, useRef, useState } from "react";
import {
  createStore,
  isBackedByServer,
  liveClock,
  liveGiveable,
  type CheckoutResult,
  type Revive,
  type SendTarget,
} from "@/data";
import type { UserProfile } from "@/core/types";
import { useSession } from "@/hooks/useSession";
import { useBackStack } from "@/hooks/useBackStack";
import { Home } from "@/screens/Home";
import { Boards } from "@/screens/Boards";
import { People } from "@/screens/People";
import { Account } from "@/screens/Account";
import { Profile } from "@/screens/Profile";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { SendSheet } from "@/components/SendSheet";
import { Shell } from "@/components/Shell";
import { UpdateOffer } from "@/components/UpdateOffer";
import { useUpdater } from "@/updates/useUpdater";
import { canBuyHere, openCheckout } from "@/payments/checkout";
import { DAY, formatDuration } from "@/core";
import type { Tab } from "@/components/TabBar";
import markUrl from "../brand/mark.svg";

export function App() {
  const store = useMemo(() => createStore(), []);
  const session = useSession(store, "you");
  const updater = useUpdater();
  const [tab, setTab] = useState<Tab>("clock");
  const [sending, setSending] = useState<SendTarget | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [confirmingStop, setConfirmingStop] = useState(false);
  /** A revive waiting on a yes: it spends days off your clock in one tap. */
  const [reviving, setReviving] = useState<{ profile: UserProfile; revive: Revive } | null>(null);
  const [trailingTo, setTrailingTo] = useState<string | null>(null);
  const [justCheckedIn, setJustCheckedIn] = useState(false);
  /** A checkout being started, so a second tap does not open a second page. */
  const buying = useRef(false);

  // What Android's back button unwinds, innermost first: any sheet, then the
  // profile behind it, then the tab, then the app itself. Without this, back
  // quits from wherever the user happens to be standing, which on a four-tab
  // app with two overlay layers is always wrong.
  const sheetOpen = sending !== null || confirmingStop || reviving !== null;
  useBackStack(
    (tab === "clock" ? 0 : 1) + (viewing !== null ? 1 : 0) + (sheetOpen ? 1 : 0),
    () => {
      if (sending) setSending(null);
      else if (reviving) setReviving(null);
      else if (confirmingStop) setConfirmingStop(false);
      else if (viewing !== null) setViewing(null);
      else setTab("clock");
    },
  );

  // Stripe sends a browser that paid, or gave up, back to CHECKOUT_RETURN_URL
  // with `?checkout=`. When that page is this app, say what happened - once
  // there is a screen to say it on - and take the parameter off the address,
  // so a reload does not say it again.
  const ready = session.snapshot !== null;
  const { announce } = session;
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("checkout");
    if (outcome === null) return;
    params.delete("checkout");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (query ? `?${query}` : "") + window.location.hash,
    );
    if (outcome === "done") {
      announce("good", "Payment received. Your whole clock unlocks here as soon as Stripe confirms it.");
    } else {
      announce("bad", "Payment cancelled. Nothing was charged.");
    }
  }, [ready, announce]);

  // The notice is a one-line confirmation, not a dialog; it clears itself.
  useEffect(() => {
    if (!session.notice) return;
    const timer = setTimeout(session.dismissNotice, 4000);
    return () => clearTimeout(timer);
  }, [session.notice, session.dismissNotice]);

  const { snapshot } = session;

  if (session.error && !snapshot) {
    return (
      <Shell tab={tab} onTab={setTab}>
        <p className="px-5 pt-16 text-center text-callout text-lapse">{session.error}</p>
      </Shell>
    );
  }

  // The first frame of every launch, so it is where the mark lives: the same
  // file the app icon is built from.
  if (!snapshot) {
    return (
      <Shell tab={tab} onTab={setTab}>
        <div className="flex flex-col items-center px-5 pt-24">
          <img src={markUrl} alt="" width={96} height={96} />
          <p className="mt-5 text-center text-callout text-label-2">Reading your clock</p>
        </div>
      </Shell>
    );
  }

  // One derivation, one place. Every surface that offers to spend time - the
  // home panel, the friend rows, the send sheet, the profile - has to agree
  // about how much there is. It comes off your running clock, so it is moving,
  // and they cannot each ask the snapshot separately and get the same answer.
  const giveable = liveGiveable(snapshot, session.now);
  // Not the same number on a free account: its share limits what it sends, but
  // a revive is paid off the whole clock. See liveClock.
  const spendable = liveClock(snapshot, session.now);
  const stoppedAfter = snapshot.me.streak.streakStart;

  // Offered only where it can be bought (not in the phone builds - see
  // canBuyHere) and only to an account that has not bought it yet.
  const canUnlock = canBuyHere() && !snapshot.sendsWholeClock;

  // Not through `session.run`: the usual answer is a page to open rather than
  // a snapshot, and the unlock itself arrives later, on the pulse.
  const buyWholeClock = async () => {
    if (buying.current) return;
    buying.current = true;
    try {
      let result: CheckoutResult;
      try {
        result = await store.buyWholeClock();
      } catch (err) {
        session.announce("bad", err instanceof Error ? err.message : "Could not start the payment.");
        return;
      }
      if ("checkoutUrl" in result) {
        try {
          await openCheckout(result.checkoutUrl);
          session.announce("good", result.message);
        } catch {
          session.announce("bad", "Could not open your browser for the payment page.");
        }
        return;
      }
      // A refusal, or the local adapter unlocking on the spot: an ordinary
      // action result, applied like any other.
      await session.run(async () => result);
    } finally {
      buying.current = false;
    }
  };

  // Tapping your own name on a board or in a list goes to the Account tab
  // rather than to a read-only copy of it: the page that can change those
  // fields is the one you want when you tap yourself.
  const openProfile = (userId: string) => {
    if (userId === snapshot.me.id) {
      setViewing(null);
      setTab("account");
      return;
    }
    setViewing(userId);
  };

  const askRevive = (who: { profile: UserProfile; revive?: Revive | null }) => {
    if (who.revive) setReviving({ profile: who.profile, revive: who.revive });
  };

  const checkIn = async () => {
    setJustCheckedIn(true);
    setTimeout(() => setJustCheckedIn(false), 450);
    await session.run(() => store.checkIn());
  };

  const confirmSend = async (amount: number) => {
    const target = sending;
    if (!target) return;
    setSending(null);
    const ok = await session.run(() => store.sendTime(target.profile.id, amount));
    if (ok) {
      setViewing(null);
      setTab("people");
      setTrailingTo(target.profile.id);
      setTimeout(() => setTrailingTo(null), 900);
    }
  };

  return (
    <Shell
      tab={tab}
      onTab={(next) => {
        // A tab press is a move to somewhere else, so it takes the overlay with
        // it. Leaving a profile open over a tab the user just chose would hide
        // the thing they asked for behind the thing they were done with.
        setViewing(null);
        setTab(next);
      }}
      local={!isBackedByServer()}
      markAccount={snapshot.account.isAnonymous}
    >
      {/* Floated over the page rather than placed in it. In the flow it pushed
          the whole screen down on arrival and pulled it back up on expiry -
          moving buttons out from under a finger mid-tap - sat behind the
          scrim of any open sheet, and scrolled away with the page. */}
      {session.notice ? (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
        >
          <button
            key={session.notice.id}
            type="button"
            role="status"
            onClick={session.dismissNotice}
            className="animate-drop pointer-events-auto w-full max-w-md rounded-2xl px-4 py-3 text-left text-callout"
            style={{
              color: session.notice.tone === "good" ? "var(--color-bank)" : "var(--color-lapse)",
              background: `color-mix(in srgb, ${
                session.notice.tone === "good" ? "var(--color-bank)" : "var(--color-lapse)"
              } 16%, #1a1a1c)`,
              boxShadow:
                "inset 0 1px 0 0 rgb(255 255 255 / 10%), 0 12px 32px -8px rgb(0 0 0 / 85%)",
            }}
          >
            {session.notice.text}
          </button>
        </div>
      ) : null}

      <UpdateOffer state={updater.state} onInstall={updater.install} />

      {tab === "clock" ? (
        <Home
          snapshot={snapshot}
          now={session.now}
          clock={session.clock}
          justCheckedIn={justCheckedIn}
          onCheckIn={() => void checkIn()}
          onStart={() => void session.run(() => store.startStreak())}
          onStop={() => setConfirmingStop(true)}
          onSend={() => setTab("people")}
          onRevive={() => setTab("people")}
          onOpenAccount={() => setTab("account")}
          {...(canUnlock ? { onUnlock: () => void buyWholeClock() } : {})}
        />
      ) : null}

      {tab === "people" ? (
        <People
          friends={snapshot.friends}
          giveable={giveable}
          spendable={spendable}
          anonymous={snapshot.account.isAnonymous}
          onOpenAccount={() => setTab("account")}
          now={session.now}
          trailingTo={trailingTo}
          onFollow={(handle) => void session.run(() => store.follow(handle))}
          onSend={setSending}
          onRevive={askRevive}
          onOpenProfile={openProfile}
        />
      ) : null}

      {tab === "boards" ? (
        <Boards
          store={store}
          meId={snapshot.me.id}
          anonymous={snapshot.account.isAnonymous}
          onOpenAccount={() => setTab("account")}
          onOpenProfile={openProfile}
        />
      ) : null}

      {tab === "account" ? (
        <Account
          snapshot={snapshot}
          store={store}
          now={session.now}
          onSetAvatar={(file) => void session.run(() => store.setAvatar(file))}
          onSignUp={(email, password, handle) =>
            void session.run(() => store.signUp(email, password, handle))
          }
          onSignIn={(email, password) => void session.run(() => store.signIn(email, password))}
          onSignOut={() => void session.run(() => store.signOut())}
          onSetHandle={(handle) => void session.run(() => store.setHandle(handle))}
          onSetDisplayName={(name) => void session.run(() => store.setDisplayName(name))}
          {...(canBuyHere() ? { onBuyWholeClock: () => void buyWholeClock() } : {})}
          updater={updater}
        />
      ) : null}

      {viewing !== null ? (
        <Profile
          userId={viewing}
          store={store}
          now={session.now}
          giveable={giveable}
          // Every action refreshes the session, which moves serverNow - so this
          // is exactly "something happened, read them again".
          revision={snapshot.serverNow}
          anonymous={snapshot.account.isAnonymous}
          onClose={() => setViewing(null)}
          onSend={setSending}
          onRevive={askRevive}
          onFollow={(handle) => void session.run(() => store.follow(handle))}
          onUnfollow={(userId) => void session.run(() => store.unfollow(userId))}
        />
      ) : null}

      {sending ? (
        <SendSheet
          friend={sending}
          giveable={giveable}
          clock={spendable}
          sendsWholeClock={snapshot.sendsWholeClock}
          now={session.now}
          sentToday={snapshot.sentInLastDay}
          {...(canUnlock ? { onUnlock: () => void buyWholeClock() } : {})}
          onCancel={() => setSending(null)}
          onConfirm={(amount) => void confirmSend(amount)}
        />
      ) : null}

      {reviving ? (
        <ConfirmSheet
          title={`Revive ${reviving.profile.displayName}?`}
          confirmLabel="Revive"
          cancelLabel="Not now"
          tone="run"
          body={
            <>
              Their streak ran {Math.floor(reviving.revive.lostLength / DAY)} days before it broke.
              Reviving restarts it at {Math.floor(reviving.revive.restores / DAY)} days, and the{" "}
              {formatDuration(reviving.revive.cost)} it costs comes straight off your own clock.
              That time is spent, not sent - it cannot be taken back.
            </>
          }
          onCancel={() => setReviving(null)}
          onConfirm={() => {
            const target = reviving;
            setReviving(null);
            void session.run(() => store.reviveFriend(target.profile.id));
          }}
        />
      ) : null}

      {confirmingStop ? (
        <ConfirmSheet
          title="Stop the clock?"
          confirmLabel="Stop and reset"
          cancelLabel="Keep running"
          body={
            <>
              Your run ends here and the counter goes back to zero.{" "}
              {stoppedAfter === null
                ? null
                : `It has been going for ${formatDuration(Math.max(0, session.now - stoppedAfter))}.`}{" "}
              Stopping on purpose cannot be undone - a revive only brings back a streak that lapsed.
              The time you send comes off this clock, so until you start a new one you will have
              none to give, and gifts from friends will have nowhere to land.
            </>
          }
          onCancel={() => setConfirmingStop(false)}
          onConfirm={() => {
            setConfirmingStop(false);
            void session.run(() => store.stopStreak());
          }}
        />
      ) : null}
    </Shell>
  );
}
