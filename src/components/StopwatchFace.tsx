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

const SIZE = 292;
const STROKE = 7;
const R = (SIZE - STROKE) / 2 - 18;
const CIRC = 2 * Math.PI * R;
const TICKS = 60;

/**
 * The Timer's ring around the Stopwatch's face.
 *
 * Both halves are load-bearing. The ring is the check-in window draining, which
 * is the only way this streak can die; the face is the run itself, with the
 * hundredths that make it a stopwatch rather than a counter. Nothing is in a
 * card, because the Clock app has never put anything in a card.
 *
 * Three things here exist purely so the screen is alive rather than correct:
 * the bloom behind the ring, the sweep hand going round once a minute, and the
 * breathing. They are all switched off the moment nothing is running, which is
 * the point of them - an idle clock should look cold, and it did not read as
 * cold when it looked exactly like a live one minus a colour.
 */
export function StopwatchFace({ status, elapsed, windowFraction, windowLabel }: Props) {
  const live = isRunning(status);
  const shown = live ? elapsed : status.kind === "lapsed" ? status.length : 0;
  const { days, clock, hundredths } = splitStopwatch(shown);

  // The ring carries the system colour; the figure stays white, as the Timer
  // sets it. Tinting both put two accents at the same scale and flattened the
  // hierarchy between "what this is" and "how long is left".
  const system = live ? "run" : status.kind === "lapsed" ? "lapse" : null;
  const accent = system === null ? "var(--color-label-3)" : `var(--color-${system})`;
  const figure = live
    ? "var(--color-label)"
    : status.kind === "lapsed"
      ? "var(--color-lapse)"
      : "var(--color-label-3)";

  const swept = Math.max(0, Math.min(1, windowFraction));
  // Once round the face per minute, exactly as the real one does. This is the
  // only element on screen driven by the fractional clock other than the
  // hundredths, and it is what makes the object read as running from across a
  // room, where two digits changing cannot be seen at all.
  const sweep = ((shown % 60) / 60) * 360;

  return (
    <section
      className="no-select flex flex-col items-center pt-5 pb-1"
      aria-label={
        live
          ? `${days} day streak, ${clock} on the current day. ${windowLabel}.`
          : "No streak running."
      }
    >
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        {/* The bloom. Sits behind everything, tinted by whatever the ring is
            saying, and absent entirely on an idle clock. */}
        {system !== null ? (
          <span
            aria-hidden="true"
            className={`bloom pointer-events-none absolute inset-6 rounded-full ${
              live ? "animate-breathe" : ""
            }`}
            style={{ ["--tint" as string]: `var(--color-${system})` }}
          />
        ) : null}

        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="absolute inset-0 -rotate-90"
          aria-hidden="true"
        >
          <defs>
            {/* Angled across the ring rather than along it, so the lit side is
                a side rather than a start - a gradient that runs with the
                stroke reads as the bar filling in two colours. */}
            <linearGradient id="uptime-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity="1" />
              <stop offset="55%" stopColor={accent} stopOpacity="0.92" />
              <stop offset="100%" stopColor={accent} stopOpacity="0.55" />
            </linearGradient>
          </defs>

          {/* The tick track, as the Timer draws it. */}
          <g>
            {Array.from({ length: TICKS }, (_, i) => {
              const angle = (i / TICKS) * 2 * Math.PI;
              const major = i % 5 === 0;
              const outer = R + 14;
              const inner = R + (major ? 8 : 10);
              const cx = SIZE / 2;
              return (
                <line
                  key={i}
                  x1={cx + Math.cos(angle) * inner}
                  y1={cx + Math.sin(angle) * inner}
                  x2={cx + Math.cos(angle) * outer}
                  y2={cx + Math.sin(angle) * outer}
                  stroke={major && live ? accent : "var(--color-hairline)"}
                  strokeWidth={major ? 2 : 1}
                  strokeLinecap="round"
                  opacity={major ? (live ? 0.55 : 0.9) : 0.5}
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
            stroke="url(#uptime-ring)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - swept)}
            style={{
              transition: "stroke-dashoffset 600ms cubic-bezier(0.16,1,0.3,1)",
              filter: live
                ? "drop-shadow(0 0 6px color-mix(in srgb, var(--color-run) 55%, transparent))"
                : undefined,
            }}
          />
        </svg>

        {/* The sweep hand. A dot rather than a needle: a needle across a face
            this empty would be the loudest thing on the screen, and all this
            has to do is prove the clock is moving. */}
        {live ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ transform: `rotate(${sweep}deg)` }}
          >
            <span
              className="absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full"
              style={{
                top: SIZE / 2 - R - 3.5,
                background: "var(--color-run)",
                boxShadow: "0 0 10px 2px color-mix(in srgb, var(--color-run) 65%, transparent)",
              }}
            />
          </div>
        ) : null}

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {live || status.kind === "lapsed" ? (
            <>
              {/* The unit hangs outside the flow so the numeral, the clock
                  and the ring all share one axis. */}
              <div className="relative">
                <span
                  className="tnum block leading-none font-light"
                  style={{
                    fontSize: 78,
                    letterSpacing: "-0.05em",
                    color: figure,
                    textShadow: live ? "0 0 32px rgb(255 255 255 / 18%)" : undefined,
                  }}
                >
                  {days}
                </span>
                <span className="absolute bottom-2 left-full ml-2 text-sm font-medium whitespace-nowrap text-label-2">
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
                style={{ fontSize: 70, letterSpacing: "-0.05em" }}
              >
                0
              </span>
              <span className="mt-3 text-sm text-label-2">Not running</span>
            </>
          )}
        </div>
      </div>

      {/* The state, said in one word with a light next to it, above the
          sentence that explains it. A status the eye can take without reading. */}
      <div className="mt-4 flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${live ? "animate-breathe" : ""}`}
          style={{
            background: accent,
            boxShadow: live ? `0 0 8px 1px ${accent}` : undefined,
          }}
        />
        <span
          className="text-[11px] font-semibold tracking-[0.14em] uppercase"
          style={{ color: accent }}
        >
          {live ? "Running" : status.kind === "lapsed" ? "Lapsed" : "Stopped"}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] text-label-2">{windowLabel}</p>
    </section>
  );
}
