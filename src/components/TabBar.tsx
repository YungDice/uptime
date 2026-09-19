export type Tab = "clock" | "people" | "boards" | "account";

/**
 * The Clock app's tab bar: a solid strip over the content, icons drawn as
 * authored SVG in one stroke weight, the active tab in the run colour.
 *
 * Solid rather than translucent on purpose. On a true-black ground a
 * translucent bar has nothing to be translucent against - it reads as content
 * leaking through the chrome rather than as a material.
 */
export function TabBar({
  tab,
  onChange,
  markAccount,
}: {
  tab: Tab;
  onChange(next: Tab): void;
  /** Marks the Account tab while the session is still anonymous. */
  markAccount?: boolean;
}) {
  const items: { id: Tab; label: string; icon: JSX.Element }[] = [
    { id: "clock", label: "Uptime", icon: <StopwatchIcon /> },
    { id: "people", label: "People", icon: <PeopleIcon /> },
    { id: "boards", label: "Boards", icon: <BoardsIcon /> },
    { id: "account", label: "Account", icon: <AccountIcon /> },
  ];

  return (
    <nav
      className="absolute inset-x-0 bottom-0 z-40"
      style={{
        background: "var(--color-page)",
        paddingBottom: "max(env(safe-area-inset-bottom), 4px)",
      }}
      aria-label="Sections"
    >
      <ul className="mx-auto flex border-t border-hairline">
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
                <span className="relative">
                  {item.icon}
                  {markAccount && item.id === "account" ? (
                    <span
                      aria-hidden="true"
                      className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full"
                      style={{ background: "var(--color-run)" }}
                    />
                  ) : null}
                </span>
                <span className="text-tab">{item.label}</span>
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

function AccountIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8.2" r="3.6" {...stroke} />
      <path d="M5.2 19.6c0-3.3 3-5.6 6.8-5.6s6.8 2.3 6.8 5.6" {...stroke} />
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
