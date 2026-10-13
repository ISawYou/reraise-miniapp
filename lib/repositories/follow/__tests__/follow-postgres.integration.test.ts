import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

// Proves the follows guarantees that mocked tests structurally cannot: the
// real unique index / ON CONFLICT idempotency under concurrency, the DB
// CHECK against self-follow, join direction and ordering of the lists, the
// unbounded listFollowingIds, and both ON DELETE CASCADE directions. Gated
// behind a real, disposable local database (same convention as
// features/__tests__/club-activity-postgres.integration.test.ts and
// lib/__tests__/player-merge.integration.test.ts); skipped when
// FOLLOW_POSTGRES_TEST_URL is not set. NEVER point this at production.
const TEST_DATABASE_URL = process.env.FOLLOW_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Follow integration tests require a localhost test database");
  }
}

// Every player this suite creates shares this prefix, so cleanup can never
// touch rows it did not create.
const ID_PREFIX = "93000000-0000-4000-8000-";
const pid = (n: number) => `${ID_PREFIX}${String(n).padStart(12, "0")}`;

const A = pid(1);
const B = pid(2);
const C = pid(3);
const D = pid(4);
const E = pid(5);

describePostgres("Follow PostgreSQL repository", () => {
  let client: Sql;
  let repository: InstanceType<
    typeof import("@/lib/repositories/follow/PostgresFollowRepository")["PostgresFollowRepository"]
  >;

  async function resetRows() {
    // follows rows go with the players (ON DELETE CASCADE) -- which is itself
    // asserted by the cascade tests below.
    await client`DELETE FROM players WHERE id::text LIKE ${ID_PREFIX + "%"}`;
  }

  async function insertPlayers(ids: string[]) {
    for (const id of ids) {
      await client`INSERT INTO players (id, display_name) VALUES (${id}::uuid, ${"Player " + id.slice(-4)})`;
    }
  }

  async function insertEdge(follower: string, followed: string, createdAt?: string, id?: string) {
    await client`
      INSERT INTO follows (id, follower_player_id, followed_player_id, created_at)
      VALUES (
        COALESCE(${id ?? null}::uuid, gen_random_uuid()),
        ${follower}::uuid,
        ${followed}::uuid,
        COALESCE(${createdAt ?? null}::timestamptz, now())
      )
    `;
  }

  async function edgeCount(follower: string, followed: string): Promise<number> {
    const [row] = await client`
      SELECT count(*)::int AS n FROM follows
      WHERE follower_player_id = ${follower}::uuid AND followed_player_id = ${followed}::uuid
    `;
    return row.n as number;
  }

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(TEST_DATABASE_URL!);
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    client = postgres(TEST_DATABASE_URL!, { max: 5 });
    const { PostgresFollowRepository } = await import("@/lib/repositories/follow/PostgresFollowRepository");
    repository = new PostgresFollowRepository();
    await resetRows();
  });

  afterEach(async () => {
    await resetRows();
  });

  afterAll(async () => {
    if (!client) return;
    await resetRows();
    await client.end();
  });

  describe("create", () => {
    it("inserts one directed edge", async () => {
      await insertPlayers([A, B]);

      await repository.create(A, B);

      expect(await edgeCount(A, B)).toBe(1);
      expect(await edgeCount(B, A)).toBe(0);
    });

    it("is idempotent: a second create does not throw and leaves exactly one row", async () => {
      await insertPlayers([A, B]);

      await repository.create(A, B);
      await expect(repository.create(A, B)).resolves.toBeUndefined();

      expect(await edgeCount(A, B)).toBe(1);
    });

    it("concurrent creates of the same pair all succeed and leave exactly one row", async () => {
      await insertPlayers([A, B]);

      const results = await Promise.allSettled(Array.from({ length: 25 }, () => repository.create(A, B)));

      expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
      expect(await edgeCount(A, B)).toBe(1);
    });
  });

  describe("self-follow", () => {
    it("is rejected by the DB CHECK constraint (repository, no service validation involved)", async () => {
      await insertPlayers([A]);

      const error = await repository.create(A, A).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).not.toBeNull();

      const { extractPostgresError } = await import("@/lib/db/postgres-error");
      const info = extractPostgresError(error);
      expect(info?.code).toBe("23514");
      expect(info?.constraint).toBe("follows_no_self_follow");

      expect(await edgeCount(A, A)).toBe(0);
    });

    it("is rejected by the DB CHECK constraint on a raw insert too", async () => {
      await insertPlayers([A]);

      await expect(insertEdge(A, A)).rejects.toMatchObject({
        code: "23514",
        constraint_name: "follows_no_self_follow",
      });
    });
  });

  describe("delete", () => {
    it("removes an existing edge", async () => {
      await insertPlayers([A, B]);
      await repository.create(A, B);

      await repository.delete(A, B);

      expect(await edgeCount(A, B)).toBe(0);
    });

    it("is a no-op for a missing edge", async () => {
      await insertPlayers([A, B]);

      await expect(repository.delete(A, B)).resolves.toBeUndefined();
      expect(await edgeCount(A, B)).toBe(0);
    });

    it("deleting A -> B does not remove B -> A", async () => {
      await insertPlayers([A, B]);
      await repository.create(A, B);
      await repository.create(B, A);

      await repository.delete(A, B);

      expect(await edgeCount(A, B)).toBe(0);
      expect(await edgeCount(B, A)).toBe(1);
    });
  });

  describe("exists and counts", () => {
    it("exists is directional", async () => {
      await insertPlayers([A, B]);
      await repository.create(A, B);

      expect(await repository.exists(A, B)).toBe(true);
      expect(await repository.exists(B, A)).toBe(false);
    });

    it("countFollowers / countFollowing are exact and isolated per player", async () => {
      await insertPlayers([A, B, C, D, E]);
      // Incoming to A: B, C, D.  Outgoing from A: E.
      await repository.create(B, A);
      await repository.create(C, A);
      await repository.create(D, A);
      await repository.create(A, E);
      // Noise that must not leak into A's numbers: B -> C, D -> E.
      await repository.create(B, C);
      await repository.create(D, E);

      expect(await repository.countFollowers(A)).toBe(3);
      expect(await repository.countFollowing(A)).toBe(1);

      expect(await repository.countFollowers(E)).toBe(2); // A, D
      expect(await repository.countFollowing(E)).toBe(0);

      expect(await repository.countFollowers(B)).toBe(0);
      expect(await repository.countFollowing(B)).toBe(2); // A, C

      expect(await repository.countFollowers(pid(999))).toBe(0);
      expect(await repository.countFollowing(pid(999))).toBe(0);
    });
  });

  describe("lists", () => {
    it("listFollowers returns the follower side; listFollowing returns the followed side", async () => {
      await insertPlayers([A, B, C, D]);
      await repository.create(B, A); // B follows A
      await repository.create(C, A); // C follows A
      await repository.create(A, D); // A follows D

      const followers = await repository.listFollowers(A, 10, 0);
      expect(followers.map((p) => p.id).sort()).toEqual([B, C].sort());

      const following = await repository.listFollowing(A, 10, 0);
      expect(following.map((p) => p.id)).toEqual([D]);
    });

    it("orders newest created_at first", async () => {
      await insertPlayers([A, B, C, D]);
      await insertEdge(B, A, "2026-01-01T10:00:00Z");
      await insertEdge(C, A, "2026-01-03T10:00:00Z");
      await insertEdge(D, A, "2026-01-02T10:00:00Z");

      const followers = await repository.listFollowers(A, 10, 0);

      expect(followers.map((p) => p.id)).toEqual([C, D, B]);
    });

    it("breaks created_at ties deterministically by edge id DESC (both lists)", async () => {
      await insertPlayers([A, B, C, D]);
      const sameInstant = "2026-02-01T12:00:00Z";
      // Rows are inserted in the OPPOSITE order of the expected result, with
      // edge ids B(...03) > C(...02) > D(...01), so only an explicit
      // `id DESC` tiebreak yields [B, C, D].
      await insertEdge(D, A, sameInstant, "93100000-0000-4000-8000-000000000001");
      await insertEdge(C, A, sameInstant, "93100000-0000-4000-8000-000000000002");
      await insertEdge(B, A, sameInstant, "93100000-0000-4000-8000-000000000003");
      expect((await repository.listFollowers(A, 10, 0)).map((p) => p.id)).toEqual([B, C, D]);

      await insertEdge(A, D, sameInstant, "93100000-0000-4000-8000-000000000011");
      await insertEdge(A, C, sameInstant, "93100000-0000-4000-8000-000000000012");
      await insertEdge(A, B, sameInstant, "93100000-0000-4000-8000-000000000013");
      expect((await repository.listFollowing(A, 10, 0)).map((p) => p.id)).toEqual([B, C, D]);
    });

    it("supports limit and offset without gaps or overlap", async () => {
      const others = Array.from({ length: 7 }, (_, i) => pid(100 + i));
      await insertPlayers([A, ...others]);
      for (const [i, other] of others.entries()) {
        await insertEdge(other, A, `2026-03-0${i + 1}T00:00:00Z`);
      }
      const newestFirst = [...others].reverse();

      const page1 = await repository.listFollowers(A, 3, 0);
      const page2 = await repository.listFollowers(A, 3, 3);
      const page3 = await repository.listFollowers(A, 3, 6);
      const beyond = await repository.listFollowers(A, 3, 9);

      expect(page1.map((p) => p.id)).toEqual(newestFirst.slice(0, 3));
      expect(page2.map((p) => p.id)).toEqual(newestFirst.slice(3, 6));
      expect(page3.map((p) => p.id)).toEqual(newestFirst.slice(6, 7));
      expect(beyond).toEqual([]);

      // Same pagination contract on the following side.
      for (const [i, other] of others.entries()) {
        await insertEdge(A, other, `2026-04-0${i + 1}T00:00:00Z`);
      }
      expect((await repository.listFollowing(A, 2, 2)).map((p) => p.id)).toEqual(newestFirst.slice(2, 4));
    });

    it("returns ONLY the approved public summary fields (no username)", async () => {
      await insertPlayers([A, B]);
      await client`
        UPDATE players
        SET username = 'secret_handle',
            email = 'secret@example.com',
            telegram_id = 93000001,
            telegram_avatar_url = 'https://example.com/tg.png',
            custom_avatar_url = 'https://example.com/custom.png'
        WHERE id = ${B}::uuid
      `;
      await repository.create(B, A);
      await repository.create(A, B);

      const [follower] = await repository.listFollowers(A, 10, 0);
      const [followed] = await repository.listFollowing(A, 10, 0);

      for (const item of [follower, followed]) {
        expect(Object.keys(item).sort()).toEqual([
          "custom_avatar_url",
          "display_name",
          "id",
          "telegram_avatar_url",
        ]);
        expect(item).toEqual({
          id: B,
          display_name: "Player 0002",
          telegram_avatar_url: "https://example.com/tg.png",
          custom_avatar_url: "https://example.com/custom.png",
        });
      }
    });

    it("returns null avatar fields when a player has no avatars", async () => {
      await insertPlayers([A, B]);
      await repository.create(B, A);

      const [item] = await repository.listFollowers(A, 10, 0);

      expect(item.telegram_avatar_url).toBeNull();
      expect(item.custom_avatar_url).toBeNull();
    });
  });

  describe("listFollowingIds", () => {
    it("returns every followed id (not limited to 50 or any page size)", async () => {
      const TOTAL = 120;
      const targets = Array.from({ length: TOTAL }, (_, i) => pid(1000 + i));
      await insertPlayers([A]);
      // Bulk-insert players and edges server-side; per-row round trips would
      // make this test needlessly slow.
      await client`
        INSERT INTO players (id, display_name)
        SELECT (${ID_PREFIX} || lpad((1000 + g)::text, 12, '0'))::uuid, 'Followed ' || g
        FROM generate_series(0, ${TOTAL - 1}::int) AS g
      `;
      await client`
        INSERT INTO follows (follower_player_id, followed_player_id)
        SELECT ${A}::uuid, (${ID_PREFIX} || lpad((1000 + g)::text, 12, '0'))::uuid
        FROM generate_series(0, ${TOTAL - 1}::int) AS g
      `;

      const ids = await repository.listFollowingIds(A);

      expect(TOTAL).toBeGreaterThan(50);
      expect(ids).toHaveLength(TOTAL);
      expect(new Set(ids)).toEqual(new Set(targets));
      expect(await repository.countFollowing(A)).toBe(TOTAL);
    });

    it("returns only the player's own outgoing ids", async () => {
      await insertPlayers([A, B, C]);
      await repository.create(A, B);
      await repository.create(C, B); // someone else's edge
      await repository.create(B, A); // incoming to A

      expect(await repository.listFollowingIds(A)).toEqual([B]);
      expect(await repository.listFollowingIds(pid(999))).toEqual([]);
    });
  });

  describe("cascade", () => {
    it("deleting the follower player removes its follow edges", async () => {
      await insertPlayers([A, B, C]);
      await repository.create(A, B);
      await repository.create(A, C);
      await repository.create(B, C); // unrelated edge must survive

      await client`DELETE FROM players WHERE id = ${A}::uuid`;

      expect(await edgeCount(A, B)).toBe(0);
      expect(await edgeCount(A, C)).toBe(0);
      expect(await edgeCount(B, C)).toBe(1);
    });

    it("deleting the followed player removes its follow edges", async () => {
      await insertPlayers([A, B, C]);
      await repository.create(B, A);
      await repository.create(C, A);
      await repository.create(B, C); // unrelated edge must survive

      await client`DELETE FROM players WHERE id = ${A}::uuid`;

      expect(await edgeCount(B, A)).toBe(0);
      expect(await edgeCount(C, A)).toBe(0);
      expect(await edgeCount(B, C)).toBe(1);
    });
  });
});
