import { useEffect, useRef, useState, type CSSProperties } from "react";
import { formatDuration, formatElapsed, type Seconds } from "@/core";

/**
 * A duration that is still growing, rendered so you can see it grow.
 *
 * Two decisions, and both are about the same problem - a number nobody is
 * touching has to prove it is alive or it reads as stuck:
 *
 *   The format is the stopwatch's, `HH:MM:SS`, not the summary form `13m`.
 *   At a tenth of the time kept, the figure gains a second every ten seconds;
 *   in the summary form that is one visible change a minute at best and none
 *   at all once the figure passes a day, so the quantity that this whole panel
 *   exists to show moving would be the one part of the screen that never moved.
 *
 *   It flashes for one beat when it changes. Small, once, and the difference
 *   between a figure the eye learns to watch and one it dismisses as a static
 *   label.
 *
 * `compact` is for the places a stopwatch readout physically will not go - a
 * third-width stat card cut `22d 12:27:07` off mid-figure, and a truncated
 * number is worse than a rounded one. It keeps the beat and gives up the
 * seconds, which is the right trade in a summary tile and the wrong one in the
 * panel the whole feature is about.
 */
export function LiveTime({
  seconds,
  compact,
  className,
  style,
}: {
  seconds: Seconds;
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const text = compact === true ? formatDuration(seconds) : formatElapsed(seconds);
  const previous = useRef(text);
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (previous.current === text) return;
    previous.current = text;
    // A counter, not a boolean: re-keying the span is what restarts the
    // animation, and a boolean would only fire on the first change.
    setBeat((n) => n + 1);
  }, [text]);

  return (
    <span
      // The key is deliberately on the element that carries the animation, so
      // React replaces it and the browser plays the keyframes from the start.
      key={beat}
      className={`${beat > 0 ? "animate-tick" : ""} ${className ?? ""}`}
      style={style}
    >
      {text}
    </span>
  );
}
