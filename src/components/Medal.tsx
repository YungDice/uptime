import type { Achievement, Glyph, Metal } from "@/core";

/**
 * An achievement, struck rather than printed.
 *
 * The previous version was a grey rectangle with a coloured caption in it, and
 * the honest problem with it was not that it was ugly - it was that it was the
 * same object as every list row on the screen, so nothing about it said "this
 * was difficult". A medal is a different *kind* of thing: round where the rest
 * of the app is rectangular, lit where the rest is flat, and drawn rather than
 * typeset.
 *
 * Two states, and they are physically different objects rather than one object
 * at two opacities:
 *
 *   earned - a disc struck in its metal, with a rim, a highlight and the glyph
 *            cut into it.
 *   locked - the empty setting the medal would sit in: a dark well, the glyph
 *            faint inside it, and the progress drawn as an arc around the rim.
 *            The arc is the whole reason this shape works for both states, and
 *            it is why the progress bar underneath could go.
 */
export function Medal({ achievement, delay = 0 }: { achievement: Achievement; delay?: number }) {
  const { earned, label, detail, progress, glyph, metal } = achievement;

  return (
    <li
      className="animate-deal flex flex-col items-center text-center"
      style={{ animationDelay: `${delay}ms` }}
    >
      <Disc earned={earned} metal={metal} glyph={glyph} progress={progress ?? 0} />
      <p
        className="mt-2.5 w-full text-[13px] leading-tight font-semibold text-balance"
        style={{ color: earned ? "var(--color-label)" : "var(--color-label-2)" }}
      >
        {label}
      </p>
      <p className="mt-0.5 w-full text-[11px] leading-tight text-balance text-label-3">{detail}</p>
    </li>
  );
}

const SIZE = 62;
const RIM = 2.5;
const R = (SIZE - RIM) / 2;
const CIRC = 2 * Math.PI * R;

function Disc({
  earned,
  metal,
  glyph,
  progress,
}: {
  earned: boolean;
  metal: Metal;
  glyph: Glyph;
  progress: number;
}) {
  const tint = `var(--color-${metal})`;

  if (!earned) {
    return (
      <span
        className="relative inline-flex items-center justify-center rounded-full"
        style={{
          width: SIZE,
          height: SIZE,
          // A well, not a disc: the light comes from *below* the top edge, so
          // the setting reads as carved into the page rather than sitting on it.
          background: "radial-gradient(circle at 50% 35%, #1a1a1c 0%, #101012 100%)",
          boxShadow: "inset 0 2px 5px 0 rgb(0 0 0 / 70%), inset 0 -1px 0 0 rgb(255 255 255 / 5%)",
        }}
      >
        {/* The progress arc, on the rim where a medal's edge would be. */}
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="absolute inset-0 -rotate-90"
          aria-hidden="true"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--color-hairline)"
            strokeWidth={RIM}
            opacity={0.6}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={tint}
            strokeWidth={RIM}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - Math.min(1, Math.max(0, progress)))}
            opacity={0.55}
            style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.16,1,0.3,1)" }}
          />
        </svg>
        <span className="relative text-label-3 opacity-70">
          <GlyphArt glyph={glyph} />
        </span>
      </span>
    );
  }

  return (
    <span
      className="relative inline-flex items-center justify-center overflow-hidden rounded-full"
      style={{
        width: SIZE,
        height: SIZE,
        background: `var(--grad-${metal})`,
        // Rim light, an inner shadow at the bottom of the bevel, and a coloured
        // glow on the page underneath. Three shadows is the whole medal.
        boxShadow:
          "inset 0 1.5px 0 0 rgb(255 255 255 / 55%), " +
          "inset 0 -3px 6px -2px rgb(0 0 0 / 45%), " +
          `0 6px 18px -8px color-mix(in srgb, ${tint} 75%, transparent)`,
      }}
    >
      {/* One pass of light, once, on mount. */}
      <span
        aria-hidden="true"
        className="animate-sheen pointer-events-none absolute inset-y-[-40%] left-0 w-1/3"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgb(255 255 255 / 45%), transparent)",
        }}
      />
      {/* The glyph is cut into the metal rather than laid on it: a dark stroke
          with a light one half a pixel below reads as an engraving. */}
      <span className="relative" style={{ color: "rgb(0 0 0 / 55%)" }}>
        <GlyphArt glyph={glyph} />
      </span>
    </span>
  );
}

/**
 * The struck faces.
 *
 * Authored rather than pulled from an icon set, and each one is a different
 * *drawing* rather than the same circle with a different letter in it - a wall
 * of near-identical badges is the thing that made the old grid read as filler.
 * All of them sit on a 24 grid at a 1.8 stroke so they weigh the same.
 */
function GlyphArt({ glyph }: { glyph: Glyph }) {
  const s = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (glyph) {
    // A laurel around a placing: the shape a ranking has had for 2,700 years.
    case "rank":
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8.4 4.6C5.6 6.4 4.4 9.4 5 12.9c.3 2 1.4 3.8 2.9 5" {...s} />
          <path d="M15.6 4.6c2.8 1.8 4 4.8 3.4 8.3-.3 2-1.4 3.8-2.9 5" {...s} />
          <path d="M12 8.2l1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5z" {...s} />
        </svg>
      );
    // Seven strokes. A tally, which is what a first week is.
    case "week":
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 7.5v9M9 7.5v9M12 7.5v9M15 7.5v9" {...s} />
          <path d="M4.6 15.4L19 8.6" {...s} />
        </svg>
      );
    // A moon, most of the way round. Thirty days is a lunation.
    case "month":
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15.8 4.6a7.6 7.6 0 1 0 3.6 9.7 6.2 6.2 0 0 1-3.6-9.7z" {...s} />
        </svg>
      );
    // The hundred, spelled out, because a century is a number people say.
    case "century":
      return (
        <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7.6 9.4v5.2" {...s} />
          <path d="M6.2 9.4h1.4" {...s} />
          <rect x="9.9" y="9.2" width="4" height="5.6" rx="2" {...s} />
          <rect x="15.6" y="9.2" width="4" height="5.6" rx="2" {...s} />
        </svg>
      );
    // A full turn of the sun.
    case "year":
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4.1" {...s} />
          <path d="M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2" {...s} />
          <path d="M6 6l1.6 1.6M16.4 16.4L18 18M18 6l-1.6 1.6M7.6 16.4L6 18" {...s} />
        </svg>
      );
    // A peak with a flag. A thousand days is the top of the ladder.
    case "summit":
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3.2 18.4l5.3-8.2 3 4.1 2.2-3 7.1 7.1z" {...s} />
          <path d="M13.7 11.5V4.2l4 1.7-4 1.8" {...s} />
        </svg>
      );
    // A ring buoy: the thing you throw to somebody whose clock has stopped.
    case "rescue":
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7.8" {...s} />
          <circle cx="12" cy="12" r="3.4" {...s} />
          <path d="M6.6 6.6l3 3M14.4 14.4l3 3M17.4 6.6l-3 3M9.6 14.4l-3 3" {...s} />
        </svg>
      );
    // Time leaving one hand for another.
    case "given":
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="8.6" cy="12" r="5" {...s} />
          <path d="M8.6 9.2V12l1.9 1.2" {...s} />
          <path d="M15 8.8l3.8 3.2-3.8 3.2" {...s} />
        </svg>
      );
  }
}
