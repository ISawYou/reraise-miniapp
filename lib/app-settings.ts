import "server-only";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function getAppSetting(key: string): Promise<unknown> {
  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return data?.value ?? null;
}

export async function setAppSetting(key: string, value: unknown): Promise<void> {
  const supabase = getSupabaseServer();
  await supabase
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() });
}
