export type Tab = "clock" | "people" | "boards";

/**
 * The Clock app's tab bar: a translucent strip over the content, icons drawn
 * as authored SVG in one stroke weight, the active tab in the run colour.
 */
export function TabBar({ tab, onChange }: { tab: Tab; onChange(next: Tab): void }) {
  const items: { id: Tab; label: string; icon: JSX.Element }[] = [
    { id: "clock", label: "Uptime", icon: <StopwatchIcon /> },
    { id: "people", label: "People", icon: <PeopleIcon /> },
    { id: "boards", label: "Boards", icon: <BoardsIcon /> },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40"
      style={{
        background: "color-mix(in srgb, var(--color-void) 82%, transparent)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      aria-label="Sections"
    >
      <ul className="mx-auto flex max-w-md border-t border-hairline">
        {items.map((item) => {
          const active = item.id === tab;
          return (
            <li key={item.id} className="flex-1">
              <button
                type="button"
                onClick={() => onChange(item.id)}
                aria-current={active ? "page" : undefined}
                className="flex w-full flex-col items-center gap-1 py-2"
                style={{ color: active ? "var(--color-run)" : "var(--color-label-2)" }}
              >
                {item.icon}
                <span className="text-[10px] font-medium tracking-[0.01em]">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function StopwatchIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="13.5" r="7.5" {...stroke} />
      <path d="M12 13.5V9.6" {...stroke} />
      <path d="M9.6 2.5h4.8" {...stroke} />
      <path d="M18.4 7.1l1.3-1.3" {...stroke} />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9.5" cy="8" r="3.4" {...stroke} />
      <path d="M3.4 19.2c0-3.1 2.7-5.3 6.1-5.3s6.1 2.2 6.1 5.3" {...stroke} />
      <path d="M16.4 6.1a3 3 0 0 1 0 5.6" {...stroke} />
      <path d="M18.2 14.5c1.5.7 2.4 2 2.4 3.6" {...stroke} />
    </svg>
  );
}

function BoardsIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 20V12.8" {...stroke} />
      <path d="M12 20V4.6" {...stroke} />
      <path d="M19.5 20v-11" {...stroke} />
    </svg>
  );
}
