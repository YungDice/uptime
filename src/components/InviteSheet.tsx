import { useEffect, useState } from "react";
import type { UserProfile } from "@/core/types";
import type { UptimeStore } from "@/data/store";
import { Avatar } from "./Avatar";
import { Capsule } from "./List";
import { Sheet } from "./Sheet";

/**
 * Somebody's invite link, opened here.
 *
 * Asks before following anyone. The link's owner agreed to the follow by
 * sending it; this is where the person who opened it agrees too, having seen
 * whose it is - the name comes from the code, not from anything in the link a
 * sender could have edited.
 */
export function InviteSheet({
  code,
  store,
  meId,
  onAccept,
  onClose,
}: {
  code: string;
  store: UptimeStore;
  /** Your own id: your own link, opened here, is not an invite to anything. */
  meId: string;
  onAccept(): void;
  onClose(): void;
}) {
  const [owner, setOwner] = useState<UserProfile | null | "loading" | { failed: string }>(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    setOwner("loading");
    store
      .previewInvite(code)
      .then((found) => {
        if (!cancelled) setOwner(found);
      })
      .catch((err: unknown) => {
        // The adapter's own words: "Couldn't reach Uptime" offline, and the
        // name of what is missing when a server is a migration behind.
        if (!cancelled) {
          setOwner({ failed: err instanceof Error ? err.message : "Couldn't read that invite." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, store]);

  if (owner === "loading") {
    return (
      <Sheet label="Invite" onClose={onClose}>
        <p className="py-10 text-center text-callout text-label-3">Reading the invite</p>
      </Sheet>
    );
  }

  if (owner === null || "failed" in owner) {
    return (
      <Sheet label="Invite" onClose={onClose}>
        <h2 className="text-title text-label">
          {owner === null ? "That invite link doesn't work" : "Couldn't read that invite"}
        </h2>
        <p className="mt-2 text-callout text-label-2">
          {owner === null
            ? "It may have been mistyped. Ask your friend to send it again."
            : owner.failed}
        </p>
        <div className="mt-7 flex">
          <Capsule wide onClick={onClose}>
            Close
          </Capsule>
        </div>
      </Sheet>
    );
  }

  // Tried out, most likely, by the person who just copied it.
  if (owner.id === meId) {
    return (
      <Sheet label="Your invite link" onClose={onClose}>
        <h2 className="text-title text-label">That's your own invite link</h2>
        <p className="mt-2 text-callout text-label-2">
          Send it to a friend. When they open it and say yes, you'll follow each other.
        </p>
        <div className="mt-7 flex">
          <Capsule wide onClick={onClose}>
            Close
          </Capsule>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet label={`Invite from ${owner.displayName}`} onClose={onClose}>
      <div className="flex flex-col items-center pt-1 text-center">
        <Avatar profile={owner} size={72} ring="run" />
        <h2 className="mt-3 text-title text-label">{owner.displayName} invited you</h2>
        <p className="text-callout text-label-2">@{owner.handle}</p>
        <p className="mt-4 text-callout text-label-2">
          Follow each other, and time can move between your clocks - to send some their way, or to
          bring a broken streak back.
        </p>
      </div>
      <div className="mt-7 flex gap-3">
        <Capsule wide onClick={onClose}>
          Not now
        </Capsule>
        {/* "Accept", not "Follow each other": the sentence above already
            says what it does, and the longer label wrapped at phone width. */}
        <Capsule wide tone="run" solid onClick={onAccept}>
          Accept
        </Capsule>
      </div>
    </Sheet>
  );
}
