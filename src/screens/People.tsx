import { useState } from "react";
import type { Seconds } from "@/core";
import type { FriendView } from "@/data/store";
import { FriendList } from "@/components/FriendList";
import { Avatar } from "@/components/Avatar";
import { Section } from "@/components/List";

interface Props {
  friends: FriendView[];
  /** What the viewer can give, live. */
  giveable: Seconds;
  anonymous: boolean;
  onOpenAccount(): void;
  now: Seconds;
  trailingTo: string | null;
  onFollow(handle: string): void;
  onSend(friend: FriendView): void;
  onRevive(friend: FriendView): void;
  onOpenProfile(userId: string): void;
}

export function People({
  friends,
  giveable,
  anonymous,
  onOpenAccount,
  now,
  trailingTo,
  onFollow,
  onSend,
  onRevive,
  onOpenProfile,
}: Props) {
  const [nickname, setNickname] = useState("");

  // Someone who follows you and is not followed back is the only one of the
  // three follow states with anything to do about it, so it is the only one
  // that gets its own section. The other two - mutual, and waiting on them -
  // both belong in the list below, which already tells them apart.
  const requests = friends.filter((f) => f.followsMe && !f.iFollow);
  const others = friends.filter((f) => !(f.followsMe && !f.iFollow));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = nickname.trim();
    if (trimmed.length === 0) return;
    onFollow(trimmed);
    setNickname("");
  };

  return (
    <div className="pb-4">
      <form onSubmit={submit} className="flex gap-2 px-5 pt-3">
        <div className="surface relative flex min-w-0 flex-1 items-center rounded-xl">
          <span aria-hidden="true" className="pl-3.5 text-body text-label-3">
            @
          </span>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Follow by nickname"
            aria-label="Nickname to follow"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-2.5 pr-3.5 pl-1 text-body text-label placeholder:text-label-3 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={nickname.trim().length === 0}
          className="surface-tint rounded-xl px-4 py-2.5 text-body font-semibold transition-transform active:scale-95 disabled:opacity-35"
          style={{ color: "var(--color-run)", ["--tint" as string]: "var(--color-run)" }}
        >
          Follow
        </button>
      </form>

      {anonymous ? (
        <button
          type="button"
          onClick={onOpenAccount}
          className="mt-4 block w-full px-5 text-left text-footnote text-label-2"
        >
          You can follow people without an account, but sending time needs one.{" "}
          <span className="text-run">Create one</span> - your streak carries over.
        </button>
      ) : null}

      {requests.length > 0 ? (
        <Section title={requests.length === 1 ? "1 request" : `${requests.length} requests`}>
          {requests.map((friend) => (
            <div
              key={friend.profile.id}
              className="hairline flex items-center gap-3 py-3 pr-5 pl-5"
            >
              <button
                type="button"
                onClick={() => onOpenProfile(friend.profile.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left transition-opacity active:opacity-60"
              >
                <Avatar profile={friend.profile} size={42} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-label">
                    {friend.profile.displayName}
                  </span>
                  <span className="block truncate text-footnote text-label-2">
                    @{friend.profile.handle} follows you
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onFollow(friend.profile.handle)}
                className="surface-tint shrink-0 rounded-full px-3.5 py-1.5 text-footnote font-semibold transition-transform active:scale-95"
                style={{ color: "var(--color-run)", ["--tint" as string]: "var(--color-run)" }}
              >
                Follow back
              </button>
            </div>
          ))}
          <p className="px-5 pt-2.5 text-footnote text-label-2">
            Following back makes it mutual, which is what lets time move between you.
          </p>
        </Section>
      ) : null}

      <FriendList
        friends={others}
        giveable={anonymous ? 0 : giveable}
        now={now}
        onSend={onSend}
        onRevive={onRevive}
        onOpen={(friend) => onOpenProfile(friend.profile.id)}
        trailingTo={trailingTo}
      />
    </div>
  );
}
