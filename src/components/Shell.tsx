import { useEffect, useRef } from "react";
import { TabBar, type Tab } from "./TabBar";

/**
 * The chrome: one scrolling column and a tab bar pinned to the bottom edge.
 *
 * There is no screen title. There used to be a large one top-left - "Uptime",
 * "People", "Boards", "Account" - collapsing into a compact bar on scroll, and
 * all it ever said was the label of the tab already lit up at the bottom of
 * the same screen. It cost the top of every page to repeat itself, so each
 * screen now starts with its own content.
 *
 * On a viewport wider than a phone the column keeps its own edges rather than
 * floating in an unbounded black field - this ships as a Tauri window on
 * Windows too, and a phone layout stretched across a desktop reads as an
 * accident. The bounded surface is the deliberate version of the same thing.
 */
export function Shell({
  children,
  tab,
  onTab,
  local,
  markAccount,
}: {
  children: React.ReactNode;
  tab: Tab;
  onTab(next: Tab): void;
  local?: boolean;
  markAccount?: boolean;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);

  // A tab change is a move to a different page, so it starts at the top.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [tab]);

  return (
    <div className="flex h-full justify-center bg-page">
      <div
        className="relative flex h-full w-full max-w-md flex-col lg:border-x lg:border-hairline"
        // The safe area is held outside the scroller, so content scrolls
        // beneath a still edge rather than up under the status bar - which the
        // collapsing title bar used to cover and nothing now would.
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div ref={scroller} className="pane min-h-0 flex-1 overflow-y-auto">
          {local ? (
            <div className="flex justify-end px-5 pt-3">
              <span
                className="rounded-full px-2 py-0.5 text-micro font-medium text-label-2"
                style={{ background: "var(--color-raise)" }}
                title="No Supabase schema reachable - running on local storage"
              >
                Local
              </span>
            </div>
          ) : null}
          <main className="pt-2 pb-28">{children}</main>
        </div>

        <TabBar tab={tab} onChange={onTab} markAccount={markAccount === true} />
      </div>
    </div>
  );
}
