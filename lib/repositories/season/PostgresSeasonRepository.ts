import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { seasons } from "@/lib/db/schema";
import type { SeasonRepository, SeasonRow, SeasonFullRow, SeasonInsert } from "./SeasonRepository";

// Drizzle/Postgres counterpart of SupabaseSeasonRepository. Drizzle has no
// `.maybeSingle()` — `.limit(1)` + destructuring the first array element is
// the equivalent (undefined on no rows, mapped to null below). Unlike
// app-settings, no error-swallowing to replicate here: the Supabase version
// already threw on error, and Drizzle throws natively on the same failure —
// no compensation needed for this one.
export class PostgresSeasonRepository implements SeasonRepository {
  async findActive(): Promise<SeasonRow | null> {
    const [row] = await db
      .select({ id: seasons.id, title: seasons.title, is_active: seasons.isActive })
      .from(seasons)
      .where(eq(seasons.isActive, true))
      .limit(1);

    return row ?? null;
  }

  async listAll(): Promise<SeasonFullRow[]> {
    const rows = await db.select().from(seasons);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      start_date: row.startDate,
      end_date: row.endDate,
      is_active: row.isActive,
      created_at: row.createdAt.toISOString(),
    }));
  }

  async create(data: SeasonInsert): Promise<void> {
    await db
      .insert(seasons)
      .values({
        id: data.id,
        title: data.title,
        startDate: data.start_date,
        endDate: data.end_date,
        isActive: data.is_active,
        createdAt: new Date(data.created_at),
      })
      .onConflictDoNothing({ target: seasons.id });
  }

  async setActive(seasonId: string, isActive: boolean): Promise<void> {
    await db.update(seasons).set({ isActive }).where(eq(seasons.id, seasonId));
  }
}
