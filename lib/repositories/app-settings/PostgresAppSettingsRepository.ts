import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import type { AppSettingsRepository } from "./AppSettingsRepository";

// Drizzle/Postgres counterpart of SupabaseAppSettingsRepository — same
// contract, same "errors are silently ignored" behavior on both read and
// write (the Supabase version never checked `.error` either; replicated
// here via try/catch rather than left to throw, so switching
// DATABASE_PROVIDER doesn't change what callers observe on failure).
export class PostgresAppSettingsRepository implements AppSettingsRepository {
  async get(key: string): Promise<unknown> {
    try {
      const [row] = await db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .limit(1);

      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    try {
      await db
        .insert(appSettings)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value, updatedAt: new Date() },
        });
    } catch {
      // Silently ignored — matches the Supabase implementation.
    }
  }
}
