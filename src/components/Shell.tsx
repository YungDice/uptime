import { useEffect, useRef, useState } from "react";
import { TabBar, type Tab } from "./TabBar";

/**
 * The Clock app's chrome: a large title that collapses into a compact bar as
 * the page scrolls, and a tab bar pinned to the bottom edge.
 *
 * On a viewport wider than a phone the column keeps its own edges rather than
 * floating in an unbounded black field - this ships as a Tauri window on
 * Windows too, and a phone layout stretched across a desktop reads as an
 * accident. The bounded surface is the deliberate version of the same thing.
 */
export function Shell({
  children,
  title,
  tab,
  onTab,
  local,
  markAccount,
}: {
  children: React.ReactNode;
  title: string;
  tab: Tab;
  onTab(next: Tab): void;
  local?: boolean;
  markAccount?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Hysteresis, so a title sitting exactly on the threshold cannot flicker
    // between the two states as the page settles.
    const onScroll = () => {
      const y = el.scrollTop;
      setCollapsed((was) => (was ? y > 24 : y > 44));
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [tab]);

  // A tab change resets the scroll, so the title must come back with it.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    setCollapsed(false);
  }, [tab]);

  return (
    <div className="flex h-full justify-center bg-page">
      <div className="relative flex h-full w-full max-w-md flex-col lg:border-x lg:border-hairline">
        {/* Compact bar: the title's destination, not a second header. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-30 transition-opacity duration-200"
          style={{
            opacity: collapsed ? 1 : 0,
            background: "color-mix(in srgb, var(--color-page) 92%, transparent)",
            backdropFilter: "saturate(180%) blur(24px)",
            WebkitBackdropFilter: "saturate(180%) blur(24px)",
            paddingTop: "env(safe-area-inset-top)",
          }}
        >
          <div className="hairline flex items-center justify-center px-5 py-3">
            <span className="text-body font-semibold text-label">{title}</span>
          </div>
        </div>

        <div ref={scroller} className="pane min-h-0 flex-1 overflow-y-auto">
          <header
            className="flex items-center justify-between px-5 pt-3 pb-1"
            style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
          >
            <h1
              className="text-screen text-label transition-opacity duration-200"
              style={{ opacity: collapsed ? 0 : 1 }}
            >
              {title}
            </h1>
            {local ? (
              <span
                className="rounded-full px-2 py-0.5 text-micro font-medium text-label-2"
                style={{ background: "var(--color-raise)" }}
                title="No Supabase schema reachable - running on local storage"
              >
                Local
              </span>
            ) : null}
          </header>
          <main className="pb-28">{children}</main>
        </div>

        <TabBar tab={tab} onChange={onTab} markAccount={markAccount === true} />
      </div>
    </div>
  );
}
