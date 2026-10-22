import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

// Merge engine v2 (collision-aware same-tournament reconciliation) against a
// REAL PostgreSQL database: real unique indexes / composite PKs / the
// live-entry -> registration FK (ON DELETE CASCADE), real SERIALIZABLE
// transaction + rollback. Same gate + safety check as the other merge
// integration suites:
//   PLAYER_MERGE_POSTGRES_TEST_URL=postgres://user@127.0.0.1:5432/<name>_test \
//     npx vitest run --no-file-parallelism lib/__tests__/merge-engine-v2.postgres.integration.test.ts
//
// Scenario numbers in test names refer to the merge-engine-v2 spec (§8).
const TEST_DATABASE_URL = process.env.PLAYER_MERGE_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Account-merge integration tests require a localhost test database");
  }
}

const PREFIX = "95000000-0000-4000-8000-0000000";
function id(n: number): string {
  return `${PREFIX}${String(n).padStart(5, "0")}`;
}

const TARGET = id(1);
const SOURCE = id(2);
const T_A = id(101);
const T_B = id(102);
const T_C = id(103);
const TEAM_1 = id(201);
const TEAM_2 = id(202);
const TG_TARGET = 950000001;
const TG_SOURCE = 950000002;

// The production case that motivated v2 (read-only diagnostic shape,
// recreated here with synthetic rows -- no production connection).
const TOXIN = "53d02f1e-9a94-4dee-ada5-906b7c85038d";
const TO_OXIN = "47886f41-4ca9-4fbc-9836-8fa2cdc7a6cf";
const CRAZY_PINEAPPLE = "18bcea75-d8fe-4d0d-85f5-67320905cfab";

const TABLES = [
  "registrations",
  "results",
  "tournament_attendance",
  "tournament_rebuy_state",
  "tournament_player_eliminations",
  "tournament_live_entries",
] as const;

describePostgres("Merge engine v2 -- collision-aware tournament reconciliation (PostgreSQL)", () => {
  let client: Sql;
  let merge: typeof import("@/lib/player-merge");

  async function resetRows() {
    await client`DROP TRIGGER IF EXISTS merge_v2_test_fail ON players`;
    await client`DROP FUNCTION IF EXISTS merge_v2_test_fail_fn()`;
    await client`DELETE FROM teams WHERE id IN (${TEAM_1}::uuid, ${TEAM_2}::uuid)`;
    await client`DELETE FROM tournaments WHERE id::text LIKE ${PREFIX + "%"} OR id = ${CRAZY_PINEAPPLE}::uuid`;
    await client`DELETE FROM players WHERE id::text LIKE ${PREFIX + "%"} OR id IN (${TOXIN}::uuid, ${TO_OXIN}::uuid)`;
    await client`DELETE FROM players WHERE telegram_id IN (${TG_SOURCE}, ${TG_TARGET})`;
    await client`DELETE FROM players WHERE lower(email) LIKE '%@merge-v2.test'`;
  }

  async function createPlayer(
    playerId: string,
    opts: {
      name?: string;
      adminName?: string | null;
      telegramId?: number | null;
      email?: string | null;
      role?: string;
      blocked?: boolean;
    } = {}
  ) {
    await client`
      INSERT INTO players (id, display_name, admin_display_name, telegram_id, email, role, is_blocked)
      VALUES (${playerId}::uuid, ${opts.name ?? "Player " + playerId.slice(-3)}, ${opts.adminName ?? null},
              ${opts.telegramId ?? null}, ${opts.email ?? null}, ${opts.role ?? "player"}, ${opts.blocked ?? false})
    `;
  }

  async function pair() {
    await createPlayer(TARGET, { name: "TOXIN", telegramId: TG_TARGET });
    await createPlayer(SOURCE, { name: "TO_OXIN", email: "source@merge-v2.test" });
  }

  async function createTournament(tournamentId: string, title: string, startAt: string) {
    await client`
      INSERT INTO tournaments (id, title, start_at, max_players)
      VALUES (${tournamentId}::uuid, ${title}, ${startAt}::timestamptz, 40)
    `;
  }

  async function registration(
    playerId: string,
    tournamentId: string,
    opts: { status?: string; createdAt?: string; noShowAt?: string | null; claimedAt?: string | null } = {}
  ): Promise<string> {
    const [row] = await client`
      INSERT INTO registrations (player_id, tournament_id, status, created_at, no_show_at, waitlist_promotion_notification_claimed_at)
      VALUES (${playerId}::uuid, ${tournamentId}::uuid, ${opts.status ?? "registered"},
              ${opts.createdAt ?? "2026-09-01T10:00:00Z"}::timestamptz, ${opts.noShowAt ?? null}::timestamptz,
              ${opts.claimedAt ?? null}::timestamptz)
      RETURNING id::text AS id
    `;
    return row.id as string;
  }

  // Full frozen rating breakdown: rating_points = participation + knockout +
  // boss_bounty + mystery_bounty + itm (results_rating_points_breakdown_check).
  async function result(
    playerId: string,
    tournamentId: string,
    place: number,
    opts: {
      participation?: number;
      knockoutPoints?: number;
      bossPoints?: number;
      mystery?: number;
      itm?: number;
      reentries?: number;
      addons?: number;
      knockouts?: number;
      bossKnockouts?: number;
      freeReentries?: number;
      clubDiscount?: number;
      arrived?: boolean | null;
    } = {}
  ) {
    const participation = opts.participation ?? 2;
    const knockoutPoints = opts.knockoutPoints ?? 0;
    const bossPoints = opts.bossPoints ?? 0;
    const mystery = opts.mystery ?? 0;
    const itm = opts.itm ?? 0;
    const rating = participation + knockoutPoints + bossPoints + mystery + itm;
    await client`
      INSERT INTO results (tournament_id, player_id, place, reentries, knockouts, addons, boss_knockouts, free_reentries,
                           mystery_bounty_points, rating_points, arrived, participation_points, knockout_points,
                           boss_bounty_points, itm_points, club_discount_percent)
      VALUES (${tournamentId}::uuid, ${playerId}::uuid, ${place}, ${opts.reentries ?? 1}, ${opts.knockouts ?? 0},
              ${opts.addons ?? 0}, ${opts.bossKnockouts ?? 0}, ${opts.freeReentries ?? 0}, ${mystery}, ${rating},
              ${opts.arrived === undefined ? true : opts.arrived}, ${participation}, ${knockoutPoints}, ${bossPoints},
              ${itm}, ${opts.clubDiscount ?? 0})
    `;
  }

  async function attendance(playerId: string, tournamentId: string, arrived: boolean, arrivedAt: string | null, updatedAt = "2026-09-13T16:00:00Z") {
    await client`
      INSERT INTO tournament_attendance (tournament_id, player_id, arrived, arrived_at, updated_at)
      VALUES (${tournamentId}::uuid, ${playerId}::uuid, ${arrived}, ${arrivedAt}::timestamptz, ${updatedAt}::timestamptz)
    `;
  }

  async function rebuyState(playerId: string, tournamentId: string, rebuys: number, addons: number, updatedAt = "2026-09-13T18:00:00Z") {
    await client`
      INSERT INTO tournament_rebuy_state (tournament_id, player_id, rebuys, addons, updated_at)
      VALUES (${tournamentId}::uuid, ${playerId}::uuid, ${rebuys}, ${addons}, ${updatedAt}::timestamptz)
    `;
  }

  async function elimination(playerId: string, tournamentId: string, eliminated: boolean, eliminatedAt: string | null, updatedAt: string) {
    await client`
      INSERT INTO tournament_player_eliminations (tournament_id, player_id, eliminated, eliminated_at, updated_at)
      VALUES (${tournamentId}::uuid, ${playerId}::uuid, ${eliminated}, ${eliminatedAt}::timestamptz, ${updatedAt}::timestamptz)
    `;
  }

  async function liveEntry(
    playerId: string,
    tournamentId: string,
    registrationId: string,
    values: { arrived?: boolean; rebuys?: number; addons?: number; knockouts?: number; boss?: number; place?: number | null; sheetRow?: number | null; updatedAt?: string }
  ): Promise<string> {
    const [row] = await client`
      INSERT INTO tournament_live_entries (tournament_id, player_id, registration_id, arrived, rebuys, addons, knockouts,
                                           boss_knockouts, place, sheet_row_number, updated_at)
      VALUES (${tournamentId}::uuid, ${playerId}::uuid, ${registrationId}::uuid, ${values.arrived ?? false},
              ${values.rebuys ?? 0}, ${values.addons ?? 0}, ${values.knockouts ?? 0}, ${values.boss ?? 0},
              ${values.place ?? null}, ${values.sheetRow ?? null}, ${values.updatedAt ?? "2026-09-13T20:00:00Z"}::timestamptz)
      RETURNING id::text AS id
    `;
    return row.id as string;
  }

  async function rows(table: string, tournamentId: string) {
    return client.unsafe(`SELECT * FROM ${table} WHERE tournament_id = $1 ORDER BY player_id`, [tournamentId]);
  }

  // Everything a merge could touch for these players/tournaments -- used to
  // prove "no mutation" byte-for-byte.
  async function snapshot(playerIds: string[], tournamentIds: string[]) {
    const out: Record<string, unknown> = {};
    for (const table of TABLES) {
      out[table] = await client.unsafe(
        `SELECT * FROM ${table} WHERE tournament_id = ANY($1::uuid[]) ORDER BY player_id, tournament_id`,
        [tournamentIds]
      );
    }
    out.players = await client.unsafe(`SELECT * FROM players WHERE id = ANY($1::uuid[]) ORDER BY id`, [playerIds]);
    return JSON.parse(JSON.stringify(out));
  }

  async function playerRow(playerId: string) {
    const [row] = await client`SELECT * FROM players WHERE id = ${playerId}::uuid`;
    return row;
  }

  function adminMerge(resultResolutions?: Record<string, "target" | "source">, targetId = TARGET, sourceId = SOURCE) {
    return merge.executeAdminMerge({
      targetPlayerId: targetId,
      sourcePlayerId: sourceId,
      confirmation: merge.ADMIN_MERGE_CONFIRMATION,
      resultResolutions,
    });
  }

  async function assertNoDuplicateParticipation(tournamentId: string, playerId: string) {
    for (const table of TABLES) {
      const [{ n }] = await client.unsafe(
        `SELECT count(*)::int AS n FROM ${table} WHERE tournament_id = $1 AND player_id = $2`,
        [tournamentId, playerId]
      );
      expect(n, table).toBeLessThanOrEqual(1);
    }
  }

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(TEST_DATABASE_URL!);
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    process.env.SESSION_SECRET = "merge-v2-integration-session-secret";
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "integration-test-dummy";
    client = postgres(TEST_DATABASE_URL!, { max: 5, onnotice: () => undefined });
    merge = await import("@/lib/player-merge");
    await resetRows();
  });

  afterEach(async () => {
    await resetRows();
  });

  afterAll(async () => {
    if (!client) return;
    await client.end();
  });

  // -------------------------------------------------------------------------
  // The real production case
  // -------------------------------------------------------------------------

  describe("TOXIN / TO_OXIN regression (CRAZY PINEAPPLE 13.09.2026, exact production shape)", () => {
    const TOXIN_ARRIVED_AT = "2026-09-13T16:12:00.000Z";
    const TO_OXIN_ARRIVED_AT = "2026-09-13T15:58:00.000Z"; // earlier, on the arrived=false row
    const TOXIN_ELIMINATED_AT = "2026-09-13T20:41:00.000Z";

    async function seedProductionShape() {
      await createTournament(CRAZY_PINEAPPLE, "CRAZY PINEAPPLE", "2026-09-13T16:00:00Z");
      await createPlayer(TOXIN, { name: "TOXIN", telegramId: TG_TARGET });
      await createPlayer(TO_OXIN, { name: "TO_OXIN", email: "to_oxin@merge-v2.test" });

      // TOXIN: attended registration, frozen result, arrival, rebuys, elimination; no live entry.
      await registration(TOXIN, CRAZY_PINEAPPLE, { status: "attended" });
      await result(TOXIN, CRAZY_PINEAPPLE, 7, {
        participation: 2,
        knockoutPoints: 0,
        bossPoints: 0,
        mystery: 0,
        itm: 0,
        reentries: 2,
        addons: 0,
        knockouts: 0,
        bossKnockouts: 0,
        freeReentries: 0,
        clubDiscount: 0,
        arrived: true,
      });
      await attendance(TOXIN, CRAZY_PINEAPPLE, true, TOXIN_ARRIVED_AT, "2026-09-13T16:12:00Z");
      await rebuyState(TOXIN, CRAZY_PINEAPPLE, 2, 0);
      await elimination(TOXIN, CRAZY_PINEAPPLE, true, TOXIN_ELIMINATED_AT, TOXIN_ELIMINATED_AT);

      // TO_OXIN: no registration, no result, no elimination, no live entry;
      // attendance arrived=false but arrived_at set; rebuys=1.
      await attendance(TO_OXIN, CRAZY_PINEAPPLE, false, TO_OXIN_ARRIVED_AT, "2026-09-13T16:30:00Z");
      await rebuyState(TO_OXIN, CRAZY_PINEAPPLE, 1, 0);
    }

    it("#1/#13 preview: no blocker, no result conflict -- one informational reconciliation entry", async () => {
      await seedProductionShape();

      const preview = await merge.previewAdminMerge({ targetPlayerId: TOXIN, sourcePlayerId: TO_OXIN });

      expect(preview.blockers).toEqual([]);
      expect(preview.eligible).toBe(true);
      expect(preview.result_conflicts).toEqual([]);
      expect(preview.requires_result_resolution).toBe(false);
      expect(preview.tournament_reconciliation).toEqual([
        {
          tournament: { id: CRAZY_PINEAPPLE, title: "CRAZY PINEAPPLE", start_at: "2026-09-13T16:00:00.000Z" },
          collapsed: ["отметка прихода", "ребаи/аддоны"],
          result_conflict: false,
        },
      ]);
    });

    it("#1 execute: one canonical history under TOXIN; attendance OR + earliest arrival; rebuys max (2, not 3); frozen result untouched", async () => {
      await seedProductionShape();
      const [resultBefore] = await rows("results", CRAZY_PINEAPPLE);
      const [registrationBefore] = await rows("registrations", CRAZY_PINEAPPLE);
      const [eliminationBefore] = await rows("tournament_player_eliminations", CRAZY_PINEAPPLE);

      const outcome = await adminMerge(undefined, TOXIN, TO_OXIN);
      expect(outcome).toMatchObject({ merged: true, target_player_id: TOXIN, reconciled_tournament_count: 1, kept_results: [] });

      const registrationRows = await rows("registrations", CRAZY_PINEAPPLE);
      expect(registrationRows).toHaveLength(1);
      expect(registrationRows[0]).toEqual(registrationBefore); // TOXIN's canonical row, unchanged
      expect(registrationRows[0].status).toBe("attended");

      const resultRows = await rows("results", CRAZY_PINEAPPLE);
      expect(resultRows).toHaveLength(1);
      expect(resultRows[0]).toEqual(resultBefore); // every frozen field identical
      expect(resultRows[0]).toMatchObject({
        player_id: TOXIN,
        place: 7,
        rating_points: 2,
        reentries: 2,
        addons: 0,
        knockouts: 0,
        boss_knockouts: 0,
        mystery_bounty_points: 0,
        participation_points: 2,
        knockout_points: 0,
        boss_bounty_points: 0,
        itm_points: 0,
        arrived: true,
        free_reentries: 0,
        club_discount_percent: 0,
      });

      const attendanceRows = await rows("tournament_attendance", CRAZY_PINEAPPLE);
      expect(attendanceRows).toHaveLength(1);
      expect(attendanceRows[0].player_id).toBe(TOXIN);
      expect(attendanceRows[0].arrived).toBe(true);
      expect(attendanceRows[0].arrived_at.toISOString()).toBe(TO_OXIN_ARRIVED_AT); // 15:58 < 16:12

      const rebuyRows = await rows("tournament_rebuy_state", CRAZY_PINEAPPLE);
      expect(rebuyRows).toHaveLength(1);
      expect(rebuyRows[0]).toMatchObject({ player_id: TOXIN, rebuys: 2, addons: 0 });

      const eliminationRows = await rows("tournament_player_eliminations", CRAZY_PINEAPPLE);
      expect(eliminationRows).toHaveLength(1);
      expect(eliminationRows[0]).toEqual(eliminationBefore);
      expect(eliminationRows[0].eliminated).toBe(true);

      expect(await rows("tournament_live_entries", CRAZY_PINEAPPLE)).toHaveLength(0);

      expect((await playerRow(TO_OXIN)).merged_into_player_id).toBe(TOXIN);
      for (const table of TABLES) {
        const [{ n }] = await client.unsafe(
          `SELECT count(*)::int AS n FROM ${table} WHERE tournament_id = $1 AND player_id = $2`,
          [CRAZY_PINEAPPLE, TO_OXIN]
        );
        expect(n, table).toBe(0);
      }
      await assertNoDuplicateParticipation(CRAZY_PINEAPPLE, TOXIN);
    });
  });

  // -------------------------------------------------------------------------
  // Same-table collisions
  // -------------------------------------------------------------------------

  describe("same-table collisions (admin execute)", () => {
    beforeEach(async () => {
      await pair();
      await createTournament(T_A, "Collision Cup", "2026-09-13T16:00:00Z");
    });

    it("#1 cross-table only (target registration, source attendance + result) -> merge succeeds, everything under target", async () => {
      await registration(TARGET, T_A, { status: "registered" });
      await attendance(SOURCE, T_A, true, "2026-09-13T16:05:00Z");
      await result(SOURCE, T_A, 4);

      const outcome = await adminMerge();
      expect(outcome.merged).toBe(true);
      for (const table of ["registrations", "results", "tournament_attendance"]) {
        const tableRows = await rows(table, T_A);
        expect(tableRows.map((row) => row.player_id), table).toEqual([TARGET]);
      }
    });

    it("#2 registration on both -> exactly one remains (higher lifecycle state, earlier created_at, claim kept)", async () => {
      const targetReg = await registration(TARGET, T_A, { status: "waitlist", createdAt: "2026-09-01T09:00:00Z", claimedAt: "2026-09-02T09:00:00Z" });
      const sourceReg = await registration(SOURCE, T_A, { status: "registered", createdAt: "2026-09-03T09:00:00Z" });

      expect((await adminMerge()).merged).toBe(true);

      const regs = await rows("registrations", T_A);
      expect(regs).toHaveLength(1);
      expect(regs[0].id).toBe(sourceReg); // the winning (registered) row survives
      expect(regs[0].id).not.toBe(targetReg);
      expect(regs[0]).toMatchObject({ player_id: TARGET, status: "registered", no_show_at: null });
      expect(regs[0].created_at.toISOString()).toBe("2026-09-01T09:00:00.000Z");
      expect(regs[0].waitlist_promotion_notification_claimed_at.toISOString()).toBe("2026-09-02T09:00:00.000Z");
    });

    it("#3/#4 attendance on both -> arrived survives from either side; arrived_at is the first arrival", async () => {
      await attendance(TARGET, T_A, false, null, "2026-09-13T19:00:00Z");
      await attendance(SOURCE, T_A, true, "2026-09-13T16:07:00Z", "2026-09-13T16:07:00Z");

      expect((await adminMerge()).merged).toBe(true);

      const att = await rows("tournament_attendance", T_A);
      expect(att).toHaveLength(1);
      expect(att[0].player_id).toBe(TARGET);
      expect(att[0].arrived).toBe(true);
      expect(att[0].arrived_at.toISOString()).toBe("2026-09-13T16:07:00.000Z");
      expect(att[0].updated_at.toISOString()).toBe("2026-09-13T19:00:00.000Z");
    });

    it("#4 both arrived -> the EARLIER arrived_at wins regardless of direction", async () => {
      await attendance(TARGET, T_A, true, "2026-09-13T16:30:00Z");
      await attendance(SOURCE, T_A, true, "2026-09-13T16:01:00Z");

      expect((await adminMerge()).merged).toBe(true);

      const [att] = await rows("tournament_attendance", T_A);
      expect(att.arrived_at.toISOString()).toBe("2026-09-13T16:01:00.000Z");
    });

    it("#5 duplicate no-show on one account + real attendance on the other -> no false no-show remains", async () => {
      await registration(TARGET, T_A, { status: "waitlist", noShowAt: "2026-09-13T17:00:00Z" });
      await registration(SOURCE, T_A, { status: "registered" });
      await attendance(SOURCE, T_A, true, "2026-09-13T16:20:00Z");

      expect((await adminMerge()).merged).toBe(true);

      const regs = await rows("registrations", T_A);
      expect(regs).toHaveLength(1);
      expect(regs[0]).toMatchObject({ player_id: TARGET, status: "registered", no_show_at: null });
      const [{ n }] = await client`SELECT count(*)::int AS n FROM registrations WHERE player_id = ${TARGET}::uuid AND no_show_at IS NOT NULL`;
      expect(n).toBe(0);
    });

    it("#5 (control) a real no-show with no arrival anywhere is preserved, not erased", async () => {
      await registration(TARGET, T_A, { status: "waitlist", noShowAt: "2026-09-13T17:00:00Z" });
      await registration(SOURCE, T_A, { status: "cancelled" });

      expect((await adminMerge()).merged).toBe(true);

      const regs = await rows("registrations", T_A);
      expect(regs).toHaveLength(1);
      expect(regs[0].status).toBe("waitlist");
      expect(regs[0].no_show_at.toISOString()).toBe("2026-09-13T17:00:00.000Z");
    });

    it("#6/#7 rebuy-state collision -> rebuys and addons are max, NOT sum", async () => {
      await rebuyState(TARGET, T_A, 3, 0, "2026-09-13T18:00:00Z");
      await rebuyState(SOURCE, T_A, 2, 1, "2026-09-13T19:00:00Z");

      expect((await adminMerge()).merged).toBe(true);

      const rebuy = await rows("tournament_rebuy_state", T_A);
      expect(rebuy).toHaveLength(1);
      expect(rebuy[0]).toMatchObject({ player_id: TARGET, rebuys: 3, addons: 1 });
      expect(rebuy[0].updated_at.toISOString()).toBe("2026-09-13T19:00:00.000Z");
    });

    it("#8 elimination collision -> the later updated_at state wins as a whole (deterministic)", async () => {
      await elimination(TARGET, T_A, true, "2026-09-13T19:00:00Z", "2026-09-13T19:00:00Z");
      await elimination(SOURCE, T_A, false, null, "2026-09-13T19:45:00Z"); // returned to play later

      expect((await adminMerge()).merged).toBe(true);

      const elim = await rows("tournament_player_eliminations", T_A);
      expect(elim).toHaveLength(1);
      expect(elim[0]).toMatchObject({ player_id: TARGET, eliminated: false, eliminated_at: null });
      expect(elim[0].updated_at.toISOString()).toBe("2026-09-13T19:45:00.000Z");
    });

    it("#8 elimination collision, other direction -> target's later elimination (with its own eliminated_at) wins", async () => {
      await elimination(TARGET, T_A, true, "2026-09-13T21:00:00Z", "2026-09-13T21:00:00Z");
      await elimination(SOURCE, T_A, false, null, "2026-09-13T19:45:00Z");

      expect((await adminMerge()).merged).toBe(true);

      const [elim] = await rows("tournament_player_eliminations", T_A);
      expect(elim.eliminated).toBe(true);
      expect(elim.eliminated_at.toISOString()).toBe("2026-09-13T21:00:00.000Z");
    });

    it("#9 live-entry collision -> exactly one live entry, pointing at the one surviving registration; counters max, not sum", async () => {
      const targetReg = await registration(TARGET, T_A, { status: "registered" });
      const sourceReg = await registration(SOURCE, T_A, { status: "attended" });
      await liveEntry(TARGET, T_A, targetReg, { arrived: false, rebuys: 2, addons: 0, knockouts: 1, boss: 0, place: null, sheetRow: 9 });
      const sourceLive = await liveEntry(SOURCE, T_A, sourceReg, { arrived: true, rebuys: 1, addons: 1, knockouts: 3, boss: 1, place: 5, sheetRow: 14 });

      expect((await adminMerge()).merged).toBe(true);

      const regs = await rows("registrations", T_A);
      expect(regs).toHaveLength(1);
      expect(regs[0].id).toBe(sourceReg);
      const live = await rows("tournament_live_entries", T_A);
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({
        id: sourceLive,
        player_id: TARGET,
        registration_id: sourceReg,
        arrived: true,
        rebuys: 2,
        addons: 1,
        knockouts: 3,
        boss_knockouts: 1,
        place: 5,
        sheet_row_number: 14,
      });
      // FK really valid.
      const [{ ok }] = await client`
        SELECT count(*)::int AS ok FROM tournament_live_entries le
        JOIN registrations r ON r.id = le.registration_id AND r.player_id = le.player_id
        WHERE le.tournament_id = ${T_A}::uuid`;
      expect(ok).toBe(1);
    });

    it("#9 single source live entry on the DUPLICATE registration is rewired to the canonical one (not cascade-deleted)", async () => {
      const targetReg = await registration(TARGET, T_A, { status: "registered" });
      const sourceReg = await registration(SOURCE, T_A, { status: "waitlist" });
      const sourceLive = await liveEntry(SOURCE, T_A, sourceReg, { arrived: true, rebuys: 1 });

      expect((await adminMerge()).merged).toBe(true);

      const regs = await rows("registrations", T_A);
      expect(regs.map((row) => row.id)).toEqual([targetReg]);
      const live = await rows("tournament_live_entries", T_A);
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({ id: sourceLive, player_id: TARGET, registration_id: targetReg, arrived: true, rebuys: 1 });
    });

    it("#9 two different live places (no result conflict) -> blocker, nothing mutated", async () => {
      const targetReg = await registration(TARGET, T_A);
      const sourceReg = await registration(SOURCE, T_A);
      await liveEntry(TARGET, T_A, targetReg, { place: 2 });
      await liveEntry(SOURCE, T_A, sourceReg, { place: 6 });
      const before = await snapshot([TARGET, SOURCE], [T_A]);

      const preview = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });
      expect(preview.blockers.map((b) => b.code)).toEqual(["live_entry_place_conflict"]);
      expect(preview.blockers[0].message).toContain("Collision Cup — 13.09.2026");

      const outcome = await adminMerge();
      expect(outcome.merged).toBe(false);
      expect(await snapshot([TARGET, SOURCE], [T_A])).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  describe("results", () => {
    beforeEach(async () => {
      await pair();
      await createTournament(T_A, "Result Cup", "2026-09-13T16:00:00Z");
      await createTournament(T_B, "Other Cup", "2026-09-20T16:00:00Z");
    });

    it("#10/#11/#12 source-only result moves to target with every frozen value unchanged", async () => {
      await registration(TARGET, T_A);
      await result(SOURCE, T_A, 3, { participation: 2, knockoutPoints: 4, bossPoints: 3, mystery: 5, itm: 10, reentries: 3, addons: 1, knockouts: 2, bossKnockouts: 1, freeReentries: 1, clubDiscount: 15 });
      const [before] = await rows("results", T_A);

      expect((await adminMerge()).merged).toBe(true);

      const after = await rows("results", T_A);
      expect(after).toHaveLength(1);
      const { player_id: movedTo, ...frozenAfter } = after[0];
      const { player_id: movedFrom, ...frozenBefore } = before;
      expect(movedFrom).toBe(SOURCE);
      expect(movedTo).toBe(TARGET);
      expect(frozenAfter).toEqual(frozenBefore); // id, rating_points, breakdown, created_at...
      expect(after[0].rating_points).toBe(24);
      expect(after[0]).toMatchObject({ participation_points: 2, knockout_points: 4, boss_bounty_points: 3, mystery_bounty_points: 5, itm_points: 10 });
    });

    async function seedDoubleResult() {
      await registration(TARGET, T_A, { status: "attended" });
      await registration(SOURCE, T_A, { status: "attended" });
      await result(TARGET, T_A, 7, { participation: 2, reentries: 2 });
      await result(SOURCE, T_A, 3, { participation: 2, knockoutPoints: 3, itm: 10, reentries: 1, addons: 1, knockouts: 3 });
      // Unrelated other player in the same tournament keeps its place.
      await createPlayer(id(9), { name: "Bystander" });
      await result(id(9), T_A, 1, { participation: 2, itm: 30 });
    }

    it("#13 two results in one tournament -> preview returns a resolution-required conflict with both cards, NOT a generic blocker", async () => {
      await seedDoubleResult();

      const preview = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });

      expect(preview.blockers).toEqual([]);
      expect(preview.eligible).toBe(true);
      expect(preview.requires_result_resolution).toBe(true);
      expect(preview.result_conflicts).toHaveLength(1);
      expect(preview.result_conflicts[0]).toMatchObject({
        tournament: { id: T_A, title: "Result Cup", start_at: "2026-09-13T16:00:00.000Z" },
        target: { player_id: TARGET, nickname: "TOXIN", place: 7, rating_points: 2, entries: 2, addons: 0, knockouts: 0 },
        source: { player_id: SOURCE, nickname: "TO_OXIN", place: 3, rating_points: 15, entries: 1, addons: 1, knockouts: 3 },
      });
      expect(preview.tournament_reconciliation[0]).toMatchObject({ result_conflict: true, collapsed: ["регистрация"] });
    });

    it("#14 execute without a resolution -> result_resolution_required, NOTHING mutated", async () => {
      await seedDoubleResult();
      const before = await snapshot([TARGET, SOURCE, id(9)], [T_A]);

      const outcome = await adminMerge();

      expect(outcome.merged).toBe(false);
      if (!outcome.merged) {
        expect(outcome.blockers.map((b) => b.code)).toEqual(["result_resolution_required"]);
        expect(outcome.blockers[0].tournaments?.map((t) => t.id)).toEqual([T_A]);
      }
      expect(await snapshot([TARGET, SOURCE, id(9)], [T_A])).toEqual(before);
    });

    it("#15/#18 execute keeping TARGET's result -> target row survives unchanged, source duplicate deleted, places stay unique", async () => {
      await seedDoubleResult();
      const before = await rows("results", T_A);
      const targetBefore = before.find((row) => row.player_id === TARGET);

      const outcome = await adminMerge({ [T_A]: "target" });
      expect(outcome).toMatchObject({ merged: true, kept_results: [{ tournament_id: T_A, kept: "target" }] });

      const after = await rows("results", T_A);
      const mine = after.filter((row) => row.player_id === TARGET);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toEqual(targetBefore);
      expect(after.filter((row) => row.player_id === SOURCE)).toHaveLength(0);
      expect(after.map((row) => row.place).sort((a, b) => a - b)).toEqual([1, 7]);
      const [{ dup }] = await client`SELECT count(*)::int AS dup FROM (SELECT place FROM results WHERE tournament_id = ${T_A}::uuid GROUP BY place HAVING count(*) > 1) x`;
      expect(dup).toBe(0);
      await assertNoDuplicateParticipation(T_A, TARGET);
    });

    it("#16/#11/#12/#18 execute keeping SOURCE's result -> source's frozen row survives under target's id, value-for-value", async () => {
      await seedDoubleResult();
      const sourceBefore = (await rows("results", T_A)).find((row) => row.player_id === SOURCE);

      const outcome = await adminMerge({ [T_A]: "source" });
      expect(outcome).toMatchObject({ merged: true, kept_results: [{ tournament_id: T_A, kept: "source" }] });

      const after = await rows("results", T_A);
      const mine = after.filter((row) => row.player_id === TARGET);
      expect(mine).toHaveLength(1);
      const { player_id: _p1, ...keptFrozen } = mine[0];
      const { player_id: _p2, ...sourceFrozen } = sourceBefore!;
      void _p1;
      void _p2;
      expect(keptFrozen).toEqual(sourceFrozen); // same id, place 3, rating_points 15, breakdown, created_at
      expect(mine[0]).toMatchObject({ place: 3, rating_points: 15, participation_points: 2, knockout_points: 3, itm_points: 10 });
      expect(after.map((row) => row.place).sort((a, b) => a - b)).toEqual([1, 3]);
      // Bystander untouched.
      expect(after.find((row) => row.player_id === id(9))).toMatchObject({ place: 1, rating_points: 32 });
    });

    it("#17 stale/forged resolution (tournament that is not a conflict of this pair) -> rejected, NOTHING mutated", async () => {
      await seedDoubleResult();
      const before = await snapshot([TARGET, SOURCE, id(9)], [T_A, T_B]);

      const forged = await adminMerge({ [T_A]: "target", [T_B]: "source" });
      expect(forged.merged).toBe(false);
      if (!forged.merged) expect(forged.blockers.map((b) => b.code)).toEqual(["result_resolution_stale"]);

      const bogusValue = await adminMerge({ [T_A]: "both" as never });
      expect(bogusValue.merged).toBe(false);

      expect(await snapshot([TARGET, SOURCE, id(9)], [T_A, T_B])).toEqual(before);
    });

    it("#17 state changed between preview and execute (conflict disappeared) -> the old choice is rejected as stale", async () => {
      await seedDoubleResult();
      const preview = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });
      expect(preview.result_conflicts).toHaveLength(1);

      await client`DELETE FROM results WHERE tournament_id = ${T_A}::uuid AND player_id = ${SOURCE}::uuid`;

      const outcome = await adminMerge({ [T_A]: "source" });
      expect(outcome.merged).toBe(false);
      if (!outcome.merged) expect(outcome.blockers.map((b) => b.code)).toEqual(["result_resolution_stale"]);
      expect((await playerRow(SOURCE)).merged_into_player_id).toBeNull();
    });

    it("double result + different live places: the admin's result choice also settles the live place", async () => {
      await createTournament(T_C, "Live Result Cup", "2026-09-27T16:00:00Z");
      const targetReg = await registration(TARGET, T_C, { status: "attended" });
      const sourceReg = await registration(SOURCE, T_C, { status: "attended" });
      await liveEntry(TARGET, T_C, targetReg, { place: 7, arrived: true });
      await liveEntry(SOURCE, T_C, sourceReg, { place: 3, arrived: true });
      await result(TARGET, T_C, 7);
      await result(SOURCE, T_C, 3);

      const preview = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });
      expect(preview.blockers).toEqual([]);
      expect(preview.result_conflicts).toHaveLength(1);

      expect((await adminMerge({ [T_C]: "source" })).merged).toBe(true);
      const live = await rows("tournament_live_entries", T_C);
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({ player_id: TARGET, place: 3 });
      const res = await rows("results", T_C);
      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({ player_id: TARGET, place: 3 });
    });
  });

  // -------------------------------------------------------------------------
  // Unchanged behavior
  // -------------------------------------------------------------------------

  it("#19 different-tournament history still moves exactly as before (whole rows, no reconciliation)", async () => {
    await pair();
    await createTournament(T_A, "Mine", "2026-09-01T16:00:00Z");
    await createTournament(T_B, "Theirs", "2026-09-08T16:00:00Z");
    const targetReg = await registration(TARGET, T_A);
    const sourceReg = await registration(SOURCE, T_B, { status: "waitlist", noShowAt: "2026-09-08T17:00:00Z" });
    await result(TARGET, T_A, 2);
    await result(SOURCE, T_B, 5);
    await attendance(SOURCE, T_B, false, null);
    await rebuyState(SOURCE, T_B, 1, 0);
    const sourceBefore = await snapshot([SOURCE], [T_B]);

    const outcome = await adminMerge();
    expect(outcome).toMatchObject({ merged: true, reconciled_tournament_count: 0, transferred_tournament_count: 1 });

    expect((await rows("registrations", T_A))[0].id).toBe(targetReg);
    const movedRegs = await rows("registrations", T_B);
    expect(movedRegs).toHaveLength(1);
    expect(movedRegs[0]).toMatchObject({ id: sourceReg, player_id: TARGET, status: "waitlist" });
    expect(movedRegs[0].no_show_at.toISOString()).toBe("2026-09-08T17:00:00.000Z");
    const movedResult = (await rows("results", T_B))[0];
    const { player_id: _p, ...frozen } = movedResult;
    void _p;
    const { player_id: _q, ...frozenBefore } = (sourceBefore.results as Record<string, unknown>[])[0];
    void _q;
    expect(JSON.parse(JSON.stringify(frozen))).toEqual(frozenBefore);
  });

  describe("self-service (shared engine, no result chooser)", () => {
    async function intentFor(email: string) {
      const [intent] = await client`
        INSERT INTO player_merge_intents (target_player_id, source_player_id, email, status, expires_at)
        VALUES (${TARGET}::uuid, ${SOURCE}::uuid, ${email}, 'pending', now() + interval '15 minutes')
        RETURNING id`;
      return intent.id as string;
    }

    it("#20 auto-resolvable overlap (both registered + both attendance) -> self-service merge succeeds with one canonical history", async () => {
      await createPlayer(TARGET, { name: "TOXIN", telegramId: TG_TARGET });
      await createPlayer(SOURCE, { name: "TO_OXIN", email: "ss.source@merge-v2.test" });
      await createTournament(T_A, "Self Cup", "2026-09-13T16:00:00Z");
      await registration(TARGET, T_A, { status: "waitlist", noShowAt: "2026-09-13T17:00:00Z" });
      await registration(SOURCE, T_A, { status: "registered" });
      await attendance(TARGET, T_A, false, null);
      await attendance(SOURCE, T_A, true, "2026-09-13T16:02:00Z");
      await rebuyState(TARGET, T_A, 1, 0);
      await rebuyState(SOURCE, T_A, 2, 0);

      const intent = await merge.createMergeIntent({
        targetPlayerId: TARGET,
        sourcePlayerId: SOURCE,
        email: "ss.source@merge-v2.test",
        otpVerificationId: null,
      });
      expect(intent.status).toBe("pending");

      expect(await merge.executeMerge({ intentId: intent.id, sessionPlayerId: TARGET })).toEqual({ merged: true });

      const regs = await rows("registrations", T_A);
      expect(regs).toHaveLength(1);
      expect(regs[0]).toMatchObject({ player_id: TARGET, status: "registered", no_show_at: null });
      const [att] = await rows("tournament_attendance", T_A);
      expect(att).toMatchObject({ player_id: TARGET, arrived: true });
      expect((await rows("tournament_rebuy_state", T_A))[0]).toMatchObject({ rebuys: 2 });
      await assertNoDuplicateParticipation(T_A, TARGET);
      expect((await playerRow(SOURCE)).merged_into_player_id).toBe(TARGET);
    });

    it("#21 double result -> self-service intent goes to the admin conflict queue; a forced confirm still merges nothing", async () => {
      await createPlayer(TARGET, { name: "TOXIN", telegramId: TG_TARGET });
      await createPlayer(SOURCE, { name: "TO_OXIN", email: "ss2.source@merge-v2.test" });
      await createTournament(T_A, "Self Result Cup", "2026-09-13T16:00:00Z");
      await result(TARGET, T_A, 7);
      await result(SOURCE, T_A, 3);
      const before = await snapshot([TARGET, SOURCE], [T_A]);

      const intent = await merge.createMergeIntent({
        targetPlayerId: TARGET,
        sourcePlayerId: SOURCE,
        email: "ss2.source@merge-v2.test",
        otpVerificationId: null,
      });
      expect(intent.status).toBe("conflict");
      expect(intent.conflict_reason).toBe(merge.RESULT_CONFLICT_SELF_SERVICE_REASON);

      const { playerMergeIntentRepository } = await import("@/lib/repositories");
      expect((await playerMergeIntentRepository.listConflicts()).some((c) => c.id === intent.id)).toBe(true);

      await client`UPDATE player_merge_intents SET status = 'pending' WHERE id = ${intent.id}::uuid`;
      expect(await merge.executeMerge({ intentId: intent.id, sessionPlayerId: TARGET })).toEqual({
        merged: false,
        conflict: true,
        reason: merge.RESULT_CONFLICT_SELF_SERVICE_REASON,
      });
      expect(await snapshot([TARGET, SOURCE], [T_A])).toEqual(before);

      // ...and the Super Admin can resolve the very same pair in the Merge Center.
      const adminOutcome = await adminMerge({ [T_A]: "source" });
      expect(adminOutcome.merged).toBe(true);
      const [{ status }] = await client`SELECT status FROM player_merge_intents WHERE id = ${intent.id}::uuid`;
      expect(status).toBe("completed");
    });

    it("#23 (self-service) a late failure after reconciliation (email already owned by a third party) rolls the whole merge back", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET });
      await createPlayer(SOURCE, { email: "ss3.source@merge-v2.test" });
      await createPlayer(id(3), { email: "taken@merge-v2.test" });
      await createTournament(T_A, "Rollback Self Cup", "2026-09-13T16:00:00Z");
      await registration(TARGET, T_A);
      await registration(SOURCE, T_A, { status: "attended" });
      await rebuyState(TARGET, T_A, 1, 0);
      await rebuyState(SOURCE, T_A, 3, 0);
      const before = await snapshot([TARGET, SOURCE], [T_A]);
      const intentId = await intentFor("taken@merge-v2.test");

      // Collision reconciliation + history move run, then the target email
      // write trips players_email_unique_idx -> the whole transaction aborts.
      await expect(merge.executeMerge({ intentId, sessionPlayerId: TARGET })).rejects.toThrow();
      expect(await snapshot([TARGET, SOURCE], [T_A])).toEqual(before);
    });
  });

  it("#22 identity/team/dealer/role/blocked guards are unchanged when the pair ALSO has overlapping history", async () => {
    await createPlayer(TARGET, { telegramId: TG_TARGET, email: "x.target@merge-v2.test" });
    await createPlayer(SOURCE, { telegramId: TG_SOURCE, email: "x.source@merge-v2.test", role: "admin", blocked: true });
    await createTournament(T_A, "Guard Cup", "2026-09-13T16:00:00Z");
    await registration(TARGET, T_A);
    await registration(SOURCE, T_A);
    await client`INSERT INTO teams (id, name, captain_player_id) VALUES (${TEAM_1}::uuid, 'V2 Team One', ${TARGET}::uuid), (${TEAM_2}::uuid, 'V2 Team Two', ${SOURCE}::uuid)`;
    await client`INSERT INTO team_memberships (team_id, player_id, joined_at) VALUES (${TEAM_1}::uuid, ${TARGET}::uuid, now() - interval '5 days'), (${TEAM_2}::uuid, ${SOURCE}::uuid, now() - interval '3 days')`;
    await client`INSERT INTO dealer_profiles (player_id, is_active, hourly_rate_rub) VALUES (${TARGET}::uuid, true, 500), (${SOURCE}::uuid, true, 600)`;
    await client`INSERT INTO dealer_shifts (dealer_player_id, started_at, hourly_rate_rub) VALUES (${TARGET}::uuid, now(), 500), (${SOURCE}::uuid, now(), 600)`;
    const before = await snapshot([TARGET, SOURCE], [T_A]);

    const outcome = await adminMerge();

    expect(outcome.merged).toBe(false);
    if (!outcome.merged) {
      expect(outcome.blockers.map((b) => b.code).sort()).toEqual(
        [
          "dealer_open_shift_conflict",
          "email_conflict",
          "role_higher_on_source",
          "source_blocked",
          "team_history_conflict",
          "telegram_conflict",
        ].sort()
      );
    }
    expect(await snapshot([TARGET, SOURCE], [T_A])).toEqual(before);
  });

  it("#23 a failure AFTER the collision plan was applied rolls everything back -- both accounts untouched", async () => {
    await pair();
    await createTournament(T_A, "Rollback Cup", "2026-09-13T16:00:00Z");
    const targetReg = await registration(TARGET, T_A, { status: "registered" });
    const sourceReg = await registration(SOURCE, T_A, { status: "attended" });
    await liveEntry(TARGET, T_A, targetReg, { rebuys: 1 });
    await liveEntry(SOURCE, T_A, sourceReg, { rebuys: 2, place: 4 });
    await attendance(TARGET, T_A, false, null);
    await attendance(SOURCE, T_A, true, "2026-09-13T16:00:00Z");
    await rebuyState(TARGET, T_A, 1, 0);
    await rebuyState(SOURCE, T_A, 2, 1);
    await elimination(TARGET, T_A, true, "2026-09-13T19:00:00Z", "2026-09-13T19:00:00Z");
    await elimination(SOURCE, T_A, false, null, "2026-09-13T18:00:00Z");
    await result(TARGET, T_A, 4);
    await result(SOURCE, T_A, 9);
    const before = await snapshot([TARGET, SOURCE], [T_A]);

    // Fails the very last write of the merge (source tombstone), i.e. after
    // the collision plan + history move already ran inside the transaction.
    await client.unsafe(`
      CREATE FUNCTION merge_v2_test_fail_fn() RETURNS trigger AS $$
      BEGIN
        IF NEW.merged_into_player_id IS NOT NULL AND NEW.id = '${SOURCE}'::uuid THEN
          RAISE EXCEPTION 'merge_v2_test_forced_failure';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await client.unsafe(
      `CREATE TRIGGER merge_v2_test_fail BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION merge_v2_test_fail_fn()`
    );

    await expect(adminMerge({ [T_A]: "source" })).rejects.toThrow();

    expect(await snapshot([TARGET, SOURCE], [T_A])).toEqual(before);
    expect((await playerRow(SOURCE)).merged_into_player_id).toBeNull();
  });
});
