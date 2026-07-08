import "server-only";

import { getSupabaseServer } from "@/lib/database";
import type { AppSettingsRepository } from "./AppSettingsRepository";

// Current, active implementation — wraps the exact same Supabase queries
// lib/app-settings.ts used to call directly. No new behavior: errors are
// still silently ignored on both read and write, exactly as before.
export class SupabaseAppSettingsRepository implements AppSettingsRepository {
  async get(key: string): Promise<unknown> {
    const supabase = getSupabaseServer();
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    return data?.value ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    const supabase = getSupabaseServer();
    await supabase
      .from("app_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() });
  }
}
