import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

// Gated the same way as features/__tests__/club-activity-postgres.integration.test.ts
// (and academy-postgres.integration.test.ts) -- skipped unless a real
// Postgres test database is configured. This is the ONE test that actually
// exercises the atomic SQL in
// PostgresTournamentLiveStateRepository.ts::upsertAttendance -- a mocked
// repository (features/__tests__/tournament-attendance.test.ts) cannot
// meaningfully validate the arrived_at CASE/COALESCE expression against a
// real database.
//
// History: an earlier version of upsertAttendance guarded writes with a
// client-supplied `write_seq` (Date.now()) and this file tested THAT
// out-of-order-completion scenario directly. Reverted -- trusting a client
// device's wall clock as an authoritative DB-level ordering token is
// unsound (see AttendanceUpsert's doc comment). Same-tab click ordering is
// now guaranteed client-side instead (lib/attendance-write-queue.ts, tested
// in lib/__tests__/attendance-write-queue.test.ts): the browser never sends
// two "Пришёл" requests for the same player concurrently, so this
// repository method never has to adjudicate between two competing writes
// from the same client. What it DOES still need to get right, and what
// this file verifies against a real database, is plain last-processed-wins
// for `arrived` plus race-free arrived_at computation.
const TEST_DATABASE_URL = process.env.ATTENDANCE_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;
const PLAYER_ID = "92000000-0000-4000-8000-000000000001";
const TOURNAMENT_ID = "92000000-0000-4000-8000-000000000002";

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Attendance integration tests require a localhost test database");
  }
}

describePostgres("tournament_attendance atomic upsert (real Postgres)", () => {
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
    await client`INSERT INTO players (id, display_name) VALUES (${PLAYER_ID}::uuid, 'Attendance Player')`;
    await client`
      INSERT INTO tournaments (id, title, start_at, max_players)
      VALUES (${TOURNAMENT_ID}::uuid, 'Attendance Tournament', now(), 20)
      ON CONFLICT (id) DO NOTHING
    `;
  });

  afterAll(async () => {
    if (!client) return;
    await client`DELETE FROM tournament_attendance WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;
    await client`DELETE FROM tournaments WHERE id = ${TOURNAMENT_ID}::uuid`;
    await client`DELETE FROM players WHERE id = ${PLAYER_ID}::uuid`;
    await client.end();
  });

  it("first write inserts and stamps arrived_at", async () => {
    await client`DELETE FROM tournament_attendance WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;

    const result = await repository.upsertAttendance({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      arrived: true,
    });

    expect(result.arrived).toBe(true);
    expect(result.arrived_at).not.toBeNull();
  });

  it("false does not create an arrived_at, and does not error on first write", async () => {
    await client`DELETE FROM tournament_attendance WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;

    const result = await repository.upsertAttendance({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      arrived: false,
    });

    expect(result.arrived).toBe(false);
    expect(result.arrived_at).toBeNull();
  });

  it("sequential true -> false -> true: arrived_at is stamped once and preserved across every later toggle", async () => {
    await client`DELETE FROM tournament_attendance WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;

    const first = await repository.upsertAttendance({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      arrived: true,
    });
    expect(first.arrived).toBe(true);
    const originalArrivedAt = first.arrived_at;
    expect(originalArrivedAt).not.toBeNull();

    const second = await repository.upsertAttendance({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      arrived: false,
    });
    expect(second.arrived).toBe(false);
    // arrived=false must NOT clear arrived_at.
    expect(second.arrived_at).toBe(originalArrivedAt);

    const third = await repository.upsertAttendance({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      arrived: true,
    });
    expect(third.arrived).toBe(true);
    // Re-arriving must reuse the ORIGINAL arrived_at, not stamp a fresh one.
    expect(third.arrived_at).toBe(originalArrivedAt);
  });

  it("plain last-processed-wins: whichever write actually executes last in Postgres is the final state (accepted cross-tab semantics, not a bug)", async () => {
    await client`DELETE FROM tournament_attendance WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;

    await repository.upsertAttendance({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      arrived: true,
    });

    const last = await repository.upsertAttendance({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      arrived: false,
    });

    expect(last.arrived).toBe(false);

    const rows = await client`
      SELECT arrived FROM tournament_attendance
      WHERE tournament_id = ${TOURNAMENT_ID}::uuid AND player_id = ${PLAYER_ID}::uuid
    `;
    expect(rows[0].arrived).toBe(false);
  });

  it("a different player in the same tournament is unaffected", async () => {
    const OTHER_PLAYER_ID = "92000000-0000-4000-8000-000000000003";
    await client`DELETE FROM players WHERE id = ${OTHER_PLAYER_ID}::uuid`;
    await client`INSERT INTO players (id, display_name) VALUES (${OTHER_PLAYER_ID}::uuid, 'Other Player')`;
    await client`DELETE FROM tournament_attendance WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;

    await repository.upsertAttendance({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      arrived: true,
    });

    const attendance = await repository.findAttendanceByTournamentId(TOURNAMENT_ID);
    expect(attendance.get(PLAYER_ID)?.arrived).toBe(true);
    expect(attendance.has(OTHER_PLAYER_ID)).toBe(false);

    await client`DELETE FROM players WHERE id = ${OTHER_PLAYER_ID}::uuid`;
  });

  it("no ordering/version parameter is accepted -- nothing a client could send is able to block a future write", async () => {
    // Structural: AttendanceUpsert only has tournament_id/player_id/arrived.
    // This test exists to catch a future regression that reintroduces a
    // client-supplied revision/timestamp field.
    const result = await repository.upsertAttendance({
      tournament_id: TOURNAMENT_ID,
      player_id: PLAYER_ID,
      arrived: true,
    } satisfies { tournament_id: string; player_id: string; arrived: boolean });

    expect(Object.keys(result).sort()).toEqual(["arrived", "arrived_at"]);
  });
});
