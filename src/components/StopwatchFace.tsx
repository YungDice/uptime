import { isRunning, splitStopwatch, type StreakStatus } from "@/core";

interface Props {
  /** Derived against the fractional clock by the caller, not stored. */
  status: StreakStatus;
  /** Fractional elapsed seconds; the hundredths come from here. */
  elapsed: number;
  /** 0-1 of the check-in window still open, measured from the last visit. */
  windowFraction: number;
  windowLabel: string;
}

const SIZE = 280;
const STROKE = 6;
const R = (SIZE - STROKE) / 2 - 16;
const CIRC = 2 * Math.PI * R;
const TICKS = 60;

/**
 * The Timer's ring around the Stopwatch's face.
 *
 * Both halves are load-bearing. The ring is the check-in window draining, which
 * is the only way this streak can die; the face is the run itself, with the
 * hundredths that make it a stopwatch rather than a counter. Nothing is in a
 * card, because the Clock app has never put anything in a card.
 */
export function StopwatchFace({ status, elapsed, windowFraction, windowLabel }: Props) {
  const live = isRunning(status);
  const shown = live ? elapsed : status.kind === "lapsed" ? status.length : 0;
  const { days, clock, hundredths } = splitStopwatch(shown);

  // The ring carries the system colour; the figure stays white, as the Timer
  // sets it. Tinting both put two accents at the same scale and flattened the
  // hierarchy between "what this is" and "how long is left".
  const accent = live
    ? "var(--color-run)"
    : status.kind === "lapsed"
      ? "var(--color-lapse)"
      : "var(--color-label-3)";
  const figure = live
    ? "var(--color-label)"
    : status.kind === "lapsed"
      ? "var(--color-lapse)"
      : "var(--color-label-3)";

  const swept = Math.max(0, Math.min(1, windowFraction));

  return (
    <section
      className="flex flex-col items-center pt-6 pb-2"
      aria-label={
        live
          ? `${days} day streak, ${clock} on the current day. ${windowLabel}.`
          : "No streak running."
      }
    >
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="absolute inset-0 -rotate-90"
          aria-hidden="true"
        >
          {/* The tick track, as the Timer draws it. */}
          <g>
            {Array.from({ length: TICKS }, (_, i) => {
              const angle = (i / TICKS) * 2 * Math.PI;
              const outer = R + 13;
              const inner = R + 9;
              const cx = SIZE / 2;
              return (
                <line
                  key={i}
                  x1={cx + Math.cos(angle) * inner}
                  y1={cx + Math.sin(angle) * inner}
                  x2={cx + Math.cos(angle) * outer}
                  y2={cx + Math.sin(angle) * outer}
                  stroke={i / TICKS <= swept ? accent : "var(--color-hairline)"}
                  strokeWidth={i % 5 === 0 ? 2 : 1}
                  strokeLinecap="round"
                  opacity={i / TICKS <= swept ? 0.9 : 0.5}
                />
              );
            })}
          </g>

          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--color-raise-2)"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={accent}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - swept)}
            style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.16,1,0.3,1)" }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {live || status.kind === "lapsed" ? (
            <>
              <div className="flex items-baseline gap-2">
                <span
                  className="tnum leading-none font-light"
                  style={{ fontSize: 76, letterSpacing: "-0.045em", color: figure }}
                >
                  {days}
                </span>
                <span className="pb-2 text-sm font-medium text-label-2">
                  {days === 1 ? "day" : "days"}
                </span>
              </div>
              {/* The stopwatch readout. aria-hidden because it changes a
                  hundred times a second; the section label carries it. */}
              <div className="tnum mt-3 flex items-baseline font-light" aria-hidden="true">
                <span className="text-2xl text-label">{clock}</span>
                <span className="text-2xl text-label-2">.{hundredths}</span>
              </div>
            </>
          ) : (
            <>
              <span
                className="tnum leading-none font-light text-label-3"
                style={{ fontSize: 68, letterSpacing: "-0.045em" }}
              >
                0
              </span>
              <span className="mt-3 text-sm text-label-2">Not running</span>
            </>
          )}
        </div>
      </div>

      <p className="mt-5 text-[13px] text-label-2">{windowLabel}</p>
    </section>
  );
}
