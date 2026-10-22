import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import postgres, { type Sql } from "postgres";

// Super-Admin Merge Center (lib/player-merge.ts: previewAdminMerge /
// executeAdminMerge) against a REAL PostgreSQL database -- proves what a
// mocked executor structurally cannot: the real per-statement unique
// indexes on players.telegram_id / lower(players.email) accept the
// identity-move ordering, real SELECT ... FOR UPDATE + SERIALIZABLE keep two
// concurrent admin merges of the same pair from both committing, the
// whole-row player_id reassignment really carries no_show_at /
// waitlist_promotion_notification_claimed_at, and every real login/session
// resolution path lands on the surviving account afterwards.
//
// Same gate + safety check as player-merge.integration.test.ts:
//   PLAYER_MERGE_POSTGRES_TEST_URL=postgres://user@127.0.0.1:5432/reraise_merge_test \
//     npx vitest run --no-file-parallelism lib/__tests__/admin-account-merge.postgres.integration.test.ts \
//       lib/__tests__/player-merge.integration.test.ts
//
// --no-file-parallelism matters when this and player-merge.integration.test.ts
// share one database: SERIALIZABLE predicate locks on these small tables are
// relation-coarse, so two FILES merging unrelated players at the same moment
// can legitimately abort one another with SQLSTATE 40001 (production callers
// retry; these tests deliberately assert single-attempt outcomes).
const TEST_DATABASE_URL = process.env.PLAYER_MERGE_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Account-merge integration tests require a localhost test database");
  }
}

const PREFIX = "94000000-0000-4000-8000-0000000";
function id(n: number): string {
  return `${PREFIX}${String(n).padStart(5, "0")}`;
}

const TARGET = id(1);
const SOURCE = id(2);
const T_A = id(101);
const T_B = id(102);
const T_C = id(103);
const T_D = id(104);
const TEAM_1 = id(201);
const TEAM_2 = id(202);

const TG_SOURCE = 940000002;
const TG_TARGET = 940000001;
const BOT_TOKEN = "admin-merge-integration-bot-token";

function signedInitData(telegramId: number): string {
  const params = new URLSearchParams();
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));
  params.set("user", JSON.stringify({ id: telegramId, first_name: "QA" }));
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}

describePostgres("Super-Admin account merge (PostgreSQL, real locks/indexes)", () => {
  let client: Sql;
  let merge: typeof import("@/lib/player-merge");
  let repositories: typeof import("@/lib/repositories");
  let authServer: typeof import("@/features/auth-server");
  let auth: typeof import("@/features/auth");
  let tournaments: typeof import("@/features/tournaments");
  let adminAuth: typeof import("@/lib/admin-auth");
  let session: typeof import("@/lib/telegram-web-session");

  async function resetRows() {
    await client`DELETE FROM teams WHERE id IN (${TEAM_1}::uuid, ${TEAM_2}::uuid)`;
    await client`DELETE FROM tournaments WHERE id::text LIKE ${PREFIX + "%"}`;
    await client`DELETE FROM players WHERE id::text LIKE ${PREFIX + "%"}`;
    await client`DELETE FROM players WHERE telegram_id IN (${TG_SOURCE}, ${TG_TARGET})`;
    await client`DELETE FROM players WHERE lower(email) LIKE '%@merge-center.test'`;
  }

  async function createPlayer(
    playerId: string,
    opts: {
      name?: string;
      telegramId?: number | null;
      username?: string | null;
      avatar?: string | null;
      email?: string | null;
      role?: string;
      blocked?: boolean;
      restrictedAt?: Date | null;
      referrals?: number;
      freeReentries?: number;
      yandex?: boolean;
      discount?: number;
      canAccessPaid?: boolean;
    } = {}
  ) {
    await client`
      INSERT INTO players (id, display_name, telegram_id, username, telegram_avatar_url, email, role, is_blocked,
                           online_registration_restricted_at, referral_count, free_reentries_balance,
                           yandex_review_bonus_claimed, club_discount_percent, can_access_paid)
      VALUES (${playerId}::uuid, ${opts.name ?? "Player " + playerId.slice(-3)}, ${opts.telegramId ?? null},
              ${opts.username ?? null}, ${opts.avatar ?? null}, ${opts.email ?? null}, ${opts.role ?? "player"},
              ${opts.blocked ?? false}, ${opts.restrictedAt ?? null}, ${opts.referrals ?? 0},
              ${opts.freeReentries ?? 0}, ${opts.yandex ?? false}, ${opts.discount ?? 0}, ${opts.canAccessPaid ?? false})
    `;
  }

  async function createTournament(tournamentId: string, title: string, startAt: string) {
    await client`
      INSERT INTO tournaments (id, title, start_at, max_players)
      VALUES (${tournamentId}::uuid, ${title}, ${startAt}::timestamptz, 40)
    `;
  }

  // Full per-tournament footprint in every player-linked table the merge
  // moves: registration (with the no-show columns), result, live entry,
  // elimination, attendance, rebuy state, activity event.
  async function playTournament(
    playerId: string,
    tournamentId: string,
    place: number,
    opts: { noShowAt?: Date | null; claimedAt?: Date | null } = {}
  ) {
    const [registration] = await client`
      INSERT INTO registrations (player_id, tournament_id, status, no_show_at, waitlist_promotion_notification_claimed_at)
      VALUES (${playerId}::uuid, ${tournamentId}::uuid, 'registered', ${opts.noShowAt ?? null}, ${opts.claimedAt ?? null})
      RETURNING id
    `;
    await client`INSERT INTO results (tournament_id, player_id, place, rating_points) VALUES (${tournamentId}::uuid, ${playerId}::uuid, ${place}, ${100 - place})`;
    await client`INSERT INTO tournament_live_entries (tournament_id, player_id, registration_id) VALUES (${tournamentId}::uuid, ${playerId}::uuid, ${registration.id}::uuid)`;
    await client`INSERT INTO tournament_player_eliminations (tournament_id, player_id) VALUES (${tournamentId}::uuid, ${playerId}::uuid)`;
    await client`INSERT INTO tournament_attendance (tournament_id, player_id, arrived) VALUES (${tournamentId}::uuid, ${playerId}::uuid, true)`;
    await client`INSERT INTO tournament_rebuy_state (tournament_id, player_id, rebuys, addons) VALUES (${tournamentId}::uuid, ${playerId}::uuid, 1, 0)`;
    await client`INSERT INTO activity_events (player_id, event_type) VALUES (${playerId}::uuid, 'tournament_registered')`;
  }

  async function seedFourTournaments() {
    await createTournament(T_A, "Turnir A", "2026-09-01T16:00:00Z");
    await createTournament(T_B, "Turnir B", "2026-09-08T16:00:00Z");
    await createTournament(T_C, "Turnir C", "2026-09-15T16:00:00Z");
    await createTournament(T_D, "Turnir D", "2026-09-22T16:00:00Z");
  }

  async function tournamentIdsOwnedBy(table: string, playerId: string): Promise<string[]> {
    const rows = await client.unsafe(
      `SELECT tournament_id::text AS t FROM ${table} WHERE player_id = $1 ORDER BY tournament_id`,
      [playerId]
    );
    return rows.map((row) => row.t as string);
  }

  async function playerRow(playerId: string) {
    const [row] = await client`SELECT * FROM players WHERE id = ${playerId}::uuid`;
    return row;
  }

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(TEST_DATABASE_URL!);
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    process.env.SESSION_SECRET = "admin-merge-integration-session-secret";
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "integration-test-dummy";
    client = postgres(TEST_DATABASE_URL!, { max: 5 });
    merge = await import("@/lib/player-merge");
    repositories = await import("@/lib/repositories");
    authServer = await import("@/features/auth-server");
    auth = await import("@/features/auth");
    tournaments = await import("@/features/tournaments");
    adminAuth = await import("@/lib/admin-auth");
    session = await import("@/lib/telegram-web-session");
    await resetRows();
  });

  afterEach(async () => {
    await resetRows();
  });

  afterAll(async () => {
    if (!client) return;
    await client.end();
  });

  describe("preview", () => {
    it("A. target Telegram-only + source email-only -> eligible, final Telegram = target's, final email = source's", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET, username: "tg_target" });
      await createPlayer(SOURCE, { email: "a.source@merge-center.test" });

      const preview = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });

      expect(preview.blockers).toEqual([]);
      expect(preview.eligible).toBe(true);
      expect(preview.final_identity).toMatchObject({
        player_id: TARGET,
        telegram_linked: true,
        telegram_username: "tg_target",
        email: "a.source@merge-center.test",
      });
      // No raw Telegram id anywhere in the preview payload.
      expect(JSON.stringify(preview)).not.toContain(String(TG_TARGET));
    });

    it("B. target email-only + source Telegram-only -> eligible, final email = target's, final Telegram = source's", async () => {
      await createPlayer(TARGET, { email: "b.target@merge-center.test" });
      await createPlayer(SOURCE, { telegramId: TG_SOURCE, username: "tg_source" });

      const preview = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });

      expect(preview.blockers).toEqual([]);
      expect(preview.final_identity).toMatchObject({
        player_id: TARGET,
        email: "b.target@merge-center.test",
        telegram_linked: true,
        telegram_username: "tg_source",
      });
    });

    it("C. two different non-null emails -> blocker", async () => {
      await createPlayer(TARGET, { email: "c.target@merge-center.test" });
      await createPlayer(SOURCE, { email: "c.source@merge-center.test" });

      const preview = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });

      expect(preview.eligible).toBe(false);
      expect(preview.blockers.map((b) => b.code)).toEqual(["email_conflict"]);
    });

    it("D. two different non-null Telegram IDs -> blocker", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET });
      await createPlayer(SOURCE, { telegramId: TG_SOURCE });

      const preview = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });

      expect(preview.eligible).toBe(false);
      expect(preview.blockers.map((b) => b.code)).toEqual(["telegram_conflict"]);
    });

    it("E. same-tournament history on both (target registration, source attendance) -> NOT a blocker (v2): informational reconciliation entry naming the tournament", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET });
      await createPlayer(SOURCE, { email: "e.source@merge-center.test" });
      await createTournament(T_A, "Texas Classic", "2026-10-12T16:00:00Z");
      await client`INSERT INTO registrations (player_id, tournament_id, status) VALUES (${TARGET}::uuid, ${T_A}::uuid, 'registered')`;
      await client`INSERT INTO tournament_attendance (tournament_id, player_id, arrived) VALUES (${T_A}::uuid, ${SOURCE}::uuid, true)`;

      const preview = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });

      expect(preview.eligible).toBe(true);
      expect(preview.blockers).toEqual([]);
      expect(preview.result_conflicts).toEqual([]);
      expect(preview.tournament_reconciliation).toEqual([
        {
          tournament: { id: T_A, title: "Texas Classic", start_at: "2026-10-12T16:00:00.000Z" },
          collapsed: [],
          result_conflict: false,
        },
      ]);
    });

    it("F. source role higher than target -> blocker with the exact swap hint", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET, role: "operator" });
      await createPlayer(SOURCE, { email: "f.source@merge-center.test", role: "admin" });

      const preview = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });

      const role = preview.blockers.find((b) => b.code === "role_higher_on_source");
      expect(role?.message).toBe(
        "Присоединяемый аккаунт имеет более высокий уровень доступа.\nЕсли именно он должен остаться основным — поменяйте аккаунты местами."
      );
    });

    it("F'. target role higher than or equal to source -> no role blocker, target's role stays", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET, role: "admin" });
      await createPlayer(SOURCE, { email: "f2.source@merge-center.test", role: "operator" });

      const preview = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });

      expect(preview.blockers).toEqual([]);
      expect(preview.final_identity?.role).toBe("admin");
    });

    it("G. source blocked, target unblocked -> blocker; target blocked + source unblocked -> allowed with a warning", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET });
      await createPlayer(SOURCE, { email: "g.source@merge-center.test", blocked: true });

      const blockedSource = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });
      expect(blockedSource.blockers.map((b) => b.code)).toEqual(["source_blocked"]);

      await client`UPDATE players SET is_blocked = (id = ${TARGET}::uuid) WHERE id IN (${TARGET}::uuid, ${SOURCE}::uuid)`;
      const blockedTarget = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });
      expect(blockedTarget.blockers).toEqual([]);
      expect(blockedTarget.final_identity?.is_blocked).toBe(true);
      expect(blockedTarget.warnings.map((w) => w.code)).toContain("target_blocked");
    });

    it("H. source or target already merged-away -> blocker; same account -> blocker", async () => {
      const OTHER = id(3);
      await createPlayer(OTHER);
      await createPlayer(TARGET, { telegramId: TG_TARGET });
      await createPlayer(SOURCE, { email: "h.source@merge-center.test" });
      await client`UPDATE players SET merged_into_player_id = ${OTHER}::uuid, merged_at = now() WHERE id = ${SOURCE}::uuid`;

      const sourceMerged = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });
      expect(sourceMerged.blockers.map((b) => b.code)).toContain("source_merged");

      const targetMerged = await merge.previewAdminMerge({ targetPlayerId: SOURCE, sourcePlayerId: TARGET });
      expect(targetMerged.blockers.map((b) => b.code)).toContain("target_merged");

      const same = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: TARGET });
      expect(same.blockers.map((b) => b.code)).toEqual(["same_account"]);
    });

    it("shows target-wins warnings and a cheap movement summary from aggregate counts", async () => {
      await seedFourTournaments();
      await createPlayer(TARGET, { name: "Target Name", telegramId: TG_TARGET, discount: 10 });
      await createPlayer(SOURCE, {
        name: "Source Name",
        email: "w.source@merge-center.test",
        discount: 25,
        canAccessPaid: true,
      });
      await playTournament(SOURCE, T_C, 1, { noShowAt: new Date() });
      await playTournament(SOURCE, T_D, 2);

      const preview = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });

      expect(preview.eligible).toBe(true);
      expect(preview.warnings.map((w) => w.code)).toEqual(
        expect.arrayContaining(["display_name_differs", "access_flags_differ", "club_discount_differs"])
      );
      expect(preview.counts?.source).toEqual({
        tournaments: 2,
        registrations: 2,
        results: 2,
        no_shows: 1,
        team_memberships: 0,
        dealer_shifts: 0,
        activity_events: 2,
      });
    });

    it("preview never mutates anything", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET });
      await createPlayer(SOURCE, { email: "ro.source@merge-center.test" });

      await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });

      const source = await playerRow(SOURCE);
      expect(source.merged_into_player_id).toBeNull();
      expect(source.email).toBe("ro.source@merge-center.test");
    });
  });

  describe("execute", () => {
    it("rejects a wrong confirmation string before touching anything", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET });
      await createPlayer(SOURCE, { email: "conf.source@merge-center.test" });

      await expect(
        merge.executeAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE, confirmation: "объединить" })
      ).rejects.toThrow(merge.AdminMergeConfirmationError);

      expect((await playerRow(SOURCE)).merged_into_player_id).toBeNull();
    });

    it("target played A/B, source played C/D -> target owns A/B/C/D in every history table; no duplicates, no loss", async () => {
      await seedFourTournaments();
      await createPlayer(TARGET, { telegramId: TG_TARGET, username: "tg_target", referrals: 3, freeReentries: 2 });
      await createPlayer(SOURCE, { email: "hist.source@merge-center.test", referrals: 5, freeReentries: 1, yandex: true });
      await playTournament(TARGET, T_A, 1);
      await playTournament(TARGET, T_B, 2);
      await playTournament(SOURCE, T_C, 3);
      await playTournament(SOURCE, T_D, 4);

      // Team + dealer history on source (non-overlapping with target).
      await client`INSERT INTO teams (id, name, captain_player_id) VALUES (${TEAM_1}::uuid, 'Merge Team One', ${SOURCE}::uuid)`;
      await client`INSERT INTO team_memberships (team_id, player_id, joined_at) VALUES (${TEAM_1}::uuid, ${SOURCE}::uuid, now() - interval '10 days')`;
      await client`INSERT INTO dealer_profiles (player_id, is_active, hourly_rate_rub) VALUES (${SOURCE}::uuid, true, 700)`;
      await client`
        INSERT INTO dealer_shifts (dealer_player_id, started_at, ended_at, hourly_rate_rub, worked_minutes, paid_hours, amount_rub)
        VALUES (${SOURCE}::uuid, now() - interval '3 hours', now() - interval '2 hours', 700, 60, 1, 700)
      `;

      const result = await merge.executeAdminMerge({
        targetPlayerId: TARGET,
        sourcePlayerId: SOURCE,
        confirmation: merge.ADMIN_MERGE_CONFIRMATION,
      });

      expect(result).toMatchObject({ merged: true, target_player_id: TARGET, transferred_tournament_count: 2 });

      const all = [T_A, T_B, T_C, T_D].sort();
      for (const table of [
        "registrations",
        "results",
        "tournament_live_entries",
        "tournament_player_eliminations",
        "tournament_attendance",
        "tournament_rebuy_state",
      ]) {
        expect(await tournamentIdsOwnedBy(table, TARGET)).toEqual(all);
        expect(await tournamentIdsOwnedBy(table, SOURCE)).toEqual([]);
        const [{ n }] = await client.unsafe(
          `SELECT count(*)::int AS n FROM ${table} WHERE tournament_id = ANY($1::uuid[])`,
          [all]
        );
        expect(n).toBe(4);
      }

      const [activity] = await client`SELECT count(*)::int AS n FROM activity_events WHERE player_id = ${TARGET}::uuid`;
      expect(activity.n).toBe(4);
      const [membership] = await client`SELECT player_id FROM team_memberships WHERE team_id = ${TEAM_1}::uuid`;
      expect(membership.player_id).toBe(TARGET);
      const [team] = await client`SELECT captain_player_id FROM teams WHERE id = ${TEAM_1}::uuid`;
      expect(team.captain_player_id).toBe(TARGET);
      const [shift] = await client`SELECT dealer_player_id FROM dealer_shifts WHERE dealer_player_id IN (${TARGET}::uuid, ${SOURCE}::uuid)`;
      expect(shift.dealer_player_id).toBe(TARGET);
      const profiles = await client`SELECT player_id FROM dealer_profiles WHERE player_id IN (${TARGET}::uuid, ${SOURCE}::uuid)`;
      expect(profiles.map((p) => p.player_id)).toEqual([TARGET]);

      const target = await playerRow(TARGET);
      const source = await playerRow(SOURCE);
      expect(target.referral_count).toBe(8);
      expect(target.free_reentries_balance).toBe(3);
      expect(target.yandex_review_bonus_claimed).toBe(true);
      expect(target.email).toBe("hist.source@merge-center.test");
      expect(Number(target.telegram_id)).toBe(TG_TARGET);
      expect(source.merged_into_player_id).toBe(TARGET);
      expect(source.merged_at).not.toBeNull();
      expect(source.email).toBeNull();
    });

    it("REVERSE direction: target EMAIL-only, source TELEGRAM-only -> target keeps id+email, receives telegram_id; every login/session path resolves target", async () => {
      await seedFourTournaments();
      await createPlayer(TARGET, { name: "Email Primary", email: "rev.target@merge-center.test" });
      await createPlayer(SOURCE, {
        name: "TG Secondary",
        telegramId: TG_SOURCE,
        username: "tg_secondary",
        avatar: "https://t.me/avatar.jpg",
      });
      await playTournament(TARGET, T_A, 1);
      await playTournament(TARGET, T_B, 2);
      await playTournament(SOURCE, T_C, 3);
      await playTournament(SOURCE, T_D, 4);
      const oldSourceCookie = session.signSession(SOURCE);
      const oldTargetCookie = session.signSession(TARGET);

      const result = await merge.executeAdminMerge({
        targetPlayerId: TARGET,
        sourcePlayerId: SOURCE,
        confirmation: merge.ADMIN_MERGE_CONFIRMATION,
      });
      expect(result.merged).toBe(true);

      const target = await playerRow(TARGET);
      const source = await playerRow(SOURCE);
      expect(target.id).toBe(TARGET);
      expect(target.email).toBe("rev.target@merge-center.test");
      expect(target.display_name).toBe("Email Primary");
      expect(Number(target.telegram_id)).toBe(TG_SOURCE);
      expect(target.username).toBe("tg_secondary");
      expect(target.telegram_avatar_url).toBe("https://t.me/avatar.jpg");
      expect(source.telegram_id).toBeNull();
      expect(source.username).toBeNull();
      expect(source.telegram_avatar_url).toBeNull();
      expect(source.merged_into_player_id).toBe(TARGET);
      expect(await tournamentIdsOwnedBy("registrations", TARGET)).toEqual([T_A, T_B, T_C, T_D].sort());

      // Telegram identity lookup + Mini App / web login path.
      expect((await repositories.playerRepository.findByTelegramId(TG_SOURCE))?.id).toBe(TARGET);
      const [{ before }] = await client`SELECT count(*)::int AS before FROM players`;
      const loggedIn = await auth.ensurePlayerFromTelegramUser({ id: TG_SOURCE, first_name: "QA" } as never);
      expect(loggedIn.id).toBe(TARGET);
      const [{ after }] = await client`SELECT count(*)::int AS after FROM players`;
      expect(after).toBe(before); // no duplicate player created on next Telegram login

      // Admin-auth Telegram initData path.
      const viaInitData = await adminAuth.resolveAuthenticatedCaller(
        { get: (name) => (name === "x-telegram-init-data" ? signedInitData(TG_SOURCE) : null) },
        { get: () => undefined }
      );
      expect(viaInitData?.id).toBe(TARGET);

      // Old cookies: source -> target, target -> target.
      expect((await authServer.getPlayerFromSessionServer(oldSourceCookie))?.id).toBe(TARGET);
      expect((await authServer.getPlayerFromSessionServer(oldTargetCookie))?.id).toBe(TARGET);

      // Web session bootstrap endpoint (lib/current-player.ts) too.
      const { GET: authMe } = await import("@/app/api/auth/me/route");
      const { NextRequest } = await import("next/server");
      const meResponse = await authMe(
        new NextRequest("http://localhost/api/auth/me", {
          headers: { cookie: `${session.COOKIE_NAME}=${oldSourceCookie}` },
        })
      );
      expect(meResponse.status).toBe(200);
      expect((await meResponse.json()).player.id).toBe(TARGET);

      // Email login still lands on target.
      expect((await authServer.ensurePlayerFromEmailServer("rev.target@merge-center.test")).id).toBe(TARGET);
    });

    it("Telegram-primary + email-secondary: transferred email login resolves target, Telegram keeps resolving target, old source cookie resolves target", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET, username: "tg_primary" });
      await createPlayer(SOURCE, { email: "fwd.source@merge-center.test" });
      const oldSourceCookie = session.signSession(SOURCE);

      const result = await merge.executeAdminMerge({
        targetPlayerId: TARGET,
        sourcePlayerId: SOURCE,
        confirmation: merge.ADMIN_MERGE_CONFIRMATION,
      });
      expect(result.merged).toBe(true);

      expect((await playerRow(SOURCE)).email).toBeNull();
      expect((await playerRow(TARGET)).email).toBe("fwd.source@merge-center.test");

      const [{ before }] = await client`SELECT count(*)::int AS before FROM players`;
      expect((await authServer.ensurePlayerFromEmailServer("FWD.source@merge-center.test")).id).toBe(TARGET);
      const [{ after }] = await client`SELECT count(*)::int AS after FROM players`;
      expect(after).toBe(before);
      expect((await auth.ensurePlayerFromTelegramUser({ id: TG_TARGET, first_name: "QA" } as never)).id).toBe(TARGET);
      expect((await authServer.getPlayerFromSessionServer(oldSourceCookie))?.id).toBe(TARGET);
    });

    it("admin-auth resolving a merged-away source session -> target's CURRENT role, never the stale source role", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET, role: "operator" });
      await createPlayer(SOURCE, { email: "role.source@merge-center.test", role: "player" });
      const oldSourceCookie = session.signSession(SOURCE);

      await merge.executeAdminMerge({
        targetPlayerId: TARGET,
        sourcePlayerId: SOURCE,
        confirmation: merge.ADMIN_MERGE_CONFIRMATION,
      });
      // Role changes on target after the merge are what the old source
      // session must see.
      await client`UPDATE players SET role = 'player' WHERE id = ${TARGET}::uuid`;

      const caller = await adminAuth.resolveAuthenticatedCaller(
        { get: () => null },
        { get: (name) => (name === session.COOKIE_NAME ? { value: oldSourceCookie } : undefined) }
      );
      expect(caller?.id).toBe(TARGET);
      expect(caller?.role).toBe("player");
    });

    it("never merges when the TOCTOU re-check finds a double result that appeared after preview (resolution required)", async () => {
      await createTournament(T_A, "Late Overlap", "2026-10-01T16:00:00Z");
      await createPlayer(TARGET, { telegramId: TG_TARGET });
      await createPlayer(SOURCE, { email: "toctou.source@merge-center.test" });

      const preview = await merge.previewAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE });
      expect(preview.eligible).toBe(true);
      expect(preview.requires_result_resolution).toBe(false);

      await client`INSERT INTO results (tournament_id, player_id, place, rating_points) VALUES (${T_A}::uuid, ${TARGET}::uuid, 1, 10), (${T_A}::uuid, ${SOURCE}::uuid, 2, 8)`;

      const result = await merge.executeAdminMerge({
        targetPlayerId: TARGET,
        sourcePlayerId: SOURCE,
        confirmation: merge.ADMIN_MERGE_CONFIRMATION,
      });
      expect(result.merged).toBe(false);
      if (!result.merged) expect(result.blockers.map((b) => b.code)).toEqual(["result_resolution_required"]);
      expect((await playerRow(SOURCE)).merged_into_player_id).toBeNull();
      expect((await playerRow(SOURCE)).email).toBe("toctou.source@merge-center.test");
    });

    it("blocks (and mutates nothing) on two different emails, two Telegram ids, higher source role, blocked source, team-history overlap, double open dealer shift", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET, email: "x.target@merge-center.test" });
      await createPlayer(SOURCE, {
        telegramId: TG_SOURCE,
        email: "x.source@merge-center.test",
        role: "admin",
        blocked: true,
      });
      await client`INSERT INTO teams (id, name, captain_player_id) VALUES (${TEAM_1}::uuid, 'Merge Team One', ${TARGET}::uuid), (${TEAM_2}::uuid, 'Merge Team Two', ${SOURCE}::uuid)`;
      await client`INSERT INTO team_memberships (team_id, player_id, joined_at) VALUES (${TEAM_1}::uuid, ${TARGET}::uuid, now() - interval '5 days'), (${TEAM_2}::uuid, ${SOURCE}::uuid, now() - interval '3 days')`;
      await client`INSERT INTO dealer_profiles (player_id, is_active, hourly_rate_rub) VALUES (${TARGET}::uuid, true, 500), (${SOURCE}::uuid, true, 600)`;
      await client`INSERT INTO dealer_shifts (dealer_player_id, started_at, hourly_rate_rub) VALUES (${TARGET}::uuid, now(), 500), (${SOURCE}::uuid, now(), 600)`;

      const result = await merge.executeAdminMerge({
        targetPlayerId: TARGET,
        sourcePlayerId: SOURCE,
        confirmation: merge.ADMIN_MERGE_CONFIRMATION,
      });

      expect(result.merged).toBe(false);
      if (!result.merged) {
        expect(result.blockers.map((b) => b.code).sort()).toEqual(
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
      const source = await playerRow(SOURCE);
      expect(source.merged_into_player_id).toBeNull();
      expect(Number(source.telegram_id)).toBe(TG_SOURCE);
      expect(source.email).toBe("x.source@merge-center.test");
    });
  });

  // Player following (follows table) -- the Super-Admin flow reaches the same
  // moveFollows() inside the shared moveMergeHistory(). Full collision matrix
  // lives in player-merge.integration.test.ts (self-service); here each public
  // entry point is proven to reach it.
  describe("follows migration (admin merge)", () => {
    const FA = id(301);
    const FB = id(302);
    const LABELS: Record<string, string> = { [TARGET]: "TARGET", [SOURCE]: "SOURCE", [FA]: "A", [FB]: "B" };
    const label = (playerId: string) => LABELS[playerId] ?? playerId;

    async function edge(follower: string, followed: string, createdAt = "2026-01-01T00:00:00Z") {
      const [row] = await client`
        INSERT INTO follows (follower_player_id, followed_player_id, created_at)
        VALUES (${follower}::uuid, ${followed}::uuid, ${createdAt}::timestamptz)
        RETURNING id::text AS id
      `;
      return row.id as string;
    }

    async function graph(): Promise<string[]> {
      const rows = await client`
        SELECT follower_player_id::text AS f, followed_player_id::text AS t FROM follows
        WHERE follower_player_id::text LIKE ${PREFIX + "%"} OR followed_player_id::text LIKE ${PREFIX + "%"}
      `;
      return rows.map((row) => `${label(row.f as string)}>${label(row.t as string)}`).sort();
    }

    async function seedPlayers() {
      await createPlayer(TARGET, { telegramId: TG_TARGET, username: "tg_target" });
      await createPlayer(SOURCE, { email: "follows.source@merge-center.test" });
      await createPlayer(FA, { name: "Follow A" });
      await createPlayer(FB, { name: "Follow B" });
    }

    async function adminMerge() {
      return merge.executeAdminMerge({
        targetPlayerId: TARGET,
        sourcePlayerId: SOURCE,
        confirmation: merge.ADMIN_MERGE_CONFIRMATION,
      });
    }

    async function assertNoSourceOrSelfOrDuplicateEdges() {
      const [onSource] = await client`
        SELECT count(*)::int AS n FROM follows WHERE follower_player_id = ${SOURCE}::uuid OR followed_player_id = ${SOURCE}::uuid`;
      expect(onSource.n).toBe(0);
      const [selfRows] = await client`SELECT count(*)::int AS n FROM follows WHERE follower_player_id = followed_player_id`;
      expect(selfRows.n).toBe(0);
      const dupes = await client`
        SELECT 1 FROM follows GROUP BY follower_player_id, followed_player_id HAVING count(*) > 1`;
      expect(dupes).toHaveLength(0);
    }

    it("mixed graph: TARGET owns the exact union; collisions keep the existing target row; direct edges are dropped; unrelated edge untouched", async () => {
      await seedPlayers();
      const movedOutId = await edge(SOURCE, FA, "2026-01-05T00:00:00Z");
      await edge(SOURCE, FB, "2026-09-01T00:00:00Z"); // collides with the TARGET > B below
      const targetBId = await edge(TARGET, FB, "2026-09-10T00:00:00Z");
      const movedInId = await edge(FB, SOURCE, "2026-01-06T00:00:00Z");
      await edge(FA, SOURCE, "2026-09-01T00:00:00Z"); // collides with the A > TARGET below
      const targetAId = await edge(FA, TARGET, "2026-09-10T00:00:00Z");
      await edge(SOURCE, TARGET);
      await edge(TARGET, SOURCE);
      const unrelatedId = await edge(FA, FB, "2026-02-02T00:00:00Z");

      const result = await adminMerge();

      expect(result).toMatchObject({ merged: true, target_player_id: TARGET });
      expect(await graph()).toEqual(["A>B", "A>TARGET", "B>TARGET", "TARGET>A", "TARGET>B"]);

      const rows = await client`
        SELECT follower_player_id::text AS f, followed_player_id::text AS t, id::text AS id, created_at FROM follows
        WHERE follower_player_id::text LIKE ${PREFIX + "%"}
      `;
      const byPair = new Map(rows.map((row) => [`${label(row.f as string)}>${label(row.t as string)}`, row]));
      expect(byPair.get("TARGET>A")?.id).toBe(movedOutId); // reassigned: id + created_at kept
      expect(new Date(byPair.get("TARGET>A")?.created_at).toISOString()).toBe("2026-01-05T00:00:00.000Z");
      expect(byPair.get("B>TARGET")?.id).toBe(movedInId);
      expect(byPair.get("TARGET>B")?.id).toBe(targetBId); // existing target row won
      expect(new Date(byPair.get("TARGET>B")?.created_at).toISOString()).toBe("2026-09-10T00:00:00.000Z");
      expect(byPair.get("A>TARGET")?.id).toBe(targetAId);
      expect(byPair.get("A>B")?.id).toBe(unrelatedId);
      await assertNoSourceOrSelfOrDuplicateEdges();
    });

    it("outgoing-only, incoming-only and mutual edges through the admin flow", async () => {
      await seedPlayers();
      await edge(SOURCE, FA);
      await edge(FB, SOURCE);
      await edge(SOURCE, TARGET);
      await edge(TARGET, SOURCE);

      expect(await adminMerge()).toMatchObject({ merged: true });

      expect(await graph()).toEqual(["B>TARGET", "TARGET>A"]);
      await assertNoSourceOrSelfOrDuplicateEdges();
    });

    it("players with no follow data still merge", async () => {
      await seedPlayers();

      expect(await adminMerge()).toMatchObject({ merged: true });

      expect(await graph()).toEqual([]);
      await assertNoSourceOrSelfOrDuplicateEdges();
    });

    it("a blocked merge (two different Telegram ids) leaves every follow edge exactly as it was", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET, username: "tg_target" });
      await createPlayer(SOURCE, { telegramId: TG_SOURCE, username: "tg_source" });
      await createPlayer(FA, { name: "Follow A" });
      await edge(SOURCE, FA);
      await edge(FA, SOURCE);
      await edge(SOURCE, TARGET);

      const result = await adminMerge();

      expect(result.merged).toBe(false);
      expect(await graph()).toEqual(["A>SOURCE", "SOURCE>A", "SOURCE>TARGET"]);
    });
  });

  // A tab opened before the merge still holds the SOURCE id and calls the
  // bare-playerId Server Actions directly. assertPlayerActive must fail
  // closed (not canonical-redirect) because each action keeps writing with
  // its ORIGINAL playerId argument afterwards.
  describe("stale source tab after merge (direct bare-playerId actions)", () => {
    it("every assertPlayerActive-guarded action rejects the merged-away SOURCE id and writes nothing; TARGET stays fully usable; old source cookie still resolves TARGET", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET, name: "Target Stale" });
      await createPlayer(SOURCE, { email: "stale.source@merge-center.test", name: "Source Stale" });
      await createTournament(T_A, "Stale Tab Cup", "2026-12-01T16:00:00Z");
      await client`UPDATE tournaments SET status = 'open' WHERE id = ${T_A}::uuid`;
      const oldSourceCookie = session.signSession(SOURCE);

      const result = await merge.executeAdminMerge({
        targetPlayerId: TARGET,
        sourcePlayerId: SOURCE,
        confirmation: merge.ADMIN_MERGE_CONFIRMATION,
      });
      expect(result.merged).toBe(true);
      const sourceBefore = await playerRow(SOURCE);
      expect(sourceBefore.merged_into_player_id).toBe(TARGET);

      await expect(authServer.assertPlayerActive(SOURCE)).rejects.toBeInstanceOf(
        authServer.PlayerMergedAwayError
      );
      await expect(tournaments.registerPlayerForTournament(SOURCE, T_A)).rejects.toBeInstanceOf(
        authServer.PlayerMergedAwayError
      );
      await expect(tournaments.cancelPlayerRegistration(SOURCE, T_A)).rejects.toBeInstanceOf(
        authServer.PlayerMergedAwayError
      );
      await expect(auth.acceptTerms(SOURCE)).rejects.toBeInstanceOf(authServer.PlayerMergedAwayError);
      const staleSourcePlayer = { ...sourceBefore, id: SOURCE, display_name: "Source Stale" } as never;
      await expect(auth.completeProfile(staleSourcePlayer, "Fresh Nick")).rejects.toBeInstanceOf(
        authServer.PlayerMergedAwayError
      );
      await expect(auth.submitNicknameForModeration(staleSourcePlayer, "Fresh Nick 2")).rejects.toBeInstanceOf(
        authServer.PlayerMergedAwayError
      );

      // No fresh state under the dead row.
      const [{ n }] = await client`SELECT count(*)::int AS n FROM registrations WHERE player_id = ${SOURCE}::uuid`;
      expect(n).toBe(0);
      const sourceAfter = await playerRow(SOURCE);
      expect(sourceAfter.accepted_terms_at).toBeNull();
      expect(sourceAfter.profile_completed_at).toEqual(sourceBefore.profile_completed_at);
      expect(sourceAfter.pending_display_name).toEqual(sourceBefore.pending_display_name);
      expect(sourceAfter.display_name).toBe(sourceBefore.display_name);
      expect(sourceAfter.merged_into_player_id).toBe(TARGET);

      // The surviving target is an ordinary active player.
      expect((await authServer.assertPlayerActive(TARGET)).id).toBe(TARGET);
      const registration = await tournaments.registerPlayerForTournament(TARGET, T_A);
      expect(registration.status).toBe("registered");
      expect(await tournamentIdsOwnedBy("registrations", TARGET)).toEqual([T_A]);
      await auth.acceptTerms(TARGET);
      expect((await playerRow(TARGET)).accepted_terms_at).not.toBeNull();

      // Session (cookie) path unaffected: reload lands on TARGET.
      expect((await authServer.getPlayerFromSessionServer(oldSourceCookie))?.id).toBe(TARGET);
    });
  });

  describe("no-show integration", () => {
    it("restricted source merged into unrestricted target -> target becomes restricted (no bypass); registration no-show columns survive the move", async () => {
      await createTournament(T_C, "No-show Cup", "2026-09-15T16:00:00Z");
      await createTournament(T_D, "Claimed Cup", "2026-09-22T16:00:00Z");
      const restrictedAt = new Date("2026-09-15T20:00:00Z");
      const noShowAt = new Date("2026-09-15T19:00:00Z");
      const claimedAt = new Date("2026-09-20T10:00:00Z");
      await createPlayer(TARGET, { telegramId: TG_TARGET });
      await createPlayer(SOURCE, { email: "ns.source@merge-center.test", restrictedAt });
      await client`INSERT INTO registrations (player_id, tournament_id, status, no_show_at) VALUES (${SOURCE}::uuid, ${T_C}::uuid, 'registered', ${noShowAt})`;
      await client`INSERT INTO registrations (player_id, tournament_id, status, waitlist_promotion_notification_claimed_at) VALUES (${SOURCE}::uuid, ${T_D}::uuid, 'waitlist', ${claimedAt})`;

      const result = await merge.executeAdminMerge({
        targetPlayerId: TARGET,
        sourcePlayerId: SOURCE,
        confirmation: merge.ADMIN_MERGE_CONFIRMATION,
      });
      expect(result.merged).toBe(true);
      if (result.merged) expect(result.final_identity.online_registration_restricted).toBe(true);

      const target = await playerRow(TARGET);
      expect(target.online_registration_restricted_at?.toISOString()).toBe(restrictedAt.toISOString());

      const [noShowRow] = await client`SELECT player_id, status, no_show_at FROM registrations WHERE tournament_id = ${T_C}::uuid`;
      expect(noShowRow.player_id).toBe(TARGET);
      expect(noShowRow.no_show_at.toISOString()).toBe(noShowAt.toISOString());
      const [claimedRow] = await client`SELECT player_id, status, waitlist_promotion_notification_claimed_at AS claimed FROM registrations WHERE tournament_id = ${T_D}::uuid`;
      expect(claimedRow.player_id).toBe(TARGET);
      expect(claimedRow.status).toBe("waitlist");
      expect(claimedRow.claimed.toISOString()).toBe(claimedAt.toISOString());
    });

    it("both restricted -> keeps the MORE RECENT timestamp; only target restricted -> stays restricted; neither -> null", async () => {
      const older = new Date("2026-08-01T00:00:00Z");
      const newer = new Date("2026-09-01T00:00:00Z");
      await createPlayer(TARGET, { telegramId: TG_TARGET, restrictedAt: older });
      await createPlayer(SOURCE, { email: "both.source@merge-center.test", restrictedAt: newer });

      await merge.executeAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE, confirmation: merge.ADMIN_MERGE_CONFIRMATION });
      expect((await playerRow(TARGET)).online_registration_restricted_at.toISOString()).toBe(newer.toISOString());

      await resetRows();
      await createPlayer(TARGET, { telegramId: TG_TARGET, restrictedAt: newer });
      await createPlayer(SOURCE, { email: "t-only.source@merge-center.test" });
      await merge.executeAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE, confirmation: merge.ADMIN_MERGE_CONFIRMATION });
      expect((await playerRow(TARGET)).online_registration_restricted_at.toISOString()).toBe(newer.toISOString());

      await resetRows();
      await createPlayer(TARGET, { telegramId: TG_TARGET });
      await createPlayer(SOURCE, { email: "none.source@merge-center.test" });
      await merge.executeAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE, confirmation: merge.ADMIN_MERGE_CONFIRMATION });
      expect((await playerRow(TARGET)).online_registration_restricted_at).toBeNull();
    });

    it("self-service merge also keeps a restricted email account's restriction (no bypass through the OTP flow either)", async () => {
      const restrictedAt = new Date("2026-09-10T00:00:00Z");
      await createPlayer(TARGET, { telegramId: TG_TARGET });
      await createPlayer(SOURCE, { email: "ss-ns.source@merge-center.test", restrictedAt });
      const [intent] = await client`
        INSERT INTO player_merge_intents (target_player_id, source_player_id, email, status, expires_at)
        VALUES (${TARGET}::uuid, ${SOURCE}::uuid, 'ss-ns.source@merge-center.test', 'pending', now() + interval '15 minutes')
        RETURNING id
      `;

      expect(await merge.executeMerge({ intentId: intent.id, sessionPlayerId: TARGET })).toEqual({ merged: true });
      expect((await playerRow(TARGET)).online_registration_restricted_at.toISOString()).toBe(restrictedAt.toISOString());
    });
  });

  describe("self-service regressions", () => {
    it("a BLOCKED email-only source can no longer be absorbed via self-service (moderation bypass fixed); the intent goes to the admin conflict queue", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET });
      await createPlayer(SOURCE, { email: "blocked.source@merge-center.test", blocked: true });

      const intent = await merge.createMergeIntent({
        targetPlayerId: TARGET,
        sourcePlayerId: SOURCE,
        email: "blocked.source@merge-center.test",
        otpVerificationId: null,
      });
      expect(intent.status).toBe("conflict");
      expect(intent.conflict_reason).toBe(merge.SOURCE_BLOCKED_REASON);

      // Even a forcibly-pending intent is re-checked inside the transaction.
      await client`UPDATE player_merge_intents SET status = 'pending' WHERE id = ${intent.id}::uuid`;
      const result = await merge.executeMerge({ intentId: intent.id, sessionPlayerId: TARGET });
      expect(result).toEqual({ merged: false, conflict: true, reason: merge.SOURCE_BLOCKED_REASON });
      expect((await playerRow(SOURCE)).merged_into_player_id).toBeNull();
    });

    it("a source WITH its own Telegram identity is still NOT self-service-mergeable", async () => {
      await createPlayer(TARGET, { telegramId: TG_TARGET });
      await createPlayer(SOURCE, { telegramId: TG_SOURCE, email: "tg.source@merge-center.test" });

      const intent = await merge.createMergeIntent({
        targetPlayerId: TARGET,
        sourcePlayerId: SOURCE,
        email: "tg.source@merge-center.test",
        otpVerificationId: null,
      });
      expect(intent.status).toBe("conflict");
      expect(intent.conflict_reason).toContain("Telegram-идентификация");
    });
  });

  describe("merge intents / conflict queue", () => {
    it("after an admin merge, pending/conflict intents for that exact pair are resolved (same direction -> completed, reverse -> cancelled); OTP metadata untouched; unrelated intents untouched", async () => {
      const OTHER = id(3);
      await createPlayer(TARGET, { telegramId: TG_TARGET });
      await createPlayer(SOURCE, { email: "q.source@merge-center.test" });
      await createPlayer(OTHER);
      const [same] = await client`
        INSERT INTO player_merge_intents (target_player_id, source_player_id, email, status, conflict_reason, expires_at)
        VALUES (${TARGET}::uuid, ${SOURCE}::uuid, 'q.source@merge-center.test', 'conflict', 'some reason', now() + interval '15 minutes')
        RETURNING id`;
      const [reverse] = await client`
        INSERT INTO player_merge_intents (target_player_id, source_player_id, email, status, expires_at)
        VALUES (${SOURCE}::uuid, ${TARGET}::uuid, 'q.source@merge-center.test', 'pending', now() + interval '15 minutes')
        RETURNING id`;
      const [unrelated] = await client`
        INSERT INTO player_merge_intents (target_player_id, source_player_id, email, status, expires_at)
        VALUES (${OTHER}::uuid, ${TARGET}::uuid, 'other@merge-center.test', 'conflict', now() + interval '15 minutes')
        RETURNING id`;

      await merge.executeAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE, confirmation: merge.ADMIN_MERGE_CONFIRMATION });

      const rows = await client`SELECT id, status, conflict_reason, otp_verification_id, resolved_at FROM player_merge_intents WHERE id IN (${same.id}::uuid, ${reverse.id}::uuid, ${unrelated.id}::uuid)`;
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(same.id)).toMatchObject({ status: "completed", conflict_reason: "some reason", otp_verification_id: null });
      expect(byId.get(same.id)?.resolved_at).not.toBeNull();
      expect(byId.get(reverse.id)).toMatchObject({ status: "cancelled" });
      expect(byId.get(unrelated.id)).toMatchObject({ status: "conflict", resolved_at: null });

      const conflicts = await repositories.playerMergeIntentRepository.listConflicts();
      expect(conflicts.some((c) => c.id === same.id || c.id === reverse.id)).toBe(false);
    });
  });

  describe("search", () => {
    it("finds by name, @username, email, exact Telegram ID; never returns merged-away players", async () => {
      const MERGED = id(3);
      await createPlayer(TARGET, { name: "Searchable Ivan", telegramId: TG_TARGET, username: "ivan_tg" });
      await createPlayer(SOURCE, { name: "Other Person", email: "ivan.mail@merge-center.test" });
      await createPlayer(MERGED, { name: "Searchable Ghost" });
      await client`UPDATE players SET merged_into_player_id = ${TARGET}::uuid, merged_at = now() WHERE id = ${MERGED}::uuid`;

      const byName = await merge.searchPlayersForAdminMerge("searchable");
      expect(byName.map((p) => p.id)).toEqual([TARGET]);
      expect((await merge.searchPlayersForAdminMerge("@ivan_tg")).map((p) => p.id)).toEqual([TARGET]);
      expect((await merge.searchPlayersForAdminMerge("ivan.mail@")).map((p) => p.id)).toEqual([SOURCE]);
      expect((await merge.searchPlayersForAdminMerge(String(TG_TARGET))).map((p) => p.id)).toEqual([TARGET]);
      expect(await merge.searchPlayersForAdminMerge("a")).toEqual([]);
      // LIKE wildcards are escaped, not interpreted.
      expect(await merge.searchPlayersForAdminMerge("%%")).toEqual([]);
      expect(byName[0]).toMatchObject({ telegram_linked: true, merged: false });
      expect(byName[0]).not.toHaveProperty("telegram_id");
    });
  });

  describe("concurrency / double submit", () => {
    it("two simultaneous admin executes for the SAME pair: exactly one commits; the other fails cleanly; no double-summed counters, no duplicate history, no split identity", async () => {
      await seedFourTournaments();
      await createPlayer(TARGET, { email: "race.target@merge-center.test", referrals: 3 });
      await createPlayer(SOURCE, { telegramId: TG_SOURCE, username: "race_tg", referrals: 5 });
      await playTournament(TARGET, T_A, 1);
      await playTournament(SOURCE, T_C, 2);

      const attempts = await Promise.allSettled([
        merge.executeAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE, confirmation: merge.ADMIN_MERGE_CONFIRMATION }),
        merge.executeAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE, confirmation: merge.ADMIN_MERGE_CONFIRMATION }),
      ]);

      const merged = attempts.filter((a) => a.status === "fulfilled" && a.value.merged);
      const failed = attempts.filter((a) => !(a.status === "fulfilled" && a.value.merged));
      expect(merged).toHaveLength(1);
      expect(failed).toHaveLength(1);
      const loser = failed[0];
      if (loser.status === "fulfilled") {
        expect(loser.value.merged).toBe(false);
        if (!loser.value.merged) expect(loser.value.blockers.map((b) => b.code)).toContain("source_merged");
      } else {
        expect(loser.reason).toBeInstanceOf(merge.AdminMergeConcurrentUpdateError);
      }

      const target = await playerRow(TARGET);
      const source = await playerRow(SOURCE);
      expect(target.referral_count).toBe(8);
      expect(Number(target.telegram_id)).toBe(TG_SOURCE);
      expect(source.telegram_id).toBeNull();
      expect(source.merged_into_player_id).toBe(TARGET);
      const owners = await client`SELECT id FROM players WHERE telegram_id = ${TG_SOURCE}`;
      expect(owners.map((row) => row.id)).toEqual([TARGET]);
      expect(await tournamentIdsOwnedBy("registrations", TARGET)).toEqual([T_A, T_C].sort());
    });

    it("GUARANTEED overlap (barrier): both merges are in flight and blocked on the same locked player row at once -> exactly one commits, the loser hits the real SERIALIZABLE/lock path and returns source_merged", async () => {
      await createPlayer(TARGET, { email: "barrier.target@merge-center.test", referrals: 1 });
      await createPlayer(SOURCE, { telegramId: TG_SOURCE, referrals: 2 });
      const firstLockedId = [TARGET, SOURCE].sort()[0];

      let releaseBarrier!: () => void;
      const barrier = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      let lockHeld!: () => void;
      const lockAcquired = new Promise<void>((resolve) => {
        lockHeld = resolve;
      });

      // External transaction holds the first (id-sorted) player row lock --
      // the very first player lock both admin merges need.
      const holder = client.begin(async (sql) => {
        await sql`SELECT id FROM players WHERE id = ${firstLockedId}::uuid FOR UPDATE`;
        lockHeld();
        await barrier;
      });
      await lockAcquired;

      const pending = [
        merge.executeAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE, confirmation: merge.ADMIN_MERGE_CONFIRMATION }),
        merge.executeAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE, confirmation: merge.ADMIN_MERGE_CONFIRMATION }),
      ];

      // Wait until BOTH merge transactions are actually blocked on that row.
      for (let i = 0; i < 100; i++) {
        const [{ waiting }] = await client`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%for update%'
        `;
        if (waiting >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const [{ waitingNow }] = await client`
        SELECT count(*)::int AS "waitingNow" FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%for update%'
      `;
      expect(waitingNow).toBe(2);

      releaseBarrier();
      await holder;
      const attempts = await Promise.allSettled(pending);

      const merged = attempts.filter((a) => a.status === "fulfilled" && a.value.merged);
      expect(merged).toHaveLength(1);
      const loser = attempts.find((a) => !(a.status === "fulfilled" && a.value.merged))!;
      if (loser.status === "fulfilled") {
        if (!loser.value.merged) expect(loser.value.blockers.map((b) => b.code)).toContain("source_merged");
      } else {
        expect(loser.reason).toBeInstanceOf(merge.AdminMergeConcurrentUpdateError);
      }

      const target = await playerRow(TARGET);
      expect(target.referral_count).toBe(3); // summed exactly once
      expect(Number(target.telegram_id)).toBe(TG_SOURCE);
      expect((await playerRow(SOURCE)).telegram_id).toBeNull();
    });

    it("opposite-direction concurrent admin merges of the same pair never deadlock-corrupt: exactly one direction wins", async () => {
      await createPlayer(TARGET, { email: "dir.target@merge-center.test" });
      await createPlayer(SOURCE, { telegramId: TG_SOURCE });

      const attempts = await Promise.allSettled([
        merge.executeAdminMerge({ targetPlayerId: TARGET, sourcePlayerId: SOURCE, confirmation: merge.ADMIN_MERGE_CONFIRMATION }),
        merge.executeAdminMerge({ targetPlayerId: SOURCE, sourcePlayerId: TARGET, confirmation: merge.ADMIN_MERGE_CONFIRMATION }),
      ]);

      const merged = attempts.filter((a) => a.status === "fulfilled" && a.value.merged);
      expect(merged).toHaveLength(1);
      const rows = await client`SELECT id, merged_into_player_id FROM players WHERE id IN (${TARGET}::uuid, ${SOURCE}::uuid)`;
      expect(rows.filter((row) => row.merged_into_player_id !== null)).toHaveLength(1);
    });
  });
});
