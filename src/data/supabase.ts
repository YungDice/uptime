import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { captchaToken, turnstileSiteKeyFromEnv } from "./captcha";
import { prepareAvatar } from "./image";
import { systemClock, type BoardEntry, type BoardId, type Clock, type Seconds } from "@/core";
import type {
  Account,
  ActionResult,
  CheckoutResult,
  PublicProfile,
  Pulse,
  RankInfo,
  Snapshot,
  UptimeStore,
} from "./store";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/** Reads Vite env. Returns null when the project has not been wired up yet. */
export function supabaseConfigFromEnv(): SupabaseConfig | null {
  const url = import.meta.env["VITE_SUPABASE_URL"];
  const anonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"];
  if (typeof url !== "string" || typeof anonKey !== "string") return null;
  if (url.length === 0 || anonKey.length === 0) return null;
  return { url, anonKey };
}

/**
 * Supabase adapter.
 *
 * Deliberately thin: every rule - the gift cap, the friend gate, the account
 * age gate, the revive price - lives in SQL, and this class only calls it. A
 * client that could compute its own balance would be a client that could lie
 * about it.
 */
export class SupabaseStore implements UptimeStore {
  private readonly client: SupabaseClient;

  /**
   * The account from the most recent read.
   *
   * The snapshot the SQL actions return does not carry one - `account` is a
   * separate RPC, because it reads auth.users rather than the game tables - so
   * without this every action would hand the UI a snapshot with no account at
   * all, and the first component to ask whether the session is anonymous would
   * throw. It changes only on sign-in, sign-out and the upgrade, and all three
   * go through a full refresh, so caching it cannot go stale.
   */
  private lastAccount: Account | null = null;

  constructor(
    config: SupabaseConfig,
    private readonly clock: Clock = systemClock,
  ) {
    this.client = createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }

  async start(handle: string): Promise<Snapshot> {
    const { data: session } = await this.client.auth.getSession();
    if (!session.session) {
      // Anonymous sign-in keeps the first run frictionless; the account is
      // real and can be upgraded to email later. It is off by default on a new
      // Supabase project, and the raw error does not say where to turn it on.
      // It is also the sign-in a script would repeat to mint accounts, so it
      // carries a CAPTCHA token whenever this build can get one.
      const token = await captchaToken();
      const { error } = await this.client.auth.signInAnonymously(
        token === null ? undefined : { options: { captchaToken: token } },
      );
      if (error) {
        throw new Error(
          captchaRefusal(error) ??
            (/anonymous/i.test(error.message)
              ? "Anonymous sign-ins are disabled for this Supabase project. " +
                "Turn them on under Authentication - Sign In / Providers."
              : error.message),
        );
      }
    }
    // The handle is unique across the whole table, so it cannot come from the
    // caller's preference alone - every first run would ask for the same one
    // and the second user would collide. Derive it from the authenticated id,
    // which is unique by construction; `handle` only seeds the display name.
    const { data: current } = await this.client.auth.getUser();
    const uid = current.user?.id;
    if (!uid) throw new Error("Signed in but no user id came back.");

    await this.rpc("uptime_ensure_profile", { p_handle: handleFor(uid, handle) });
    return this.refresh();
  }

  async refresh(): Promise<Snapshot> {
    // uptime_open, not uptime_snapshot: opening the app is a sign of life, and
    // the server has to record that and hand back the pre-touch window anchor.
    // The account rides alongside rather than inside, so that one big read
    // model does not have to be redefined every time auth gains a field.
    const [snapshot, account] = await Promise.all([
      this.rpc<Snapshot>("uptime_open", {}),
      this.rpc<Account>("uptime_account", {}),
    ]);
    this.syncClock(snapshot.serverNow);
    this.lastAccount = account;
    return { ...snapshot, account };
  }

  async pulse(): Promise<Pulse> {
    // One primary-key read (`uptime_pulse`), not the snapshot: this runs on a
    // timer in every open client, so its cost is multiplied by however many
    // people have the app open at once.
    const pulse = await this.rpc<Pulse>("uptime_pulse", {});
    this.syncClock(pulse.serverNow);
    return pulse;
  }

  async signUp(email: string, password: string, handle: string): Promise<ActionResult> {
    // updateUser, not signUp: the session is already an anonymous user, and
    // attaching credentials to it keeps the same id - so the streak, the
    // history and the balance survive the upgrade.
    let { data, error } = await this.client.auth.updateUser({ email, password });

    // The upgrade is not atomic, and that is the whole trap. Supabase applies
    // the password immediately but, with email confirmations on, only *queues*
    // the address. So an attempt abandoned at the inbox leaves an account that
    // already has this password and still has no email - and retrying is then
    // refused for reusing it. The password is the one the user just typed, so
    // it is already the right one: re-send the address by itself rather than
    // making them invent a password they do not need.
    if (error?.code === "same_password") {
      ({ data, error } = await this.client.auth.updateUser({ email }));
    }
    if (error) return { ok: false, message: error.message };

    const named = await this.action("uptime_set_handle", { p_handle: handle });
    if (!named.ok) return named;

    const snapshot = await this.refresh();

    // With email confirmations on - the default for a hosted project - the
    // address is only *pending* until the link is clicked, and
    // auth.users.is_anonymous stays true until it lands. Reporting "account
    // created" here would be a claim the Account tab and the leaderboards both
    // immediately contradict, so the message has to match what really
    // happened. Turning confirmations off makes this branch unreachable.
    const pending = data.user?.new_email;
    if (pending !== undefined || snapshot.account.isAnonymous) {
      return {
        ok: true,
        snapshot,
        message: `Almost there - click the link sent to ${pending ?? email}. Your streak is safe, but you can't sign in until you do.`,
      };
    }

    return {
      ok: true,
      snapshot,
      message: "Account created. Your streak carried over.",
    };
  }

  async signIn(email: string, password: string): Promise<ActionResult> {
    const token = await captchaToken();
    const { error } = await this.client.auth.signInWithPassword(
      token === null ? { email, password } : { email, password, options: { captchaToken: token } },
    );
    if (error) {
      const refused = captchaRefusal(error);
      if (refused !== null) return { ok: false, message: refused };
      // "Invalid login credentials" is what Supabase says when an address is
      // still only *pending* on this account, because until the link is
      // clicked no user actually owns it. That reads as "wrong password" and
      // sends people off to reset one that was never the problem, so name the
      // real cause when the pending address is the one being typed.
      if (error.code === "invalid_credentials") {
        const { data: current } = await this.client.auth.getUser();
        const pending = current.user?.new_email;
        if (pending !== undefined && pending.toLowerCase() === email.trim().toLowerCase()) {
          return {
            ok: false,
            message: `${pending} hasn't been confirmed yet - click the link in that email, then sign in.`,
          };
        }
      }
      return { ok: false, message: error.message };
    }
    return { ok: true, snapshot: await this.refresh(), message: "Signed in." };
  }

  async signOut(): Promise<ActionResult> {
    const { error } = await this.client.auth.signOut();
    if (error) return { ok: false, message: error.message };
    // Signing out drops to a fresh anonymous account rather than to a dead
    // screen: the app has to be usable without one, so that is where it lands.
    const snapshot = await this.start("you");
    return { ok: true, snapshot, message: "Signed out." };
  }

  async setHandle(handle: string): Promise<ActionResult> {
    return this.action("uptime_set_handle", { p_handle: handle });
  }

  async setDisplayName(name: string): Promise<ActionResult> {
    return this.action("uptime_set_display_name", { p_name: name });
  }

  async setAvatar(file: File | null): Promise<ActionResult> {
    if (file === null) return this.action("uptime_set_avatar", { p_url: null });

    const { data: current } = await this.client.auth.getUser();
    const uid = current.user?.id;
    if (uid === undefined) return { ok: false, message: "Not signed in." };

    // Whatever was picked becomes a small square before it goes anywhere, so
    // the bucket's size limit and its format list are satisfied by
    // construction rather than by turning a camera roll away at the door.
    let image: Blob;
    try {
      image = await prepareAvatar(file);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "That image did not work." };
    }

    const ext = EXTENSIONS[image.type];
    if (ext === undefined) return { ok: false, message: "That image format is not supported." };

    // Named for the moment it was uploaded, not for the user. A fixed filename
    // would be the same URL every time, so every viewer that had already seen
    // the old face would keep showing it until their cache expired - and the
    // one person guaranteed not to see the change is the one who made it.
    // The uid folder is what the storage policy checks, so it has to lead.
    const path = `${uid}/${Date.now()}.${ext}`;
    const { error } = await this.client.storage
      .from("avatars")
      .upload(path, image, { contentType: image.type, upsert: false });
    if (error) return { ok: false, message: error.message };

    const { data: published } = this.client.storage.from("avatars").getPublicUrl(path);
    const result = await this.action("uptime_set_avatar", { p_url: published.publicUrl });
    // Only once the profile points at the new file: sweeping first would leave
    // an account whose avatar_url names an object that is already gone if the
    // RPC then refused. A refusal leaves the new upload orphaned instead, and
    // the next successful change collects it.
    if (result.ok) await this.sweepOldAvatars(uid, path);
    return result;
  }

  /**
   * Delete this account's earlier avatars.
   *
   * Each change writes a new object under the same folder and nothing used to
   * remove the last one, so a user who tried four photos kept four files for
   * good - and the only quota that noticed was the project's. Best-effort by
   * design: the picture is already changed and saved by the time this runs, so
   * a failed cleanup is a wasted object, not a failed action, and must not
   * turn one into the other.
   */
  private async sweepOldAvatars(uid: string, keep: string): Promise<void> {
    try {
      const { data: files } = await this.client.storage.from("avatars").list(uid);
      const stale = (files ?? [])
        .map((entry) => `${uid}/${entry.name}`)
        .filter((name) => name !== keep);
      if (stale.length > 0) await this.client.storage.from("avatars").remove(stale);
    } catch {
      // See above: nothing the user did has failed.
    }
  }

  async myRank(id: BoardId): Promise<RankInfo | null> {
    return (await this.rpc<RankInfo | null>("uptime_my_rank", { p_board: id })) ?? null;
  }

  async checkIn(): Promise<ActionResult> {
    return this.action("uptime_check_in", {});
  }

  async startStreak(): Promise<ActionResult> {
    return this.action("uptime_start_streak", {});
  }

  async stopStreak(): Promise<ActionResult> {
    return this.action("uptime_stop_streak", {});
  }

  async sendTime(toUserId: string, amount: Seconds): Promise<ActionResult> {
    return this.action("uptime_send_time", { p_to: toUserId, p_amount: amount });
  }

  async reviveFriend(userId: string): Promise<ActionResult> {
    return this.action("uptime_revive", { p_user: userId });
  }

  /**
   * Ask the `create-checkout` Edge Function for a Stripe Checkout page.
   *
   * Nothing is unlocked here. The price, the account it is for and the unlock
   * itself all live on the server: the function names the account from the
   * session's own token, and only Stripe's signed webhook records the payment.
   * An open app finds out on its next pulse.
   */
  async buyWholeClock(): Promise<CheckoutResult> {
    const { data, error } = await this.client.functions.invoke<{ url?: string; error?: string }>(
      "create-checkout",
      { method: "POST" },
    );
    if (error) return { ok: false, message: await functionError(error) };
    if (typeof data?.url !== "string") {
      return { ok: false, message: data?.error ?? "The payment page did not come back. Try again." };
    }
    return {
      ok: true,
      checkoutUrl: data.url,
      message: "Finish paying in your browser. Your whole clock unlocks here as soon as it goes through.",
    };
  }

  async follow(handle: string): Promise<ActionResult> {
    return this.action("uptime_follow", { p_handle: handle });
  }

  async unfollow(userId: string): Promise<ActionResult> {
    return this.action("uptime_unfollow", { p_user: userId });
  }

  async board(id: BoardId): Promise<BoardEntry[]> {
    return this.rpc<BoardEntry[]>("uptime_board", { p_board: id });
  }

  async profile(userId: string): Promise<PublicProfile | null> {
    return (await this.rpc<PublicProfile | null>("uptime_profile", { p_user: userId })) ?? null;
  }

  // --- internals -----------------------------------------------------------

  private syncClock(serverNow: Seconds): void {
    if ("syncTo" in this.clock && typeof this.clock.syncTo === "function") {
      (this.clock as { syncTo(n: Seconds): void }).syncTo(serverNow);
    }
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw new Error(explain(error));
    return data as T;
  }

  /**
   * Actions return a refusal rather than throwing.
   *
   * A rejected gift is an ordinary outcome the UI should explain in the app's
   * own voice, not an exception - so the SQL hands back `{ ok, message }` and
   * only genuine failures become errors.
   */
  private async action(fn: string, args: Record<string, unknown>): Promise<ActionResult> {
    const result = await this.rpc<{ ok: boolean; message: string; snapshot?: Snapshot }>(fn, args);
    if (result.ok && result.snapshot) {
      this.syncClock(result.snapshot.serverNow);
      // Put the account back on. The SQL cannot supply it and the UI reads it
      // on every render, so a snapshot handed over without one takes the whole
      // app down rather than degrading.
      const account = this.lastAccount ?? (await this.rpc<Account>("uptime_account", {}));
      this.lastAccount = account;
      return { ok: true, snapshot: { ...result.snapshot, account }, message: result.message };
    }
    return { ok: false, message: result.message };
  }
}

/**
 * A handle that is unique by construction and still legible.
 *
 * Users will want to choose their own eventually; until that exists, this is
 * the thing that stops a second signup failing on the unique constraint.
 */
/**
 * Formats the avatar bucket accepts, and the extension each one is stored as.
 *
 * Mirrors `allowed_mime_types` on the bucket in `0010_avatars_and_follow_direction.sql`.
 * Read against what `prepareAvatar` produced rather than against what the user
 * picked: the encoder chooses between WebP and JPEG based on what this engine
 * can actually write, so the output format is not known until it exists.
 */
const EXTENSIONS: Record<string, string | undefined> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function handleFor(userId: string, preferred: string): string {
  const stem = preferred.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 10) || "user";
  const suffix = userId.replace(/-/g, "").slice(0, 8);
  return `${stem}_${suffix}`;
}

/**
 * The message an Edge Function refused with, in its own words.
 *
 * supabase-js reports any non-2xx answer as "Edge Function returned a non-2xx
 * status code" and leaves the body - where the function explains itself, "create
 * an account first", "already unlocked" - on the raw response.
 */
async function functionError(error: { message: string; context?: unknown }): Promise<string> {
  const response = error.context;
  if (response instanceof Response) {
    if (response.status === 404) {
      return "Payments aren't set up on this server yet: the create-checkout function is not deployed.";
    }
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") return body.error;
    } catch {
      // Not JSON; fall through to the generic message.
    }
  }
  return "Could not start the payment. Try again in a moment.";
}

/**
 * Supabase's refusal of a sign-in with no valid CAPTCHA token, in plain words.
 *
 * Supabase says "captcha verification process failed", which is true and
 * helps nobody. Which of two things went wrong depends on whether this build
 * could ask for a token at all: one built without the site key never can, and
 * that is a release problem rather than something the user can retry past.
 */
function captchaRefusal(error: { code?: string | undefined; message: string }): string | null {
  if (error.code !== "captcha_failed" && !/captcha/i.test(error.message)) return null;
  return turnstileSiteKeyFromEnv() === null
    ? "This version of Uptime can't pass the sign-in check. Update the app and try again."
    : "Couldn't confirm you're a person. Check your connection and try again.";
}

/**
 * Turn PostgREST's codes into something a person can act on.
 *
 * The two that actually happen in practice both mean the same thing - the
 * schema has not been deployed - and the raw message ("could not find the
 * function in the schema cache") sends people looking in the wrong place.
 */
function explain(error: { code?: string; message: string }): string {
  if (error.code === "PGRST202" || error.code === "PGRST205") {
    // Naming what was missing distinguishes an empty project from one a
    // migration behind - the fix is the same, the diagnosis is not.
    const missing = /(?:function|table) (?:public\.)?([a-z_.]+)/i.exec(error.message)?.[1];
    return (
      `This Supabase project is missing ${missing ?? "the Uptime schema"}. ` +
      "Apply the migrations: paste supabase/deploy.sql into the SQL editor, " +
      "or run npm run db:push."
    );
  }
  if (error.code === "23505") {
    return "That nickname is already taken.";
  }
  if (error.code === "42501") {
    return "Permission denied by row-level security. Check the grants in 0006_boards_and_rls.sql.";
  }
  return error.message;
}
