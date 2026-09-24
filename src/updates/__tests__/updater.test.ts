import { describe, expect, it, vi } from "vitest";
import {
  fetchUpdate,
  installUpdate,
  updateLabel,
  type DownloadEvent,
  type PendingUpdate,
  type UpdateState,
  type UpdaterApi,
} from "../updater";

function fakeUpdate(
  version: string,
  events: DownloadEvent[] = [],
  overrides: Partial<PendingUpdate> = {},
): PendingUpdate {
  return {
    version,
    download: async (onEvent) => {
      for (const event of events) onEvent?.(event);
    },
    install: async () => {},
    ...overrides,
  };
}

function fakeApi(update: PendingUpdate | null | Error): UpdaterApi & { relaunched: number } {
  const api = {
    relaunched: 0,
    check: async () => {
      if (update instanceof Error) throw update;
      return update;
    },
    relaunch: async () => {
      api.relaunched += 1;
    },
  };
  return api;
}

function recorder() {
  const states: UpdateState[] = [];
  return { states, report: (state: UpdateState) => states.push(state) };
}

describe("fetchUpdate", () => {
  it("reports current when the feed has nothing newer", async () => {
    const { states, report } = recorder();
    const result = await fetchUpdate(fakeApi(null), report);
    expect(result).toBeNull();
    expect(states.map((s) => s.phase)).toEqual(["checking", "current"]);
  });

  it("downloads what it finds and ends ready", async () => {
    const { states, report } = recorder();
    const update = fakeUpdate("0.2.0", [
      { event: "Started", data: { contentLength: 1000 } },
      { event: "Progress", data: { chunkLength: 250 } },
      { event: "Progress", data: { chunkLength: 750 } },
      { event: "Finished" },
    ]);
    const result = await fetchUpdate(fakeApi(update), report);
    expect(result).toBe(update);
    expect(states).toEqual([
      { phase: "checking" },
      { phase: "downloading", version: "0.2.0", progress: null },
      { phase: "downloading", version: "0.2.0", progress: 0.25 },
      { phase: "downloading", version: "0.2.0", progress: 1 },
      { phase: "ready", version: "0.2.0" },
    ]);
  });

  it("reports progress in whole percents, not per chunk", async () => {
    const { states, report } = recorder();
    const chunks: DownloadEvent[] = Array.from({ length: 1000 }, () => ({
      event: "Progress" as const,
      data: { chunkLength: 1 },
    }));
    await fetchUpdate(
      fakeApi(fakeUpdate("0.2.0", [{ event: "Started", data: { contentLength: 1000 } }, ...chunks])),
      report,
    );
    const downloading = states.filter((s) => s.phase === "downloading");
    // The opening "unknown" state plus one per percent from 0 to 100.
    expect(downloading).toHaveLength(102);
  });

  it("stays quiet about progress when the size is unknown", async () => {
    const { states, report } = recorder();
    await fetchUpdate(
      fakeApi(fakeUpdate("0.2.0", [{ event: "Started", data: {} }, { event: "Progress", data: { chunkLength: 5 } }])),
      report,
    );
    expect(states.map((s) => s.phase)).toEqual(["checking", "downloading", "ready"]);
  });

  it("turns a failed check into a state rather than a throw", async () => {
    const { states, report } = recorder();
    const result = await fetchUpdate(fakeApi(new Error("offline")), report);
    expect(result).toBeNull();
    expect(states.at(-1)).toEqual({ phase: "failed", message: "offline" });
  });

  it("turns a failed download into a state and hands nothing back", async () => {
    const { states, report } = recorder();
    const update = fakeUpdate("0.2.0", [], {
      download: async () => {
        throw new Error("signature mismatch");
      },
    });
    const result = await fetchUpdate(fakeApi(update), report);
    expect(result).toBeNull();
    expect(states.at(-1)).toEqual({ phase: "failed", message: "signature mismatch" });
  });
});

describe("installUpdate", () => {
  it("installs, then restarts into the new build", async () => {
    const { states, report } = recorder();
    const install = vi.fn(async () => {});
    const api = fakeApi(null);
    await installUpdate(api, fakeUpdate("0.2.0", [], { install }), report);
    expect(install).toHaveBeenCalledOnce();
    expect(api.relaunched).toBe(1);
    expect(states).toEqual([{ phase: "installing", version: "0.2.0" }]);
  });

  it("does not restart when the install failed", async () => {
    const { states, report } = recorder();
    const api = fakeApi(null);
    const update = fakeUpdate("0.2.0", [], {
      install: async () => {
        throw new Error("denied");
      },
    });
    await installUpdate(api, update, report);
    expect(api.relaunched).toBe(0);
    expect(states.at(-1)).toEqual({ phase: "failed", message: "denied" });
  });
});

describe("updateLabel", () => {
  it("names every state in plain words", () => {
    expect(updateLabel({ phase: "current" })).toBe("Up to date");
    expect(updateLabel({ phase: "downloading", version: "0.2.0", progress: 0.42 })).toBe(
      "Downloading 42%",
    );
    expect(updateLabel({ phase: "downloading", version: "0.2.0", progress: null })).toBe(
      "Downloading 0.2.0",
    );
    expect(updateLabel({ phase: "ready", version: "0.2.0" })).toBe("Restart for 0.2.0");
    expect(updateLabel({ phase: "failed", message: "x" })).toBe("Failed - try again");
  });
});
