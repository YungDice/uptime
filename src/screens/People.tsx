import { useState } from "react";
import type { Seconds } from "@/core";
import type { FriendView } from "@/data/store";
import { FriendList } from "@/components/FriendList";

interface Props {
  friends: FriendView[];
  balance: Seconds;
  now: Seconds;
  trailingTo: string | null;
  onFollow(handle: string): void;
  onSend(friend: FriendView): void;
  onRevive(friend: FriendView): void;
}

export function People({
  friends,
  balance,
  now,
  trailingTo,
  onFollow,
  onSend,
  onRevive,
}: Props) {
  const [handle, setHandle] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = handle.trim();
    if (trimmed.length === 0) return;
    onFollow(trimmed);
    setHandle("");
  };

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="Follow someone by handle"
          aria-label="Handle to follow"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-xl bg-surface px-4 py-3 text-sm text-ink-text placeholder:text-muted focus:ring-1 focus:ring-pulse/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={handle.trim().length === 0}
          className="rounded-xl bg-surface-2 px-4 py-3 text-sm font-semibold text-ink-text transition-colors hover:bg-surface-2/70 disabled:cursor-not-allowed disabled:text-muted"
        >
          Follow
        </button>
      </form>

      <FriendList
        friends={friends}
        balance={balance}
        now={now}
        onSend={onSend}
        onRevive={onRevive}
        trailingTo={trailingTo}
      />
    </div>
  );
}
