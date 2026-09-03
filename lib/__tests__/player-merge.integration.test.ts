import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

// Proves the two guarantees the mocked unit tests (player-merge.test.ts)
// structurally cannot: that SELECT ... FOR UPDATE really locks rows so a
// concurrent merge attempt on the same pending intent can't double-merge,
// and that the email-clear-before-email-set ordering inside executeMerge
// really is required by the real, per-statement players_email_unique_idx
// (not just asserted by a mocked executor). Gated behind a real database,
// same convention as features/__tests__/academy-postgres.integration.test.ts
// and club-activity-postgres.integration.test.ts.
const TEST_DATABASE_URL = process.env.PLAYER_MERGE_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Account-merge integration tests require a localhost test database");
  }
}

const TARGET_ID = "92000000-0000-4000-8000-000000000001";
const SOURCE_ID = "92000000-0000-4000-8000-000000000002";
const TOURNAMENT_ID = "92000000-0000-4000-8000-000000000003";

describePostgres("Account merge (PostgreSQL, real transaction/lock behavior)", () => {
  let client: Sql;
  let playerMerge: typeof import("@/lib/player-merge");
  let playerMergeIntentRepository: typeof import("@/lib/repositories")["playerMergeIntentRepository"];

  const THIRD_PARTY_ID = "92000000-0000-4000-8000-000000000009";

  // Cascades handle the rest: players.id ON DELETE CASCADE covers
  // registrations and player_merge_intents (both target_player_id and
  // source_player_id reference players.id with ON DELETE CASCADE) --
  // deleting every player this suite ever creates is sufficient. Run
  // unconditionally after EVERY test (not just at the end of each test body)
  // so a test that throws partway through -- including the rollback test,
  // by design -- never leaks state into the next one.
  async function resetRows() {
    await client`DELETE FROM players WHERE id IN (${TARGET_ID}::uuid, ${SOURCE_ID}::uuid, ${THIRD_PARTY_ID}::uuid)`;
    await client`DELETE FROM tournaments WHERE id = ${TOURNAMENT_ID}::uuid`;
  }

  async function insertBaseRows() {
    await client`
      INSERT INTO tournaments (id, title, start_at, max_players)
      VALUES (${TOURNAMENT_ID}::uuid, 'Merge Test Tournament', now(), 20)
    `;
    await client`
      INSERT INTO players (id, display_name, email, referral_count, free_reentries_balance, yandex_review_bonus_claimed)
      VALUES (${TARGET_ID}::uuid, 'Target Player', NULL, 3, 2, false)
    `;
    await client`
      INSERT INTO players (id, display_name, email, referral_count, free_reentries_balance, yandex_review_bonus_claimed)
      VALUES (${SOURCE_ID}::uuid, 'Source Player', 'source@example.com', 5, 1, true)
    `;
  }

  async function insertPendingIntent(email = "source@example.com") {
    const [row] = await client`
      INSERT INTO player_merge_intents (target_player_id, source_player_id, email, status, expires_at)
      VALUES (${TARGET_ID}::uuid, ${SOURCE_ID}::uuid, ${email}, 'pending', now() + interval '15 minutes')
      RETURNING id
    `;
    return row.id as string;
  }

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(TEST_DATABASE_URL!);
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    client = postgres(TEST_DATABASE_URL!, { max: 5 });
    playerMerge = await import("@/lib/player-merge");
    ({ playerMergeIntentRepository } = await import("@/lib/repositories"));
    await resetRows();
  });

  afterEach(async () => {
    await resetRows();
  });

  afterAll(async () => {
    if (!client) return;
    await client.end();
  });

  it("moves history and reconciles fields against a real database, without violating players_email_unique_idx", async () => {
    await insertBaseRows();
    await client`
      INSERT INTO registrations (player_id, tournament_id, status)
      VALUES (${SOURCE_ID}::uuid, ${TOURNAMENT_ID}::uuid, 'registered')
    `;
    const intentId = await insertPendingIntent();

    const result = await playerMerge.executeMerge({ intentId, sessionPlayerId: TARGET_ID });
    expect(result).toEqual({ merged: true });

    const [target] = await client`SELECT * FROM players WHERE id = ${TARGET_ID}::uuid`;
    const [source] = await client`SELECT * FROM players WHERE id = ${SOURCE_ID}::uuid`;

    expect(target.email).toBe("source@example.com");
    expect(target.referral_count).toBe(8);
    expect(target.free_reentries_balance).toBe(3);
    expect(target.yandex_review_bonus_claimed).toBe(true);

    expect(source.email).toBeNull();
    expect(source.merged_into_player_id).toBe(TARGET_ID);
    expect(source.merged_at).not.toBeNull();

    const registrationRows = await client`SELECT player_id FROM registrations WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;
    expect(registrationRows).toHaveLength(1);
    expect(registrationRows[0].player_id).toBe(TARGET_ID);

    const [intent] = await client`SELECT status FROM player_merge_intents WHERE id = ${intentId}::uuid`;
    expect(intent.status).toBe("completed");

  });

  it("is idempotent -- confirming the same intent twice rejects the second attempt instead of merging again", async () => {
    await insertBaseRows();
    const intentId = await insertPendingIntent();

    const first = await playerMerge.executeMerge({ intentId, sessionPlayerId: TARGET_ID });
    expect(first).toEqual({ merged: true });

    await expect(
      playerMerge.executeMerge({ intentId, sessionPlayerId: TARGET_ID })
    ).rejects.toThrow(playerMerge.MergeIntentNotPendingError);

    // Second attempt must not have re-summed the already-summed ledgers.
    const [target] = await client`SELECT referral_count FROM players WHERE id = ${TARGET_ID}::uuid`;
    expect(target.referral_count).toBe(8);

  });

  it("under real SELECT ... FOR UPDATE locking, two concurrent identical merge requests: exactly one succeeds", async () => {
    await insertBaseRows();
    const intentId = await insertPendingIntent();

    const results = await Promise.allSettled([
      playerMerge.executeMerge({ intentId, sessionPlayerId: TARGET_ID }),
      playerMerge.executeMerge({ intentId, sessionPlayerId: TARGET_ID }),
    ]);

    const merged = results.filter(
      (r) => r.status === "fulfilled" && r.value.merged === true
    );
    const rejectedOrConflicted = results.filter(
      (r) => r.status === "rejected" || (r.status === "fulfilled" && r.value.merged === false)
    );

    expect(merged).toHaveLength(1);
    expect(rejectedOrConflicted).toHaveLength(1);

    const [target] = await client`SELECT referral_count FROM players WHERE id = ${TARGET_ID}::uuid`;
    // Ledgers summed exactly once, not twice -- proves the second racer never
    // ran the history-move statements, whether it lost the row lock outright
    // or lost a SERIALIZABLE write-skew check.
    expect(target.referral_count).toBe(8);

  });

  it("rejects a second concurrent pending intent for the same (target, source) pair via the DB's own partial unique index", async () => {
    await insertBaseRows();
    await insertPendingIntent();

    await expect(
      client`
        INSERT INTO player_merge_intents (target_player_id, source_player_id, email, status, expires_at)
        VALUES (${TARGET_ID}::uuid, ${SOURCE_ID}::uuid, 'source@example.com', 'pending', now() + interval '15 minutes')
      `
    ).rejects.toMatchObject({ code: "23505" });

  });

  it("rolls back the entire transaction when the target row disappears mid-flight -- no partial state survives a concurrent admin deletion", async () => {
    await insertBaseRows();
    await client`
      INSERT INTO registrations (player_id, tournament_id, status)
      VALUES (${SOURCE_ID}::uuid, ${TOURNAMENT_ID}::uuid, 'registered')
    `;
    const intentId = await insertPendingIntent();

    // Simulates a concurrent admin deleting the target player between intent
    // creation and confirmation (a real, if rare, race -- deleteManualPlayer
    // itself now refuses this specific case via hasMergeSources(), but that
    // guard only covers a COMPLETED merge; a target can still legitimately
    // be deleted while an intent is merely pending). player_merge_intents'
    // own FK to players is ON DELETE CASCADE, so deleting the target also
    // deletes the intent row itself -- executeMerge's very first query (the
    // intent lookup) then finds nothing and throws MergeIntentNotFoundError,
    // proving the transaction aborts cleanly rather than partially applying
    // anything downstream of a row that vanished mid-flight.
    await client`DELETE FROM players WHERE id = ${TARGET_ID}::uuid`;

    await expect(
      playerMerge.executeMerge({ intentId, sessionPlayerId: TARGET_ID })
    ).rejects.toThrow(playerMerge.MergeIntentNotFoundError);

    const [source] = await client`SELECT * FROM players WHERE id = ${SOURCE_ID}::uuid`;
    const [intent] = await client`SELECT status FROM player_merge_intents WHERE id = ${intentId}::uuid`;
    const registrationRows = await client`SELECT player_id FROM registrations WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;

    // Nothing committed -- source was never marked merged, its email/ledgers
    // untouched, and the registration never moved.
    expect(source.merged_into_player_id).toBeNull();
    expect(source.email).toBe("source@example.com");
    expect(source.referral_count).toBe(5);
    expect(intent).toBeUndefined();
    expect(registrationRows).toHaveLength(1);
    expect(registrationRows[0].player_id).toBe(SOURCE_ID);

  });

  it("createMergeIntent + listConflicts round-trips through the real repository", async () => {
    await insertBaseRows();
    // Give source its own Telegram identity so eligibility fails and the
    // intent is created directly in 'conflict' status, feeding the admin
    // queue instead of the self-service path.
    await client`UPDATE players SET telegram_id = 555555 WHERE id = ${SOURCE_ID}::uuid`;

    const intent = await playerMerge.createMergeIntent({
      targetPlayerId: TARGET_ID,
      sourcePlayerId: SOURCE_ID,
      email: "source@example.com",
      otpVerificationId: null,
    });

    expect(intent.status).toBe("conflict");
    expect(intent.conflict_reason).toContain("Telegram-идентификация");

    const conflicts = await playerMergeIntentRepository.listConflicts();
    expect(conflicts.some((c) => c.id === intent.id)).toBe(true);
  });

  it("rejects on real tournament overlap -- both players registered for the same tournament", async () => {
    await insertBaseRows();
    await client`
      INSERT INTO registrations (player_id, tournament_id, status)
      VALUES
        (${TARGET_ID}::uuid, ${TOURNAMENT_ID}::uuid, 'registered'),
        (${SOURCE_ID}::uuid, ${TOURNAMENT_ID}::uuid, 'registered')
    `;

    const intent = await playerMerge.createMergeIntent({
      targetPlayerId: TARGET_ID,
      sourcePlayerId: SOURCE_ID,
      email: "source@example.com",
      otpVerificationId: null,
    });

    expect(intent.status).toBe("conflict");
    expect(intent.conflict_reason).toContain("пересекающаяся");

    // Forcing the intent to 'pending' and confirming it anyway must still
    // be rejected -- the TOCTOU re-check inside executeMerge itself (not
    // just createMergeIntent's preview) is what actually protects the data,
    // against the real overlap this time, not a mocked one.
    await client`UPDATE player_merge_intents SET status = 'pending' WHERE id = ${intent.id}::uuid`;
    const result = await playerMerge.executeMerge({ intentId: intent.id, sessionPlayerId: TARGET_ID });
    expect(result.merged).toBe(false);

    const [source] = await client`SELECT merged_into_player_id FROM players WHERE id = ${SOURCE_ID}::uuid`;
    expect(source.merged_into_player_id).toBeNull();
  });

  it("moves Re-Raise-specific tournament_attendance and tournament_rebuy_state rows -- tables Sterling's own schema doesn't have", async () => {
    await insertBaseRows();
    await client`
      INSERT INTO tournament_attendance (tournament_id, player_id, arrived)
      VALUES (${TOURNAMENT_ID}::uuid, ${SOURCE_ID}::uuid, true)
    `;
    await client`
      INSERT INTO tournament_rebuy_state (tournament_id, player_id, rebuys, addons)
      VALUES (${TOURNAMENT_ID}::uuid, ${SOURCE_ID}::uuid, 2, 1)
    `;
    const intentId = await insertPendingIntent();

    const result = await playerMerge.executeMerge({ intentId, sessionPlayerId: TARGET_ID });
    expect(result).toEqual({ merged: true });

    const [attendance] = await client`SELECT player_id, arrived FROM tournament_attendance WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;
    const [rebuy] = await client`SELECT player_id, rebuys, addons FROM tournament_rebuy_state WHERE tournament_id = ${TOURNAMENT_ID}::uuid`;

    expect(attendance.player_id).toBe(TARGET_ID);
    expect(attendance.arrived).toBe(true);
    expect(rebuy.player_id).toBe(TARGET_ID);
    expect(rebuy.rebuys).toBe(2);
    expect(rebuy.addons).toBe(1);
  });

  it("rejects when both target and source have an open dealer shift -- fails closed before any row is mutated", async () => {
    await insertBaseRows();
    await client`INSERT INTO dealer_profiles (player_id, is_active, hourly_rate_rub) VALUES (${TARGET_ID}::uuid, true, 500)`;
    await client`INSERT INTO dealer_profiles (player_id, is_active, hourly_rate_rub) VALUES (${SOURCE_ID}::uuid, true, 600)`;
    await client`INSERT INTO dealer_shifts (dealer_player_id, started_at, hourly_rate_rub) VALUES (${TARGET_ID}::uuid, now(), 500)`;
    await client`INSERT INTO dealer_shifts (dealer_player_id, started_at, hourly_rate_rub) VALUES (${SOURCE_ID}::uuid, now(), 600)`;
    const intentId = await insertPendingIntent();

    const result = await playerMerge.executeMerge({ intentId, sessionPlayerId: TARGET_ID });

    expect(result.merged).toBe(false);
    if (!result.merged) {
      expect(result.reason).toContain("открытую смену");
    }

    const openShifts = await client`SELECT dealer_player_id FROM dealer_shifts WHERE ended_at IS NULL`;
    expect(openShifts).toHaveLength(2);
    const [source] = await client`SELECT merged_into_player_id FROM players WHERE id = ${SOURCE_ID}::uuid`;
    expect(source.merged_into_player_id).toBeNull();
  });

  it("merges dealer shift history and profile when only source is a dealer -- real FK reassignment, not mocked", async () => {
    await insertBaseRows();
    await client`INSERT INTO dealer_profiles (player_id, is_active, hourly_rate_rub) VALUES (${SOURCE_ID}::uuid, true, 700)`;
    const [closedShift] = await client`
      INSERT INTO dealer_shifts (dealer_player_id, started_at, ended_at, hourly_rate_rub, worked_minutes, paid_hours, amount_rub)
      VALUES (${SOURCE_ID}::uuid, now() - interval '2 hours', now() - interval '1 hour', 700, 60, 1, 700)
      RETURNING id
    `;
    const intentId = await insertPendingIntent();

    const result = await playerMerge.executeMerge({ intentId, sessionPlayerId: TARGET_ID });
    expect(result).toEqual({ merged: true });

    const [shift] = await client`SELECT dealer_player_id FROM dealer_shifts WHERE id = ${closedShift.id}::uuid`;
    expect(shift.dealer_player_id).toBe(TARGET_ID);

    const profiles = await client`SELECT player_id, hourly_rate_rub FROM dealer_profiles`;
    expect(profiles).toHaveLength(1);
    expect(profiles[0].player_id).toBe(TARGET_ID);
    expect(profiles[0].hourly_rate_rub).toBe(700);
  });
});

// Blocker 2 (email uniqueness/resolution audit) -- proves
// PostgresPlayerRepository.findByEmail() actually matches
// players_email_unique_idx's own case-insensitive semantics (UNIQUE btree
// on lower(email)), not just a plain eq(). Without this, a row whose email
// was never normalized to lowercase (e.g. verbatim-copied by
// scripts/backfill-postgres.mjs from the legacy Supabase schema) would be
// invisible to a lowercase-normalized lookup while still blocking any new
// lowercase insert/update at the DB level -- exactly the "verified email
// resolves to zero source players even though one already legitimately
// owns it" failure mode this test rules out.
describePostgres("PostgresPlayerRepository.findByEmail -- case-insensitive resolution", () => {
  let client: Sql;
  let playerRepository: typeof import("@/lib/repositories")["playerRepository"];

  const LEGACY_ID = "92000000-0000-4000-8000-000000000201";

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(TEST_DATABASE_URL!);
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    client = postgres(TEST_DATABASE_URL!, { max: 5 });
    ({ playerRepository } = await import("@/lib/repositories"));
    await client`DELETE FROM players WHERE id = ${LEGACY_ID}::uuid`;
  });

  afterEach(async () => {
    await client`DELETE FROM players WHERE id = ${LEGACY_ID}::uuid`;
  });

  afterAll(async () => {
    if (!client) return;
    await client.end();
  });

  it("finds a legacy row whose email was never normalized to lowercase, given a lowercase-normalized lookup", async () => {
    await client`INSERT INTO players (id, display_name, email) VALUES (${LEGACY_ID}::uuid, 'Legacy', 'Mixed.Case@Example.com')`;

    const found = await playerRepository.findByEmail("mixed.case@example.com");

    expect(found?.id).toBe(LEGACY_ID);
  });

  it("finds the same row regardless of the lookup's own casing", async () => {
    await client`INSERT INTO players (id, display_name, email) VALUES (${LEGACY_ID}::uuid, 'Legacy', 'already.lower@example.com')`;

    expect((await playerRepository.findByEmail("Already.Lower@Example.com"))?.id).toBe(LEGACY_ID);
    expect((await playerRepository.findByEmail("ALREADY.LOWER@EXAMPLE.COM"))?.id).toBe(LEGACY_ID);
  });

  it("still returns null for a genuinely different email, not a false-positive substring/wildcard match", async () => {
    await client`INSERT INTO players (id, display_name, email) VALUES (${LEGACY_ID}::uuid, 'Legacy', 'exact@example.com')`;

    expect(await playerRepository.findByEmail("notexact@example.com")).toBeNull();
    expect(await playerRepository.findByEmail("exact@example.co")).toBeNull();
  });
});
