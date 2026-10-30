import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import type { AppSettingsRepository, AppSettingRow } from "./AppSettingsRepository";
import { AppSettingsStorageError, InvalidStoredSettingError, storedObject } from "@/lib/app-settings-errors";

// Errors are distinct from missing rows. Object mutations serialize in the
// database, including concurrent first writes when the row does not exist.
export class PostgresAppSettingsRepository implements AppSettingsRepository {
  async get(key: string): Promise<unknown> {
    try {
      const [row] = await db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .limit(1);

      if (row && row.value == null) throw new InvalidStoredSettingError();
      return row ? row.value : null;
    } catch (error) {
      if (error instanceof InvalidStoredSettingError) throw error;
      throw new AppSettingsStorageError("read", error);
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
    } catch (error) {
      throw new AppSettingsStorageError("write", error);
    }
  }

  async updateObject(key: string, mutate: (current: Record<string, unknown>) => Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      return await db.transaction(async (tx) => {
        // ON CONFLICT waits for an uncommitted first insert, then SELECT FOR
        // UPDATE sees that transaction's committed value at READ COMMITTED.
        // Initialization is rolled back too if validation/read/write fails.
        await tx.insert(appSettings).values({ key, value: {} }).onConflictDoNothing({ target: appSettings.key });
        const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).for("update");
        if (!row) throw new InvalidStoredSettingError();
        const next = storedObject(mutate(structuredClone(storedObject(row.value))));
        const [saved] = await tx.update(appSettings).set({ value: next, updatedAt: new Date() }).where(eq(appSettings.key, key)).returning({ value: appSettings.value });
        if (!saved) throw new InvalidStoredSettingError();
        return storedObject(saved.value);
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (error instanceof InvalidStoredSettingError) throw error;
      throw new AppSettingsStorageError("atomic-mutation", error);
    }
  }

  async listAll(): Promise<AppSettingRow[]> {
    try {
      return await db.select({ key: appSettings.key, value: appSettings.value }).from(appSettings);
    } catch (error) {
      throw new AppSettingsStorageError("list", error);
    }
  }
}
