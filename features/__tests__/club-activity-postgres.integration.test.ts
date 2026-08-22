import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

const TEST_DATABASE_URL = process.env.ACTIVITY_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;
const PLAYER_ID = "91000000-0000-4000-8000-000000000001";
const TOURNAMENT_ID = "91000000-0000-4000-8000-000000000002";

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Club Activity integration tests require a localhost test database");
  }
}

describePostgres("Club Activity PostgreSQL repository", () => {
  let client: Sql;
  let repository: InstanceType<
    typeof import("@/lib/repositories/club-activity/PostgresClubActivityRepository")["PostgresClubActivityRepository"]
  >;

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(TEST_DATABASE_URL!);
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    client = postgres(TEST_DATABASE_URL!, { max: 5 });
    const { PostgresClubActivityRepository } = await import(
      "@/lib/repositories/club-activity/PostgresClubActivityRepository"
    );
    repository = new PostgresClubActivityRepository();

    await client`DELETE FROM players WHERE id = ${PLAYER_ID}::uuid`;
    await client`INSERT INTO players (id, display_name) VALUES (${PLAYER_ID}::uuid, 'Activity Player')`;
    await client`
      INSERT INTO tournaments (id, title, start_at, max_players)
      VALUES (${TOURNAMENT_ID}::uuid, 'Activity Tournament', now(), 20)
      ON CONFLICT (id) DO NOTHING
    `;
  });

  afterAll(async () => {
    if (!client) return;
    await client`DELETE FROM club_activity_events WHERE title LIKE 'Activity test:%' OR idempotency_key LIKE 'activity-test:%'`;
    await client`DELETE FROM tournaments WHERE id = ${TOURNAMENT_ID}::uuid`;
    await client`DELETE FROM players WHERE id = ${PLAYER_ID}::uuid`;
    await client.end();
  });

  it("supports manual CRUD and published newest-first filtering", async () => {
    const draft = await repository.createManual({
      event_type: "news",
      status: "draft",
      title: "Activity test: draft",
      body: "Draft body",
      image_url: null,
      cta_label: null,
      cta_url: null,
      published_at: null,
    });
    const older = await repository.createManual({
      event_type: "update",
      status: "published",
      title: "Activity test: older",
      body: "Older body",
      image_url: null,
      cta_label: "Academy",
      cta_url: "/academy",
      published_at: "2026-08-20T10:00:00.000Z",
    });
    const newer = await repository.createManual({
      event_type: "news",
      status: "published",
      title: "Activity test: newer",
      body: "Newer body",
      image_url: null,
      cta_label: null,
      cta_url: null,
      published_at: "2026-08-21T10:00:00.000Z",
    });

    const feed = await repository.listPublished(100, 0);
    const testRows = feed.filter((row) => row.title.startsWith("Activity test:"));
    expect(testRows.map((row) => row.id)).toEqual([newer.id, older.id]);
    expect(testRows.some((row) => row.id === draft.id)).toBe(false);

    const publishedDraft = await repository.updateManual(draft.id, {
      status: "published",
      published_at: "2026-08-22T10:00:00.000Z",
      updated_at: "2026-08-22T10:00:00.000Z",
    });
    expect(publishedDraft?.status).toBe("published");
    await expect(repository.archiveManual(draft.id, new Date().toISOString())).resolves.toBe(true);
    expect((await repository.findById(draft.id))?.status).toBe("archived");
  });

  it("upserts one automatic event for a deterministic key", async () => {
    const input = {
      event_type: "tournament_winner" as const,
      title: "Activity test: winner",
      body: "First body",
      image_url: null,
      cta_label: "Открыть турнир",
      cta_url: `/tournaments/${TOURNAMENT_ID}`,
      player_id: PLAYER_ID,
      tournament_id: TOURNAMENT_ID,
      achievement_code: null,
      idempotency_key: "activity-test:winner",
      published_at: "2026-08-22T10:00:00.000Z",
    };
    const first = await repository.createAutomaticIdempotently(input);
    const second = await repository.createAutomaticIdempotently({ ...input, body: "Corrected body" });
    const [count] = await client<{ count: number }[]>`
      SELECT count(*)::int AS count FROM club_activity_events
      WHERE idempotency_key = 'activity-test:winner'
    `;

    expect(second.id).toBe(first.id);
    expect(second.body).toBe("Corrected body");
    expect(second.player?.display_name).toBe("Activity Player");
    expect(second.tournament?.title).toBe("Activity Tournament");
    expect(count.count).toBe(1);
  });
});
