import { useEffect, useMemo, useState } from "react";
import { createStore, isBackedByServer, type FriendView } from "@/data";
import { useSession } from "@/hooks/useSession";
import { Home } from "@/screens/Home";
import { Boards } from "@/screens/Boards";
import { People } from "@/screens/People";
import { SendSheet } from "@/components/SendSheet";

type Tab = "home" | "friends" | "boards";

const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "Uptime" },
  { id: "friends", label: "People" },
  { id: "boards", label: "Boards" },
];

export function App() {
  const store = useMemo(() => createStore(), []);
  const session = useSession(store, "you");
  const [tab, setTab] = useState<Tab>("home");
  const [sending, setSending] = useState<FriendView | null>(null);
  const [trailingTo, setTrailingTo] = useState<string | null>(null);

  // The notice is a one-line confirmation, not a dialog; it clears itself.
  useEffect(() => {
    if (!session.notice) return;
    const timer = setTimeout(session.dismissNotice, 4000);
    return () => clearTimeout(timer);
  }, [session.notice, session.dismissNotice]);

  const { snapshot } = session;

  if (session.error && !snapshot) {
    return (
      <Shell>
        <p className="mt-20 text-center text-sm text-danger">{session.error}</p>
      </Shell>
    );
  }

  if (!snapshot) {
    return (
      <Shell>
        <p className="mt-20 text-center text-sm text-muted">Reading your clock…</p>
      </Shell>
    );
  }

  const goRevive = () => {
    setTab("friends");
  };

  const confirmSend = async (amount: number) => {
    const friend = sending;
    if (!friend) return;
    setSending(null);
    const ok = await session.run(() => store.sendTime(friend.profile.id, amount));
    if (ok) {
      setTrailingTo(friend.profile.id);
      setTimeout(() => setTrailingTo(null), 950);
    }
  };

  return (
    <Shell>
      <header className="flex items-center justify-between pt-2 pb-4">
        <nav className="flex gap-1" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                t.id === tab ? "bg-surface text-ink-text" : "text-muted hover:text-ink-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {!isBackedByServer() ? (
          <span
            className="rounded-full bg-surface px-2.5 py-1 text-[0.6rem] font-semibold tracking-wider text-muted uppercase"
            title="No Supabase project configured - running on local storage"
          >
            local
          </span>
        ) : null}
      </header>

      {session.notice ? (
        <div
          key={session.notice.id}
          role="status"
          className={`animate-fade-up mb-4 rounded-xl px-4 py-3 text-sm ${
            session.notice.tone === "good"
              ? "bg-pulse/12 text-pulse"
              : "bg-danger/12 text-danger"
          }`}
        >
          {session.notice.text}
        </div>
      ) : null}

      {tab === "home" ? (
        <Home
          snapshot={snapshot}
          now={session.now}
          onCheckIn={() => void session.run(() => store.checkIn())}
          onStart={() => void session.run(() => store.startStreak())}
          onStop={() => void session.run(() => store.stopStreak())}
          onSend={() => setTab("friends")}
          onRevive={goRevive}
        />
      ) : null}

      {tab === "friends" ? (
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-ink">
      <main className="mx-auto w-full max-w-md px-4 pb-16">{children}</main>
    </div>
  );
}
