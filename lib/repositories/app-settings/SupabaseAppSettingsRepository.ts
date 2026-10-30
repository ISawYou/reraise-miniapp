import "server-only";

import { getSupabaseServer } from "@/lib/database";
import type { AppSettingsRepository, AppSettingRow } from "./AppSettingsRepository";
import { AppSettingsStorageError, AtomicSettingsUnsupportedError, InvalidStoredSettingError } from "@/lib/app-settings-errors";

// CRUD remains available, with explicit failures. Atomic object mutation is
// intentionally unavailable: separate PostgREST calls cannot hold a row lock.
export class SupabaseAppSettingsRepository implements AppSettingsRepository {
  async get(key: string): Promise<unknown> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw new AppSettingsStorageError("read", error);
    if (data && data.value == null) throw new InvalidStoredSettingError();
    return data ? data.value : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("app_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() }).select("key").single();
    if (error || data?.key !== key) throw new AppSettingsStorageError("write", error);
  }

  async updateObject(): Promise<Record<string, unknown>> {
    throw new AtomicSettingsUnsupportedError();
  }

  async listAll(): Promise<AppSettingRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase.from("app_settings").select("key, value");

    if (error) {
      throw new AppSettingsStorageError("list", error);
    }

    return (data ?? []) as AppSettingRow[];
  }
}
