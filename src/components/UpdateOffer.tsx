import { useState } from "react";
import type { UpdateState } from "@/updates/updater";

/**
 * A downloaded update, offered once per version.
 *
 * Grey, because an update belongs to no system: it is not the run, not time
 * being given and not a lapse. "Later" hides it until the next version; the
 * Account tab's Updates row still has it.
 */
export function UpdateOffer({ state, onInstall }: { state: UpdateState; onInstall(): void }) {
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (state.phase !== "ready" && state.phase !== "installing") return null;
  if (dismissed === state.version) return null;
  const installing = state.phase === "installing";

  return (
    <div role="status" className="animate-rise mx-5 mt-3 rounded-2xl bg-raise px-4 py-4">
      <p className="text-callout text-label">Uptime {state.version} is ready</p>
      <p className="mt-1 text-footnote text-label-2">
        Restarting takes a few seconds. Your clock keeps running while the app is closed - it was
        never kept by the app.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onInstall}
          disabled={installing}
          className="surface-2 rounded-full px-3.5 py-2 text-footnote font-medium text-label disabled:opacity-40"
        >
          {installing ? "Restarting" : "Restart now"}
        </button>
        {installing ? null : (
          <button
            type="button"
            onClick={() => setDismissed(state.version)}
            className="rounded-full px-3.5 py-2 text-footnote font-medium text-label-2"
          >
            Later
          </button>
        )}
      </div>
    </div>
  );
}
