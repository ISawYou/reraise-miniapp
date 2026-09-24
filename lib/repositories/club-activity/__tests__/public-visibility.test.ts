// Always-on guard for the public Club Activity WHERE clause (the real-DB
// proof lives in features/__tests__/club-activity-postgres.integration.test.ts,
// which needs ACTIVITY_POSTGRES_TEST_URL): hidden achievement codes are
// excluded IN SQL -- before LIMIT/OFFSET -- and NULL-code rows survive.
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

const { publicClubActivityVisibility } = await import(
  "@/lib/repositories/club-activity/PostgresClubActivityRepository"
);

describe("publicClubActivityVisibility", () => {
  it("keeps published/published_at filters and excludes marco_reus with a NULL-safe predicate", () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const { sql, params } = new PgDialect().sqlToQuery(publicClubActivityVisibility(now)!);

    expect(sql).toContain('"club_activity_events"."status" = $1');
    expect(sql).toContain('"club_activity_events"."published_at" <= $2');
    expect(sql).toMatch(
      /\("club_activity_events"\."achievement_code" is null or "club_activity_events"\."achievement_code" not in \(\$3\)\)/
    );
    expect(params).toEqual(["published", now.toISOString(), "marco_reus"]);
  });
});
