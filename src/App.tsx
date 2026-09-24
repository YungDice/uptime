import { useEffect, useMemo, useState } from "react";
import { createStore, isBackedByServer, liveGiveable, type SendTarget } from "@/data";
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
import { formatDuration } from "@/core";
import type { Tab } from "@/components/TabBar";

export function App() {
  const store = useMemo(() => createStore(), []);
  const session = useSession(store, "you");
  const updater = useUpdater();
  const [tab, setTab] = useState<Tab>("clock");
  const [sending, setSending] = useState<SendTarget | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [trailingTo, setTrailingTo] = useState<string | null>(null);
  const [justCheckedIn, setJustCheckedIn] = useState(false);

  // What Android's back button unwinds, innermost first: any sheet, then the
  // profile behind it, then the tab, then the app itself. Without this, back
  // quits from wherever the user happens to be standing, which on a four-tab
  // app with two overlay layers is always wrong.
  const sheetOpen = sending !== null || confirmingStop;
  useBackStack(
    (tab === "clock" ? 0 : 1) + (viewing !== null ? 1 : 0) + (sheetOpen ? 1 : 0),
    () => {
      if (sending) setSending(null);
      else if (confirmingStop) setConfirmingStop(false);
      else if (viewing !== null) setViewing(null);
      else setTab("clock");
    },
  );

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

  if (!snapshot) {
    return (
      <Shell tab={tab} onTab={setTab}>
        <p className="px-5 pt-16 text-center text-callout text-label-2">Reading your clock</p>
      </Shell>
    );
  }

  // One derivation, one place. Every surface that offers to spend time - the
  // home panel, the friend rows, the send sheet, the profile - has to agree
  // about how much there is. It is your running clock, so it is moving, and
  // they cannot each ask the snapshot separately and get the same answer.
  const giveable = liveGiveable(snapshot, session.now);
  const stoppedAfter = snapshot.me.streak.streakStart;

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
      {session.notice ? (
        <div
          key={session.notice.id}
          role="status"
          className="animate-rise surface-tint mx-5 mt-3 rounded-xl px-4 py-3 text-callout"
          style={{
            color:
              session.notice.tone === "good" ? "var(--color-bank)" : "var(--color-lapse)",
            ["--tint" as string]:
              session.notice.tone === "good" ? "var(--color-bank)" : "var(--color-lapse)",
          }}
        >
          {session.notice.text}
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
        />
      ) : null}

      {tab === "people" ? (
        <People
          friends={snapshot.friends}
          giveable={giveable}
          anonymous={snapshot.account.isAnonymous}
          onOpenAccount={() => setTab("account")}
          now={session.now}
          trailingTo={trailingTo}
          onFollow={(handle) => void session.run(() => store.follow(handle))}
          onSend={setSending}
          onRevive={(friend) => void session.run(() => store.reviveFriend(friend.profile.id))}
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
          onRevive={(them) => void session.run(() => store.reviveFriend(them.profile.id))}
          onFollow={(handle) => void session.run(() => store.follow(handle))}
          onUnfollow={(userId) => void session.run(() => store.unfollow(userId))}
        />
      ) : null}

      {sending ? (
        <SendSheet
          friend={sending}
          giveable={giveable}
          now={session.now}
          sentToday={snapshot.sentInLastDay}
          onCancel={() => setSending(null)}
          onConfirm={(amount) => void confirmSend(amount)}
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
