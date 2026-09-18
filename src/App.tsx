import { useEffect, useMemo, useState } from "react";
import { createStore, isBackedByServer, type FriendView } from "@/data";
import { useSession } from "@/hooks/useSession";
import { Home } from "@/screens/Home";
import { Boards } from "@/screens/Boards";
import { People } from "@/screens/People";
import { SendSheet } from "@/components/SendSheet";
import { TabBar, type Tab } from "@/components/TabBar";

const TITLES: Record<Tab, string> = {
  clock: "Uptime",
  people: "People",
  boards: "Boards",
};

export function App() {
  const store = useMemo(() => createStore(), []);
  const session = useSession(store, "you");
  const [tab, setTab] = useState<Tab>("clock");
  const [sending, setSending] = useState<FriendView | null>(null);
  const [trailingTo, setTrailingTo] = useState<string | null>(null);
  const [justCheckedIn, setJustCheckedIn] = useState(false);

  // The notice is a one-line confirmation, not a dialog; it clears itself.
  useEffect(() => {
    if (!session.notice) return;
    const timer = setTimeout(session.dismissNotice, 4000);
    return () => clearTimeout(timer);
  }, [session.notice, session.dismissNotice]);

  const { snapshot } = session;

  if (session.error && !snapshot) {
    return (
      <Shell title="Uptime" tab={tab} onTab={setTab}>
        <p className="px-5 pt-16 text-center text-[15px] text-lapse">{session.error}</p>
      </Shell>
    );
  }

  if (!snapshot) {
    return (
      <Shell title="Uptime" tab={tab} onTab={setTab}>
        <p className="px-5 pt-16 text-center text-[15px] text-label-2">Reading your clock</p>
      </Shell>
    );
  }

  const checkIn = async () => {
    setJustCheckedIn(true);
    setTimeout(() => setJustCheckedIn(false), 450);
    await session.run(() => store.checkIn());
  };

  const confirmSend = async (amount: number) => {
    const friend = sending;
    if (!friend) return;
    setSending(null);
    const ok = await session.run(() => store.sendTime(friend.profile.id, amount));
    if (ok) {
      setTab("people");
      setTrailingTo(friend.profile.id);
      setTimeout(() => setTrailingTo(null), 900);
    }
  };

  return (
    <Shell title={TITLES[tab]} tab={tab} onTab={setTab} local={!isBackedByServer()}>
      {session.notice ? (
        <div
          key={session.notice.id}
          role="status"
          className="animate-rise mx-5 mt-3 rounded-xl px-4 py-3 text-[15px]"
          style={{
            color:
              session.notice.tone === "good" ? "var(--color-bank)" : "var(--color-lapse)",
            background:
              session.notice.tone === "good"
                ? "color-mix(in srgb, var(--color-bank) 15%, transparent)"
                : "color-mix(in srgb, var(--color-lapse) 15%, transparent)",
          }}
        >
          {session.notice.text}
        </div>
      ) : null}

      {tab === "clock" ? (
        <Home
          snapshot={snapshot}
          now={session.now}
          fractionalNow={session.fractionalNow}
          justCheckedIn={justCheckedIn}
          onCheckIn={() => void checkIn()}
          onStart={() => void session.run(() => store.startStreak())}
          onStop={() => void session.run(() => store.stopStreak())}
          onSend={() => setTab("people")}
          onRevive={() => setTab("people")}
        />
      ) : null}

      {tab === "people" ? (
        <People
          friends={snapshot.friends}
          balance={snapshot.balance}
          now={session.now}
          trailingTo={trailingTo}
          onFollow={(handle) => void session.run(() => store.follow(handle))}
          onSend={setSending}
          onRevive={(friend) => void session.run(() => store.reviveFriend(friend.profile.id))}
        />
      ) : null}

      {tab === "boards" ? <Boards store={store} meId={snapshot.me.id} /> : null}

      {sending ? (
        <SendSheet
          friend={sending}
          balance={snapshot.balance}
          sentToday={snapshot.sentInLastDay}
          onCancel={() => setSending(null)}
          onConfirm={(amount) => void confirmSend(amount)}
        />
      ) : null}
    </Shell>
  );
}

function Shell({
  children,
  title,
  tab,
  onTab,
  local,
}: {
  children: React.ReactNode;
  title: string;
  tab: Tab;
  onTab(next: Tab): void;
  local?: boolean;
}) {
  return (
    <div className="min-h-full bg-void">
      {/* The Clock app's large title, pinned to the left above the content. */}
      <header
        className="mx-auto flex max-w-md items-center justify-between px-5 pt-3 pb-1"
        style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
      >
        <h1 className="text-[34px] font-bold tracking-[-0.02em] text-label">{title}</h1>
        {local ? (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-label-2"
            style={{ background: "var(--color-raise)" }}
            title="No Supabase schema reachable - running on local storage"
          >
            Local
          </span>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-md pb-24">{children}</main>
      <TabBar tab={tab} onChange={onTab} />
    </div>
  );
}
