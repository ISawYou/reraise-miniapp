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

  describe("Bubble Boy (marco_reus) is hidden from every public read, in SQL", () => {
    // Deliberately interleaved with ordinary events so a post-LIMIT filter
    // would produce short pages / shifted offsets. Timestamps are far in
    // the past so they sort after anything else in this suite.
    const base = Date.parse("2020-01-01T00:00:00.000Z");
    let bubbleId: string;
    const visibleIds: string[] = [];

    function automatic(key: string, minutes: number, achievementCode: string | null) {
      return repository.createAutomaticIdempotently({
        event_type: achievementCode ? "achievement" : "tournament_winner",
        title: `Activity test: ${key}`,
        body: "Body",
        image_url: null,
        cta_label: null,
        cta_url: null,
        player_id: PLAYER_ID,
        tournament_id: null,
        achievement_code: achievementCode,
        idempotency_key: `activity-test:${key}`,
        published_at: new Date(base + minutes * 60_000).toISOString(),
      });
    }

    async function allPublicIdsInBubbleWindow(pageSize: number) {
      const ids: string[] = [];
      for (let offset = 0; offset < 500; offset += pageSize) {
        const page = await repository.listPublishedWithSocial(pageSize, offset);
        ids.push(...page.map((row) => row.id));
        if (page.length < pageSize) break;
      }
      return ids;
    }

    beforeAll(async () => {
      // newest -> oldest: news, BUBBLE, winner, BUBBLE, legendary, news
      visibleIds.push((await automatic("vis-news-new", 60, null)).id);
      bubbleId = (await automatic("bubble-1", 50, "marco_reus")).id;
      visibleIds.push((await automatic("vis-winner", 40, null)).id);
      await automatic("bubble-2", 30, "marco_reus");
      visibleIds.push((await automatic("vis-headhunter", 20, "headhunter")).id);
      const manual = await repository.createManual({
        event_type: "news",
        status: "published",
        title: "Activity test: manual old news",
        body: "Body",
        image_url: null,
        cta_label: null,
        cta_url: null,
        published_at: new Date(base + 10 * 60_000).toISOString(),
      });
      visibleIds.push(manual.id);
    });

    it("public feed never contains marco_reus; NULL-code news/winner and other Legendary stay visible", async () => {
      const ids = await allPublicIdsInBubbleWindow(100);
      const window = ids.filter((id) => visibleIds.includes(id) || id === bubbleId);

      expect(window).toEqual(visibleIds);
      const published = await repository.listPublished(100, 0);
      expect(published.some((row) => row.achievement_code === "marco_reus")).toBe(false);
    });

    it("pagination is filtered in the query: every page is full and pages concatenate without gaps", async () => {
      const onePageAll = await allPublicIdsInBubbleWindow(500);
      for (const pageSize of [1, 2, 3]) {
        const paged = await allPublicIdsInBubbleWindow(pageSize);
        expect(paged).toEqual(onePageAll);
      }
      // Size-2 page starting at the offset of the first visible event in
      // this window: both slots are filled by visible rows, no hole where
      // the Bubble Boy row sits.
      const start = onePageAll.indexOf(visibleIds[0]);
      const page = await repository.listPublishedWithSocial(2, start);
      expect(page.map((row) => row.id)).toEqual(visibleIds.slice(0, 2));
    });

    it("public detail (findPublishedById) cannot open a marco_reus event", async () => {
      expect(await repository.findPublishedById(bubbleId)).toBeNull();
      expect(await repository.findPublishedById(visibleIds[2])).not.toBeNull();
    });

    it("admin reads still see the historical row, untouched", async () => {
      const admin = await repository.listAdmin(500);
      const row = admin.find((event) => event.id === bubbleId);
      expect(row).toMatchObject({ achievement_code: "marco_reus", status: "published" });
      expect((await repository.findById(bubbleId))?.id).toBe(bubbleId);
    });
  });
});
