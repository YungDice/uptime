import { useEffect, useState } from "react";
import type { UptimeStore } from "@/data/store";
import { renderCard, type CardFacts } from "@/invites/card";
import { inviteLink } from "@/invites/link";
import { Capsule } from "./List";
import { Sheet } from "./Sheet";

type Copied = "idle" | "done" | "failed";

/**
 * Your streak as a picture, and your invite link beside it.
 *
 * Two things rather than one, because a picture cannot carry a link anyone
 * can tap: the card goes where pictures go, and the link goes in the message
 * under it. The link is the half that does something - opening it makes the
 * follow mutual in one step, which is what lets time move at all.
 */
export function ShareSheet({
  facts,
  store,
  onClose,
}: {
  facts: CardFacts;
  store: UptimeStore;
  onClose(): void;
}) {
  const [card, setCard] = useState<{ blob: Blob; url: string } | "failed" | null>(null);
  const [link, setLink] = useState<string | { failed: string } | null>(null);
  const [copiedCard, setCopiedCard] = useState<Copied>("idle");
  const [copiedLink, setCopiedLink] = useState<Copied>("idle");

  const { days, caption, displayName, handle } = facts;
  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    renderCard({ days, caption, displayName, handle })
      .then((blob) => {
        if (cancelled) return;
        made = URL.createObjectURL(blob);
        setCard({ blob, url: made });
      })
      .catch(() => {
        if (!cancelled) setCard("failed");
      });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [days, caption, displayName, handle]);

  useEffect(() => {
    let cancelled = false;
    store
      .inviteCode()
      .then((code) => {
        if (!cancelled) setLink(inviteLink(code, handle));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLink({ failed: err instanceof Error ? err.message : "Try again in a moment." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [store, handle]);
  const linkReady = typeof link === "string";

  const flash = (set: (value: Copied) => void, value: Copied) => {
    set(value);
    setTimeout(() => set("idle"), 1600);
  };

  const copyCard = async () => {
    if (card === null || card === "failed") return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": card.blob })]);
      flash(setCopiedCard, "done");
    } catch {
      flash(setCopiedCard, "failed");
    }
  };

  const copyLink = async () => {
    if (!linkReady) return;
    try {
      await navigator.clipboard.writeText(link);
      flash(setCopiedLink, "done");
    } catch {
      flash(setCopiedLink, "failed");
    }
  };

  // The system's own share sheet, where this webview has one that takes
  // files. Offered as well as the copy buttons, never instead of them.
  const file =
    card !== null && card !== "failed" ? new File([card.blob], "uptime.png", { type: "image/png" }) : null;
  const canShare =
    file !== null && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({
        files: [file],
        ...(linkReady ? { text: link } : {}),
      });
    } catch {
      // Dismissed, or refused by the platform. The copy buttons still work.
    }
  };

  return (
    <Sheet label="Share your streak" onClose={onClose}>
      <h2 className="text-title text-label">Share your streak</h2>

      <div className="mt-4 flex justify-center">
        {card === null ? (
          <div className="flex aspect-[4/5] w-44 items-center justify-center rounded-xl bg-raise text-footnote text-label-3">
            Drawing
          </div>
        ) : card === "failed" ? (
          <div className="flex aspect-[4/5] w-44 items-center justify-center rounded-xl bg-raise px-4 text-center text-footnote text-label-2">
            The card couldn't be drawn here.
          </div>
        ) : (
          <img
            src={card.url}
            alt={`${days} ${caption}, ${displayName}`}
            className="aspect-[4/5] w-44 rounded-xl"
            style={{ boxShadow: "0 0 0 1px rgb(255 255 255 / 10%)" }}
          />
        )}
      </div>

      <p className="mt-4 text-footnote text-label-2">
        {link !== null && typeof link === "object"
          ? `Your invite link couldn't be made: ${link.failed} The picture still works.`
          : "Send the picture, and the link with it: opening the link makes you follow each other in one step."}
      </p>
      {linkReady ? (
        <p className="mt-1.5 truncate text-footnote text-label select-all">{link}</p>
      ) : null}

      <div className="mt-5 flex gap-3">
        <Capsule wide onClick={() => void copyCard()} disabled={card === null || card === "failed"}>
          {copiedCard === "done" ? "Copied" : copiedCard === "failed" ? "Couldn't copy" : "Copy picture"}
        </Capsule>
        <Capsule
          wide
          tone="run"
          onClick={() => void copyLink()}
          disabled={!linkReady}
        >
          {copiedLink === "done" ? "Copied" : copiedLink === "failed" ? "Couldn't copy" : "Copy link"}
        </Capsule>
      </div>
      {canShare ? (
        <div className="mt-3 flex">
          <Capsule wide tone="run" solid onClick={() => void share()}>
            Share
          </Capsule>
        </div>
      ) : null}
    </Sheet>
  );
}
