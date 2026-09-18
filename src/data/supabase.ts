import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { systemClock, type BoardEntry, type BoardId, type Clock, type Seconds } from "@/core";
import type { ActionResult, Snapshot, UptimeStore } from "./store";

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

  constructor(
    config: SupabaseConfig,
    private readonly clock: Clock = systemClock,
  ) {
    this.client = createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }

  async signIn(handle: string): Promise<Snapshot> {
    const { data: session } = await this.client.auth.getSession();
    if (!session.session) {
      // Anonymous sign-in keeps the first run frictionless; the account is
      // real and can be upgraded to email later.
      const { error } = await this.client.auth.signInAnonymously();
      if (error) throw new Error(error.message);
    }
    await this.rpc("uptime_ensure_profile", { p_handle: handle });
    return this.refresh();
  }

  async refresh(): Promise<Snapshot> {
    // uptime_open, not uptime_snapshot: opening the app is a sign of life, and
    // the server has to record that and hand back the pre-touch window anchor.
    const snapshot = await this.rpc<Snapshot>("uptime_open", {});
    this.syncClock(snapshot.serverNow);
    return snapshot;
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

  async follow(handle: string): Promise<ActionResult> {
    return this.action("uptime_follow", { p_handle: handle });
  }

  async unfollow(userId: string): Promise<ActionResult> {
    return this.action("uptime_unfollow", { p_user: userId });
  }

  async board(id: BoardId): Promise<BoardEntry[]> {
    return this.rpc<BoardEntry[]>("uptime_board", { p_board: id });
  }

  // --- internals -----------------------------------------------------------

  private syncClock(serverNow: Seconds): void {
    if ("syncTo" in this.clock && typeof this.clock.syncTo === "function") {
      (this.clock as { syncTo(n: Seconds): void }).syncTo(serverNow);
    }
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw new Error(error.message);
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
      return { ok: true, snapshot: result.snapshot, message: result.message };
    }
    return { ok: false, message: result.message };
  }
}
