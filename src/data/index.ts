import { systemClock } from "@/core";
import { LocalStore } from "./local";
import { SupabaseStore, supabaseConfigFromEnv } from "./supabase";
import type { UptimeStore } from "./store";

export * from "./store";
export { LocalStore } from "./local";
export { SupabaseStore } from "./supabase";

/**
 * Pick an adapter.
 *
 * Supabase when it is configured, browser storage otherwise. The app is fully
 * playable either way, which keeps the UI honest: nothing can quietly depend
 * on a backend that is not there.
 */
export function createStore(): UptimeStore {
  const config = supabaseConfigFromEnv();
  if (config) return new SupabaseStore(config, systemClock);
  return new LocalStore(systemClock);
}

export function isBackedByServer(): boolean {
  return supabaseConfigFromEnv() !== null;
}
