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
/**
 * An explicit opt-out, rather than blanking the Supabase variables.
 *
 * Emptying them in a mode file is fragile - it depends on env precedence and
 * reads as a mistake to anyone who finds it. A named flag says what it is.
 */
function forcedLocal(): boolean {
  return import.meta.env["VITE_UPTIME_ADAPTER"] === "local";
}

export function createStore(): UptimeStore {
  const config = forcedLocal() ? null : supabaseConfigFromEnv();
  if (config) return new SupabaseStore(config, systemClock);
  return new LocalStore(systemClock);
}

export function isBackedByServer(): boolean {
  return !forcedLocal() && supabaseConfigFromEnv() !== null;
}
