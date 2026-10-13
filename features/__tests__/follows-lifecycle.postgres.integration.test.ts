import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";

// Real-database proof of the follow TARGET lifecycle, through the real stack:
// POST /api/players/[id]/follow -> lib/follows-auth.ts -> lib/admin-auth.ts ->
// features/follows.ts -> PostgresPlayerRepository / PostgresFollowRepository.
// Only the request boundary (next/headers) is faked. The mocked route tests
// cannot show that a genuinely merged-away or hard-deleted target never gets
// an edge and never leaks Postgres text, so this suite does.
//
// Gated behind a real, disposable local database (same convention as
// follow-postgres.integration.test.ts); skipped when FOLLOW_POSTGRES_TEST_URL
// is not set. NEVER point this at production.
const TEST_DATABASE_URL = process.env.FOLLOW_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Follow lifecycle integration tests require a localhost test database");
  }
}

const mocks = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookieJar.get(name);
      return value === undefined ? undefined : { value };
    },
  }),
}));

// Disjoint from the other follow suites' prefixes (93..., 92...).
const ID_PREFIX = "94000000-0000-4000-8000-";
const pid = (n: number) => `${ID_PREFIX}${String(n).padStart(12, "0")}`;

const VIEWER = pid(1);
const TARGET = pid(2);
const SOURCE = pid(3); // merged INTO TARGET
const DELETED = pid(4); // created, then hard-deleted
const NEVER_EXISTED = pid(5); // no row at all

describePostgres("Follow target lifecycle (PostgreSQL, real stack)", () => {
  let client: Sql;
  let route: typeof import("@/app/api/players/[id]/follow/route");
  let signSession: (playerId: string) => string;
  let cookieName: string;

  async function resetRows() {
    // follows rows go with the players (ON DELETE CASCADE).
    await client`DELETE FROM players WHERE id::text LIKE ${ID_PREFIX + "%"}`;
  }

  async function insertPlayer(id: string, mergedInto: string | null = null) {
    await client`
      INSERT INTO players (id, display_name, merged_into_player_id)
      VALUES (${id}::uuid, ${"Player " + id.slice(-4)}, ${mergedInto}::uuid)
    `;
  }

  async function totalEdges(): Promise<number> {
    const [row] = await client`
      SELECT count(*)::int AS n FROM follows
      WHERE follower_player_id::text LIKE ${ID_PREFIX + "%"} OR followed_player_id::text LIKE ${ID_PREFIX + "%"}
    `;
    return row.n as number;
  }

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  function request(method: "POST" | "DELETE", id: string, origin: string | null = "https://re-raise.ru") {
    return new Request(`https://re-raise.ru/api/players/${id}/follow`, {
      method,
      headers: origin === null ? {} : { origin },
    });
  }

  function signInAs(id: string) {
    mocks.cookieJar.set(cookieName, signSession(id));
  }

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(TEST_DATABASE_URL!);
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    process.env.SESSION_SECRET = "follow-lifecycle-test-secret";
    client = postgres(TEST_DATABASE_URL!, { max: 5 });
    route = await import("@/app/api/players/[id]/follow/route");
    ({ signSession, COOKIE_NAME: cookieName } = await import("@/lib/telegram-web-session"));
    await resetRows();
  });

  afterEach(async () => {
    mocks.cookieJar.clear();
    vi.restoreAllMocks();
    await resetRows();
  });

  afterAll(async () => {
    if (!client) return;
    await resetRows();
    await client.end();
  });

  it("control: a real, normal target is followed and the edge is really stored", async () => {
    await insertPlayer(VIEWER);
    await insertPlayer(TARGET);
    signInAs(VIEWER);

    const response = await route.POST(request("POST", TARGET), ctx(TARGET));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ following: true, followers: 1, following_count: 0 });
    expect(await totalEdges()).toBe(1);
  });

  it("A. a REAL merged-away target (merged_into_player_id set) -> 409, and NO edge on SOURCE or TARGET", async () => {
    await insertPlayer(VIEWER);
    await insertPlayer(TARGET);
    await insertPlayer(SOURCE, TARGET);
    signInAs(VIEWER);

    const response = await route.POST(request("POST", SOURCE), ctx(SOURCE));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "Аккаунт был объединён. Обновите страницу." });
    // Neither the merged-away row nor its canonical successor got an edge.
    expect(await totalEdges()).toBe(0);
    const edgesOnEither = await client`
      SELECT 1 FROM follows WHERE followed_player_id IN (${SOURCE}::uuid, ${TARGET}::uuid)
    `;
    expect(edgesOnEither).toHaveLength(0);
  });

  it("A2. following the canonical TARGET of that merge works normally (the merged-away guard is not over-broad)", async () => {
    await insertPlayer(VIEWER);
    await insertPlayer(TARGET);
    await insertPlayer(SOURCE, TARGET);
    signInAs(VIEWER);

    const response = await route.POST(request("POST", TARGET), ctx(TARGET));

    expect(response.status).toBe(200);
    const edges = await client`SELECT followed_player_id::text AS id FROM follows WHERE follower_player_id = ${VIEWER}::uuid`;
    expect(edges.map((row) => row.id)).toEqual([TARGET]);
  });

  it("B1. a hard-deleted target -> 404 Игрок не найден, no edge, no Postgres text in the response", async () => {
    await insertPlayer(VIEWER);
    await insertPlayer(DELETED);
    await client`DELETE FROM players WHERE id = ${DELETED}::uuid`;
    signInAs(VIEWER);

    const response = await route.POST(request("POST", DELETED), ctx(DELETED));
    const text = await response.text();

    expect(response.status).toBe(404);
    expect(JSON.parse(text)).toEqual({ error: "Игрок не найден" });
    expect(text).not.toMatch(/foreign key|violates|constraint|follows_|relation|postgres|detail/i);
    expect(await totalEdges()).toBe(0);
  });

  it("B2. a target id that never existed -> the same stable 404 with no edge", async () => {
    await insertPlayer(VIEWER);
    signInAs(VIEWER);

    const response = await route.POST(request("POST", NEVER_EXISTED), ctx(NEVER_EXISTED));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Игрок не найден" });
    expect(await totalEdges()).toBe(0);
  });

  it("unfollowing an absent target is an idempotent 200 and touches nothing", async () => {
    await insertPlayer(VIEWER);
    signInAs(VIEWER);

    const response = await route.DELETE(request("DELETE", NEVER_EXISTED), ctx(NEVER_EXISTED));

    expect(response.status).toBe(200);
    expect(await totalEdges()).toBe(0);
  });

  it("CSRF on the real stack: a cross-origin cookie POST is 403 and writes no row", async () => {
    await insertPlayer(VIEWER);
    await insertPlayer(TARGET);
    signInAs(VIEWER);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await route.POST(request("POST", TARGET, "https://evil.example"), ctx(TARGET));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Недопустимый источник запроса" });
    expect(await totalEdges()).toBe(0);
  });

  it("CSRF on the real stack: a cross-origin cookie DELETE leaves an existing edge intact", async () => {
    await insertPlayer(VIEWER);
    await insertPlayer(TARGET);
    await client`INSERT INTO follows (follower_player_id, followed_player_id) VALUES (${VIEWER}::uuid, ${TARGET}::uuid)`;
    signInAs(VIEWER);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await route.DELETE(request("DELETE", TARGET, "https://evil.example"), ctx(TARGET));

    expect(response.status).toBe(403);
    expect(await totalEdges()).toBe(1);
  });
});
