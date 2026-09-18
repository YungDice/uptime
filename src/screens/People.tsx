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
    <div className="pb-4">
      <form onSubmit={submit} className="flex gap-2 px-5 pt-3">
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="Follow by handle"
          aria-label="Handle to follow"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-xl bg-raise px-4 py-2.5 text-[17px] text-label placeholder:text-label-2 focus:outline-none"
        />
        <button
          type="submit"
          disabled={handle.trim().length === 0}
          className="rounded-xl px-4 py-2.5 text-[17px] font-medium disabled:opacity-35"
          style={{
            color: "var(--color-run)",
            background: "color-mix(in srgb, var(--color-run) 18%, transparent)",
          }}
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
