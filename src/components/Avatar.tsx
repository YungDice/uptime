import { useState } from "react";
import type { UserProfile } from "@/core";

/**
 * A face, or the next best thing.
 *
 * The fallback is a monogram on a flat grey disc, which is what Contacts and
 * Messages do - not a coloured circle per person. Colour in this app names a
 * system (orange is a live run, green is banked time, red is a lapse), so
 * tinting avatars by user id would spend the one signal the interface has on
 * decoration, and a green face beside a green balance would imply a
 * relationship that is not there.
 *
 * `ring` is the exception and is opt-in: the podium uses it to say which place
 * a face is standing in, which is a system.
 */
export function Avatar({
  profile,
  size = 40,
  ring,
}: {
  profile: Pick<UserProfile, "displayName" | "avatarUrl">;
  size?: number;
  /**
   * Explicitly `| undefined`: under `exactOptionalPropertyTypes` an optional
   * prop will not take an undefined that was written out, and every caller
   * here decides the ring from the row's state, so "no ring" arrives as a
   * value rather than as an omitted attribute.
   */
  ring?: "run" | "bank" | "lapse" | "hairline" | "gold" | "silver" | "bronze" | undefined;
}) {
  // A broken URL is not a missing one - a deleted storage object would
  // otherwise leave a permanently empty hole where a face should be.
  const [failed, setFailed] = useState(false);
  // Tested for being a non-empty string rather than for not being null: a
  // world persisted before this field existed has no property here at all, and
  // `undefined !== null` would send an undefined straight into `.length`.
  const url = profile.avatarUrl;
  const showImage = typeof url === "string" && url.length > 0 && !failed;

  const ringColor =
    ring === undefined
      ? undefined
      : ring === "hairline"
        ? "var(--color-hairline)"
        : `var(--color-${ring})`;

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        // A lit disc rather than a flat one, so an avatar that is only ever a
        // monogram still reads as an object beside the medals and pedestals.
        background: "linear-gradient(180deg, #34343a 0%, #232327 100%)",
        boxShadow:
          ringColor === undefined
            ? "var(--bezel)"
            : `0 0 0 2px var(--color-void), 0 0 0 ${size >= 64 ? 4 : 3}px ${ringColor}`,
      }}
    >
      {showImage ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          // The bucket is public and the URL carries no secret, so there is
          // nothing for a referrer to authorise and nothing gained by leaking
          // which screen of which app requested a face.
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="font-medium text-label-2 select-none"
          // Scaled off the disc rather than fixed, so one component serves the
          // 28px row and the 88px profile without a size prop per call site.
          style={{ fontSize: Math.round(size * 0.38), letterSpacing: "0.01em" }}
        >
          {monogram(profile.displayName)}
        </span>
      )}
    </span>
  );
}

/**
 * One or two letters, from the first and last word of a name.
 *
 * Uses the code-point array rather than `slice`, so a name beginning with an
 * emoji or an astral character yields that whole character instead of half a
 * surrogate pair.
 */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";

  const first = [...(words[0] ?? "")][0] ?? "";
  const last = words.length > 1 ? ([...(words[words.length - 1] ?? "")][0] ?? "") : "";
  return (first + last).toUpperCase();
}
