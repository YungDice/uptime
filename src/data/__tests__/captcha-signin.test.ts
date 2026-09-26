import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The CAPTCHA token has to reach both sign-ins, and its absence has to change
 * nothing. The second half is the one that matters for rollout: the client
 * ships before CAPTCHA is switched on in Supabase, so a build that cannot get
 * a token must sign in exactly as it did before.
 *
 * Supabase is faked at the client, and the token at `captchaToken` - the
 * iframe behind it needs a browser, and is exercised there instead.
 */
const fake = vi.hoisted(() => ({
  token: null as string | null,
  siteKey: null as string | null,
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
  captchaToken: () => Promise.resolve(fake.token),
  turnstileSiteKeyFromEnv: () => fake.siteKey,
}));

import { SupabaseStore } from "../supabase";

const REFUSED = { code: "captcha_failed", message: "captcha verification process failed" };

function store(): SupabaseStore {
  return new SupabaseStore({ url: "https://example.supabase.co", anonKey: "anon" });
}

beforeEach(() => {
  fake.token = null;
  fake.siteKey = null;
  vi.clearAllMocks();
  fake.auth.getSession.mockResolvedValue({ data: { session: null } });
  fake.auth.signInAnonymously.mockResolvedValue({ error: null });
  fake.auth.signInWithPassword.mockResolvedValue({ error: null });
  fake.auth.getUser.mockResolvedValue({ data: { user: { id: "a1b2c3d4-0000-4000-8000-000000000001" } } });
  fake.rpc.mockImplementation((fn: string) =>
    Promise.resolve({
      data: fn === "uptime_account" ? { isAnonymous: true, email: null, createdAt: 0 } : { serverNow: 0 },
      error: null,
    }),
  );
});

describe("anonymous sign-in on first run", () => {
  it("carries the token when there is one", async () => {
    fake.token = "tok";
    await store().start("you");
    expect(fake.auth.signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: "tok" } });
  });

  it("is the same call as before when there is none", async () => {
    await store().start("you");
    expect(fake.auth.signInAnonymously).toHaveBeenCalledWith(undefined);
  });

  it("does not ask for a token when a session already exists", async () => {
    fake.token = "tok";
    fake.auth.getSession.mockResolvedValue({ data: { session: { user: {} } } });
    await store().start("you");
    expect(fake.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("explains a refusal instead of repeating Supabase's wording", async () => {
    fake.siteKey = "key";
    fake.auth.signInAnonymously.mockResolvedValue({ error: REFUSED });
    await expect(store().start("you")).rejects.toThrow("Couldn't confirm you're a person");
  });
});

describe("signing in with a password", () => {
  it("carries the token when there is one", async () => {
    fake.token = "tok";
    await store().signIn("a@b.co", "pw");
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "pw",
      options: { captchaToken: "tok" },
    });
  });

  it("is the same call as before when there is none", async () => {
    await store().signIn("a@b.co", "pw");
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@b.co", password: "pw" });
  });

  it("blames the build, not the user, when it was built without a site key", async () => {
    // Retrying cannot fix this one, so the message must not suggest it.
    fake.auth.signInWithPassword.mockResolvedValue({ error: REFUSED });
    const result = await store().signIn("a@b.co", "pw");
    expect(result).toEqual({
      ok: false,
      message: "This version of Uptime can't pass the sign-in check. Update the app and try again.",
    });
  });

  it("leaves other refusals in Supabase's words", async () => {
    fake.auth.signInWithPassword.mockResolvedValue({
      error: { code: "invalid_credentials", message: "Invalid login credentials" },
    });
    fake.auth.getUser.mockResolvedValue({ data: { user: null } });
    const result = await store().signIn("a@b.co", "pw");
    expect(result).toEqual({ ok: false, message: "Invalid login credentials" });
  });
});
