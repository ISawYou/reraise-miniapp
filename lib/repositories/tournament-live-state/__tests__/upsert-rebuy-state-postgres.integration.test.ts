import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

// Gated the same way as upsert-attendance-postgres.integration.test.ts one
// directory up -- skipped unless a real Postgres test database is
// configured. A mocked repository (features/__tests__/tournament-attendance.test.ts)
// is enough to verify upsertRebuyState's plain overwrite-on-conflict shape,
// but the CHECK constraints (rebuys >= 0, addons >= 0) and the composite PK
// upsert itself can only be meaningfully verified against a real database.
const TEST_DATABASE_URL = process.env.REBUY_STATE_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;
const PLAYER_ID = "93000000-0000-4000-8000-000000000001";
const TOURNAMENT_ID = "93000000-0000-4000-8000-000000000002";

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Rebuy-state integration tests require a localhost test database");
  }
}

describePostgres("tournament_rebuy_state upsert (real Postgres)", () => {
  let client: Sql;
  let repository: InstanceType<
    typeof import("../PostgresTournamentLiveStateRepository")["PostgresTournamentLiveStateRepository"]
  >;

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(TEST_DATABASE_URL!);
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    client = postgres(TEST_DATABASE_URL!, { max: 5 });
    const { PostgresTournamentLiveStateRepository } = await import(
      "../PostgresTournamentLiveStateRepository"
    );
    repository = new PostgresTournamentLiveStateRepository();

    await client`DELETE FROM players WHERE id = ${PLAYER_ID}::uuid`;
    await client`INSERT INTO players (id, display_name) VALUES (${PLAYER_ID}::uuid, 'Rebuy State Player')`;
    await client`
      INSERT INTO tournaments (id, title, start_at, max_players, kind)
      VALUES (${TOURNAMENT_ID}::uuid, 'Rebuy State Tournament', now(), 20, 'free')
      ON CONFLICT (id) DO NOTHING
    `;
  });

  afterAll(async () => {
    if (!client) return;
    await client`DELETE FROM tournament_rebuy_state WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;
    await client`DELETE FROM tournaments WHERE id = ${TOURNAMENT_ID}::uuid`;
    await client`DELETE FROM players WHERE id = ${PLAYER_ID}::uuid`;
    await client.end();
  });

  it("first write inserts the raw admin-facing Re-buy/Add-on values", async () => {
    await client`DELETE FROM tournament_rebuy_state WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;

    const result = await repository.upsertRebuyState({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      rebuys: 1,
      addons: 0,
    });

    expect(result).toEqual({ rebuys: 1, addons: 0 });
  });

  it("raw Re-buy 0->1->2 (initial stack not yet taken, then taken, then one real rebuy) overwrites on every subsequent upsert", async () => {
    await client`DELETE FROM tournament_rebuy_state WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;

    const first = await repository.upsertRebuyState({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      rebuys: 0,
      addons: 0,
    });
    expect(first.rebuys).toBe(0);

    const second = await repository.upsertRebuyState({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      rebuys: 1,
      addons: 0,
    });
    expect(second.rebuys).toBe(1);

    const third = await repository.upsertRebuyState({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      rebuys: 2,
      addons: 0,
    });
    expect(third.rebuys).toBe(2);

    const rows = await client`
      SELECT rebuys, addons FROM tournament_rebuy_state
      WHERE tournament_id = ${TOURNAMENT_ID}::uuid AND player_id = ${PLAYER_ID}::uuid
    `;
    expect(rows[0].rebuys).toBe(2);
  });

  it("Add-on 0->1 overwrites on the next upsert", async () => {
    await client`DELETE FROM tournament_rebuy_state WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;

    await repository.upsertRebuyState({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      rebuys: 1,
      addons: 0,
    });
    const second = await repository.upsertRebuyState({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      rebuys: 1,
      addons: 1,
    });

    expect(second.addons).toBe(1);
  });

  it("a negative rebuys value is rejected by the CHECK constraint", async () => {
    await client`DELETE FROM tournament_rebuy_state WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;

    await expect(
      repository.upsertRebuyState({
        tournament_id: TOURNAMENT_ID,
        player_id: PLAYER_ID,
        rebuys: -1,
        addons: 0,
      })
    ).rejects.toThrow();
  });

  it("a negative addons value is rejected by the CHECK constraint", async () => {
    await client`DELETE FROM tournament_rebuy_state WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;

    await expect(
      repository.upsertRebuyState({
        tournament_id: TOURNAMENT_ID,
        player_id: PLAYER_ID,
        rebuys: 0,
        addons: -1,
      })
    ).rejects.toThrow();
  });

  it("a different player in the same tournament is unaffected", async () => {
    const OTHER_PLAYER_ID = "93000000-0000-4000-8000-000000000003";
    await client`DELETE FROM players WHERE id = ${OTHER_PLAYER_ID}::uuid`;
    await client`INSERT INTO players (id, display_name) VALUES (${OTHER_PLAYER_ID}::uuid, 'Other Player')`;
    await client`DELETE FROM tournament_rebuy_state WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;

    await repository.upsertRebuyState({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      rebuys: 3,
      addons: 1,
    });

    const state = await repository.findRebuyStateByTournamentId(TOURNAMENT_ID);
    expect(state.get(PLAYER_ID)).toEqual({ rebuys: 3, addons: 1 });
    expect(state.has(OTHER_PLAYER_ID)).toBe(false);

    await client`DELETE FROM players WHERE id = ${OTHER_PLAYER_ID}::uuid`;
  });
});
