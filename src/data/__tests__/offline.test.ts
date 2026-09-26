import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A request that never reached the server has to say so in the app's voice.
 *
 * supabase-js does not throw when the network is down: every client hands back
 * an ordinary error whose message is the engine's own wording for a failed
 * fetch - "TypeError: Failed to fetch" in Chromium, "Load failed" in WebKit -
 * and the app shows refusals verbatim. So pressing a button on a train, or
 * launching before the Wi-Fi came up, put a raw JavaScript error on screen.
 *
 * Faked at the client, as in captcha-signin.test.ts. The shapes are the ones
 * postgrest-js and auth-js actually build from a rejected fetch.
 */
const fake = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    signInAnonymously: vi.fn(),
    signInWithPassword: vi.fn(),
    getUser: vi.fn(),
  },
  rpc: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: fake.auth, rpc: fake.rpc }),
}));

vi.mock("../captcha", () => ({
  captchaToken: () => Promise.resolve(null),
  turnstileSiteKeyFromEnv: () => null,
}));

import { SupabaseStore } from "../supabase";

const OFFLINE = "Couldn't reach Uptime. Check your connection and try again.";

/** What postgrest-js resolves with when fetch itself rejects. */
function postgrestOffline(message: string) {
  return { data: null, error: { message, details: "", hint: "", code: "" }, status: 0 };
}

/** What auth-js resolves with when fetch itself rejects. */
const AUTH_OFFLINE = { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 };

function store(): SupabaseStore {
  return new SupabaseStore({ url: "https://example.supabase.co", anonKey: "anon" });
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.auth.getSession.mockResolvedValue({ data: { session: { user: {} } } });
  fake.auth.getUser.mockResolvedValue({
    data: { user: { id: "a1b2c3d4-0000-4000-8000-000000000001" } },
    error: null,
  });
});

describe("a request that never reached the server", () => {
  it.each([
    ["Chromium", "TypeError: Failed to fetch"],
    ["WebKit", "TypeError: Load failed"],
    ["Firefox", "TypeError: NetworkError when attempting to fetch resource."],
  ])("is explained, not quoted, from %s", async (_engine, message) => {
    fake.rpc.mockResolvedValue(postgrestOffline(message));
    await expect(store().checkIn()).rejects.toThrow(OFFLINE);
  });

  it("is explained when a launch cannot read who is signed in", async () => {
    // Offline at launch, getUser comes back empty. This used to surface as
    // "Signed in but no user id came back", which blames the account.
    fake.auth.getUser.mockResolvedValue({ data: { user: null }, error: AUTH_OFFLINE });
    await expect(store().start("you")).rejects.toThrow(OFFLINE);
  });

  it("is explained when the first anonymous sign-in cannot go out", async () => {
    fake.auth.getSession.mockResolvedValue({ data: { session: null } });
    fake.auth.signInAnonymously.mockResolvedValue({ error: AUTH_OFFLINE });
    await expect(store().start("you")).rejects.toThrow(OFFLINE);
  });

  it("is explained when a password sign-in cannot go out", async () => {
    fake.auth.signInWithPassword.mockResolvedValue({ error: AUTH_OFFLINE });
    expect(await store().signIn("a@b.co", "pw")).toEqual({ ok: false, message: OFFLINE });
  });

  it("leaves a real refusal in the server's words", async () => {
    fake.rpc.mockResolvedValue({
      data: null,
      error: { message: "Too many sends this hour.", details: "", hint: "", code: "P0001" },
    });
    await expect(store().checkIn()).rejects.toThrow("Too many sends this hour.");
  });
});
