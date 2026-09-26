import { useState } from "react";
import type { Seconds } from "@/core";
import type { FriendView } from "@/data/store";
import { FriendList } from "@/components/FriendList";
import { Avatar } from "@/components/Avatar";
import { Section } from "@/components/List";
import { inviteCodeIn } from "@/invites/link";

interface Props {
  friends: FriendView[];
  /** Your own nickname, which is what anyone following you has to type. */
  handle: string;
  /** What the viewer can give, live. */
  giveable: Seconds;
  /** Everything on the viewer's clock, live - what a revive is paid from. */
  spendable: Seconds;
  anonymous: boolean;
  onOpenAccount(): void;
  now: Seconds;
  trailingTo: string | null;
  /** Resolves true when the follow went through. */
  onFollow(handle: string): Promise<boolean>;
  /** Open somebody's invite, from a link pasted into the follow field. */
  onOpenInvite(code: string): void;
  /** Open your own invite link and card, to send to someone. */
  onInvite(): void;
  onSend(friend: FriendView): void;
  onRevive(friend: FriendView): void;
  onOpenProfile(userId: string): void;
}

export function People({
  friends,
  handle,
  giveable,
  spendable,
  anonymous,
  onOpenAccount,
  now,
  trailingTo,
  onFollow,
  onOpenInvite,
  onInvite,
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    // The field already draws the "@", so one typed or pasted in front of the
    // name is the same name, not part of it.
    const trimmed = nickname.trim().replace(/^@/, "");
    if (trimmed.length === 0) return;
    // An invite link pasted here is the way in wherever links do not open
    // the app by themselves - the browser build, or a chat app that keeps
    // links to itself. It goes to the same question the link would have.
    const invite = inviteCodeIn(nickname);
    if (invite) {
      setNickname("");
      onOpenInvite(invite);
      return;
    }
    // Cleared only once it worked. The usual refusal is "No account with that
    // nickname" - a typo - and emptying the field made the fix a whole name
    // retyped from memory rather than one character.
    if (await onFollow(trimmed)) setNickname("");
  };

  return (
    <div className="pb-4">
      <form onSubmit={(event) => void submit(event)} className="flex gap-2 px-5 pt-3">
        <div className="surface relative flex min-w-0 flex-1 items-center rounded-xl">
          <span aria-hidden="true" className="pl-3.5 text-body text-label-3">
            @
          </span>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Nickname or invite link"
            aria-label="Nickname or invite link to follow"
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

      <YourNickname handle={handle} />

      {/* The faster way in. A nickname has to be typed exactly and then
          followed back; a link does both halves in one tap. */}
      <div className="flex items-center gap-3 px-5 pt-2">
        <p className="min-w-0 flex-1 text-footnote text-label-2">
          Or send an invite link - opening it makes you follow each other.
        </p>
        <button
          type="button"
          onClick={onInvite}
          className="surface-tint shrink-0 rounded-full px-3.5 py-1.5 text-footnote font-semibold transition-transform active:scale-95"
          style={{ color: "var(--color-run)", ["--tint" as string]: "var(--color-run)" }}
        >
          Invite
        </button>
      </div>

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
                onClick={() => void onFollow(friend.profile.handle)}
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
        spendable={anonymous ? 0 : spendable}
        now={now}
        onSend={onSend}
        onRevive={onRevive}
        onOpen={(friend) => onOpenProfile(friend.profile.id)}
        trailingTo={trailingTo}
      />
    </div>
  );
}

/**
 * Your own nickname, where the follow field is.
 *
 * A follow only becomes a connection when it goes both ways, so every
 * connection needs the other person to type your nickname exactly - and until
 * this, the only place it appeared was the Account tab. Copied bare, without
 * the "@", because that is what the follow field takes.
 */
function YourNickname({ handle }: { handle: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(handle);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 1600);
  };

  return (
    <div className="flex items-center gap-3 px-5 pt-3">
      <p className="min-w-0 flex-1 truncate text-footnote text-label-2">
        {/* select-all, so a webview that refuses the clipboard still leaves a
            one-tap way to copy it by hand. */}
        Friends follow you as <span className="text-label select-all">@{handle}</span>
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        className="surface-tint shrink-0 rounded-full px-3.5 py-1.5 text-footnote font-semibold transition-transform active:scale-95"
        style={{ color: "var(--color-run)", ["--tint" as string]: "var(--color-run)" }}
      >
        {copied === "done" ? "Copied" : copied === "failed" ? "Couldn't copy" : "Copy"}
      </button>
    </div>
  );
}
