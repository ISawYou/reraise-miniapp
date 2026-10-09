import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addResult,
  fakeResults,
  resetFakeResultsDb,
  resultsSnapshot,
  updateStatements,
  type FakeResultRow,
} from "./helpers/fake-results-db";
import { getFreeSheetColumnLayout } from "@/lib/tournament-sheet-parsing";

// Exercises the REAL logic of features/completed-tournament-place-correction.ts
// against ./helpers/fake-results-db.ts, which enforces the real `results`
// constraints (UNIQUE(tournament_id, place), place > 0, rating breakdown
// CHECK) on every UPDATE and rolls back a throwing transaction.

vi.mock("@/lib/db", async () => ({
  db: (await import("./helpers/fake-results-db")).fakeResultsDb,
}));

const authMocks = vi.hoisted(() => {
  class UnauthorizedActionError extends Error {
    constructor(message = "Не авторизовано") {
      super(message);
      this.name = "UnauthorizedActionError";
    }
  }
  class ForbiddenActionError extends Error {
    constructor(message = "Недостаточно прав") {
      super(message);
      this.name = "ForbiddenActionError";
    }
  }
  return {
    UnauthorizedActionError,
    ForbiddenActionError,
    assertServerActorRole: vi.fn(),
  };
});
vi.mock("@/lib/admin-auth", () => authMocks);

const achievementMocks = vi.hoisted(() => ({
  syncPlayerAchievements: vi.fn<(playerId: string, options?: unknown) => Promise<unknown>>(
    async () => ({})
  ),
  syncPlayersAchievements: vi.fn(),
  syncPlayersAchievementsIfEnabled: vi.fn(),
}));
vi.mock("@/features/achievements", () => achievementMocks);

const activityMocks = vi.hoisted(() => ({
  publishTournamentWinnerEvent: vi.fn(),
  publishLegendaryAchievementEvent: vi.fn(),
}));
vi.mock("@/features/club-activity", () => activityMocks);

const sheetMocks = vi.hoisted(() => ({
  readSpreadsheetTabValues: vi.fn(),
  batchUpdateSpreadsheetValues: vi.fn(),
}));
vi.mock("@/lib/google-sheets", () => sheetMocks);

const ratingMocks = vi.hoisted(() => ({
  calculateRatingPoints: vi.fn(),
  calculateRatingPointsV2: vi.fn(),
  calculateRatingPointsForTournament: vi.fn(),
}));
vi.mock("@/features/rating", () => ({ calculateRatingPoints: ratingMocks.calculateRatingPoints }));
vi.mock("@/features/rating-v2", () => ({
  calculateRatingPointsV2: ratingMocks.calculateRatingPointsV2,
  calculateRatingPointsForTournament: ratingMocks.calculateRatingPointsForTournament,
}));

const {
  correctCompletedTournamentPlaces,
  CompletedPlaceCorrectionRejectedError,
  CompletedPlaceCorrectionUnavailableError,
  LEGACY_BREAKDOWN_MESSAGE,
  NOT_COMPLETED_MESSAGE,
  STALE_RESULTS_MESSAGE,
  WINNER_PINNED_MESSAGE,
} = await import("@/features/completed-tournament-place-correction");
const { TournamentNotFoundError } = await import("@/lib/tournament-errors");
const { POST } = await import(
  "@/app/api/admin/tournaments/[id]/completed-place-correction/route"
);
const { isAdminRouteAllowedForOperator } = await import("@/lib/admin-permissions");

const originalProvider = process.env.DATABASE_PROVIDER;

// 8 players, p1 at place 1 ... p8 at place 8.
function seedEight() {
  for (let place = 1; place <= 8; place++) {
    addResult(`p${place}`, place, { displayName: `Игрок ${place}` });
  }
}

function currentSubmission(): { player_id: string; place: number }[] {
  return fakeResults.state.results.map((row) => ({ player_id: row.playerId, place: row.place }));
}

function withSwap(a: string, b: string) {
  const rows = currentSubmission();
  const ra = rows.find((r) => r.player_id === a)!;
  const rb = rows.find((r) => r.player_id === b)!;
  [ra.place, rb.place] = [rb.place, ra.place];
  return rows;
}

function rowOf(playerId: string): FakeResultRow {
  return fakeResults.state.results.find((row) => row.playerId === playerId)!;
}

const FROZEN_NON_RATING_KEYS: (keyof FakeResultRow)[] = [
  "id",
  "tournamentId",
  "playerId",
  "seasonId",
  "reentries",
  "knockouts",
  "addons",
  "bossKnockouts",
  "freeReentries",
  "mysteryBountyPoints",
  "arrived",
  "participationPoints",
  "knockoutPoints",
  "bossBountyPoints",
  "clubDiscountPercent",
  "createdAt",
];

beforeEach(() => {
  process.env.DATABASE_PROVIDER = "postgres";
  resetFakeResultsDb();
  vi.clearAllMocks();
  authMocks.assertServerActorRole.mockResolvedValue({ id: "admin-1", role: "admin" });
  sheetMocks.batchUpdateSpreadsheetValues.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env.DATABASE_PROVIDER = originalProvider;
  vi.restoreAllMocks();
});

async function expectRejected(promise: Promise<unknown>, message: string) {
  await expect(promise).rejects.toBeInstanceOf(CompletedPlaceCorrectionRejectedError);
  await expect(promise).rejects.toThrow(message);
}

describe("authorization -- Super Admin only", () => {
  it("checks assertServerActorRole(['admin']) (not operator) before anything else", async () => {
    seedEight();
    await correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"));
    expect(authMocks.assertServerActorRole).toHaveBeenCalledWith(["admin"]);
  });

  it("a non-admin actor is rejected with zero reads/writes", async () => {
    seedEight();
    const before = resultsSnapshot();
    authMocks.assertServerActorRole.mockRejectedValue(new authMocks.ForbiddenActionError());

    await expect(
      correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"))
    ).rejects.toBeInstanceOf(authMocks.ForbiddenActionError);
    expect(resultsSnapshot()).toEqual(before);
    expect(fakeResults.state.log).toEqual([]);
    expect(achievementMocks.syncPlayerAchievements).not.toHaveBeenCalled();
  });

  it("the route is NOT on the operator allowlist (middleware denies operator)", () => {
    expect(
      isAdminRouteAllowedForOperator("POST", "/api/admin/tournaments/t1/completed-place-correction")
    ).toBe(false);
  });

  it("fails closed outside Postgres mode", async () => {
    seedEight();
    process.env.DATABASE_PROVIDER = "supabase";
    await expect(
      correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"))
    ).rejects.toBeInstanceOf(CompletedPlaceCorrectionUnavailableError);
    expect(updateStatements()).toBe(0);
  });
});

describe("tournament state", () => {
  it("rejects an open (non-completed) tournament with zero writes", async () => {
    resetFakeResultsDb({ status: "open" });
    seedEight();
    const before = resultsSnapshot();

    await expectRejected(
      correctCompletedTournamentPlaces("t1", withSwap("p7", "p8")),
      NOT_COMPLETED_MESSAGE
    );
    expect(resultsSnapshot()).toEqual(before);
    expect(updateStatements()).toBe(0);
  });

  it("throws TournamentNotFoundError for an unknown tournament", async () => {
    resetFakeResultsDb(null);
    await expect(correctCompletedTournamentPlaces("t1", [])).rejects.toBeInstanceOf(
      TournamentNotFoundError
    );
  });

  it("locks the tournament row FOR UPDATE before reading or writing results", async () => {
    seedEight();
    await correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"));
    const log = fakeResults.state.log;
    const begin = log.indexOf("tx:begin");
    expect(log[begin + 1]).toBe("lock:tournaments");
    expect(log.indexOf("select:results")).toBeGreaterThan(begin + 1);
    expect(log.at(-1)).toBe("tx:commit");
  });
});

describe("winner is pinned", () => {
  it("rejects moving the current winner off place 1, zero writes", async () => {
    seedEight();
    const before = resultsSnapshot();
    await expectRejected(
      correctCompletedTournamentPlaces("t1", withSwap("p1", "p2")),
      WINNER_PINNED_MESSAGE
    );
    expect(resultsSnapshot()).toEqual(before);
    expect(updateStatements()).toBe(0);
  });

  it("rejects a 3-way rotation that hands place 1 to someone else", async () => {
    seedEight();
    const rows = currentSubmission().map((r) =>
      r.player_id === "p1" ? { ...r, place: 3 } : r.player_id === "p3" ? { ...r, place: 1 } : r
    );
    await expectRejected(correctCompletedTournamentPlaces("t1", rows), WINNER_PINNED_MESSAGE);
    expect(updateStatements()).toBe(0);
  });
});

describe("stale / mismatching submissions are rejected with zero writes", () => {
  beforeEach(() => seedEight());

  const cases: [string, () => { player_id: string; place: number }[]][] = [
    ["missing player", () => currentSubmission().filter((r) => r.player_id !== "p5")],
    ["extra unknown player", () => [...currentSubmission(), { player_id: "ghost", place: 9 }]],
    [
      "unknown player replacing a real one",
      () => currentSubmission().map((r) => (r.player_id === "p5" ? { ...r, player_id: "ghost" } : r)),
    ],
    [
      "duplicate player",
      () => currentSubmission().map((r) => (r.player_id === "p5" ? { ...r, player_id: "p6", place: 5 } : r)),
    ],
    [
      "duplicate place",
      () => currentSubmission().map((r) => (r.player_id === "p5" ? { ...r, place: 6 } : r)),
    ],
    [
      "place number that does not exist",
      () => currentSubmission().map((r) => (r.player_id === "p8" ? { ...r, place: 9 } : r)),
    ],
    [
      "non-integer place",
      () => currentSubmission().map((r) => (r.player_id === "p8" ? { ...r, place: 7.5 } : r)),
    ],
    ["empty submission", () => []],
  ];

  it.each(cases)("%s", async (_label, build) => {
    const before = resultsSnapshot();
    await expectRejected(correctCompletedTournamentPlaces("t1", build()), STALE_RESULTS_MESSAGE);
    expect(resultsSnapshot()).toEqual(before);
    expect(updateStatements()).toBe(0);
    expect(achievementMocks.syncPlayerAchievements).not.toHaveBeenCalled();
  });
});

describe("valid corrections", () => {
  it("adjacent swap 7 <-> 8 succeeds without tripping UNIQUE(tournament_id, place)", async () => {
    seedEight();
    const result = await correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"));

    expect(rowOf("p7").place).toBe(8);
    expect(rowOf("p8").place).toBe(7);
    expect(result.changed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ player_id: "p7", display_name: "Игрок 7", old_place: 7, new_place: 8 }),
        expect.objectContaining({ player_id: "p8", display_name: "Игрок 8", old_place: 8, new_place: 7 }),
      ])
    );
    expect(result.changed).toHaveLength(2);
    const places = fakeResults.state.results.map((r) => r.place).sort((a, b) => a - b);
    expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("the fake really enforces the unique index: a naive direct swap would fail", async () => {
    // Sanity check of the test harness itself, so the test above is meaningful.
    seedEight();
    const { fakeResultsDb } = await import("./helpers/fake-results-db");
    const { results } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    await expect(
      fakeResultsDb.update(results).set({ place: 8 }).where(eq(results.id, "res-p7"))
    ).rejects.toThrow("results_tournament_id_place_key");
    await expect(
      fakeResultsDb.update(results).set({ place: -1 }).where(eq(results.id, "res-p7"))
    ).rejects.toThrow("results_place_check");
  });

  it("a bigger shuffle of places 2..8 maps to unique places", async () => {
    seedEight();
    const newPlaceOf: Record<string, number> = { p2: 8, p3: 2, p4: 7, p5: 3, p6: 6, p7: 4, p8: 5 };
    const rows = currentSubmission().map((r) => ({
      ...r,
      place: newPlaceOf[r.player_id] ?? r.place,
    }));
    const result = await correctCompletedTournamentPlaces("t1", rows);

    for (const [playerId, place] of Object.entries(newPlaceOf)) {
      expect(rowOf(playerId).place).toBe(place);
    }
    // p6 stays at 6 -> not reported as changed.
    expect(result.changed.map((c) => c.player_id).sort()).toEqual(
      ["p2", "p3", "p4", "p5", "p7", "p8"].sort()
    );
  });

  it("frozen ITM follows the PLACE, not the player", async () => {
    resetFakeResultsDb();
    for (let place = 1; place <= 6; place++) addResult(`p${place}`, place);
    addResult("p7", 7, { itmPoints: 15 });
    addResult("p8", 8, { itmPoints: 12 });

    await correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"));

    expect(rowOf("p8").place).toBe(7);
    expect(rowOf("p8").itmPoints).toBe(15);
    expect(rowOf("p7").place).toBe(8);
    expect(rowOf("p7").itmPoints).toBe(12);
  });

  it("non-rating and non-ITM breakdown columns stay byte-for-byte unchanged on every row", async () => {
    seedEight();
    const before = resultsSnapshot();
    await correctCompletedTournamentPlaces("t1", withSwap("p4", "p6"));
    const after = resultsSnapshot();

    for (const prev of before) {
      const next = after.find((r) => r.id === prev.id)!;
      for (const key of FROZEN_NON_RATING_KEYS) {
        expect(next[key]).toEqual(prev[key]);
      }
    }
    // Unchanged rows are completely untouched.
    for (const prev of before.filter((r) => r.playerId !== "p4" && r.playerId !== "p6")) {
      expect(after.find((r) => r.id === prev.id)).toEqual(prev);
    }
    // No insert/delete happened -- same row ids.
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
  });

  it("only changed rows are written (2 updates per changed row, none for unchanged)", async () => {
    seedEight();
    await correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"));
    expect(updateStatements()).toBe(4);
  });

  it("every changed row satisfies the rating breakdown invariant", async () => {
    seedEight();
    const result = await correctCompletedTournamentPlaces("t1", withSwap("p3", "p8"));
    for (const change of result.changed) {
      const row = rowOf(change.player_id);
      expect(row.ratingPoints).toBe(
        row.participationPoints! +
          row.knockoutPoints! +
          row.bossBountyPoints! +
          row.mysteryBountyPoints +
          row.itmPoints!
      );
      expect(change.rating_points).toBe(row.ratingPoints);
      expect(change.itm_points).toBe(row.itmPoints);
    }
  });

  it("total ITM and total rating across the tournament are unchanged by a permutation", async () => {
    seedEight();
    const sum = (key: "itmPoints" | "ratingPoints") =>
      fakeResults.state.results.reduce((acc, row) => acc + (row[key] ?? 0), 0);
    const itmBefore = sum("itmPoints");
    const ratingBefore = sum("ratingPoints");

    const newPlaceOf: Record<string, number> = { p2: 5, p5: 8, p8: 2 };
    await correctCompletedTournamentPlaces(
      "t1",
      currentSubmission().map((r) => ({ ...r, place: newPlaceOf[r.player_id] ?? r.place }))
    );

    expect(sum("itmPoints")).toBe(itmBefore);
    expect(sum("ratingPoints")).toBe(ratingBefore);
  });

  it("Final Month tournament: all-zero rating stays zero after a permutation", async () => {
    resetFakeResultsDb();
    for (let place = 1; place <= 5; place++) {
      addResult(`p${place}`, place, {
        participationPoints: 0,
        knockoutPoints: 0,
        bossBountyPoints: 0,
        mysteryBountyPoints: 0,
        itmPoints: 0,
      });
    }
    await correctCompletedTournamentPlaces("t1", withSwap("p2", "p5"));
    expect(rowOf("p2").place).toBe(5);
    for (const row of fakeResults.state.results) {
      expect(row.ratingPoints).toBe(0);
      expect(row.itmPoints).toBe(0);
    }
  });

  it("a submission identical to the current state is a no-op", async () => {
    seedEight();
    const before = resultsSnapshot();
    const result = await correctCompletedTournamentPlaces("t1", currentSubmission());
    expect(result.changed).toEqual([]);
    expect(resultsSnapshot()).toEqual(before);
    expect(updateStatements()).toBe(0);
    expect(achievementMocks.syncPlayerAchievements).not.toHaveBeenCalled();
  });

  it("never invokes the current rating formula", async () => {
    seedEight();
    await correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"));
    expect(ratingMocks.calculateRatingPoints).not.toHaveBeenCalled();
    expect(ratingMocks.calculateRatingPointsV2).not.toHaveBeenCalled();
    expect(ratingMocks.calculateRatingPointsForTournament).not.toHaveBeenCalled();

    // Static proof too: the module does not even import the rating modules.
    const source = readFileSync(
      path.resolve(__dirname, "../completed-tournament-place-correction.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/from\s+["']@\/features\/rating(-v2)?["']/);
  });
});

describe("transaction atomicity", () => {
  it("a failure mid-transaction (phase 2) leaves zero partial changes", async () => {
    seedEight();
    const before = resultsSnapshot();
    // 2 changed rows => updates 1-2 are phase 1 (temp), 3-4 phase 2; fail on 3.
    fakeResults.state.failOnUpdateNumber = 3;

    await expect(
      correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"))
    ).rejects.toThrow("simulated connection failure");
    expect(resultsSnapshot()).toEqual(before);
    expect(fakeResults.state.log.at(-1)).toBe("tx:rollback");
    expect(achievementMocks.syncPlayerAchievements).not.toHaveBeenCalled();
    expect(sheetMocks.batchUpdateSpreadsheetValues).not.toHaveBeenCalled();
  });
});

describe("legacy NULL breakdown fails closed", () => {
  const nullable = ["participationPoints", "knockoutPoints", "bossBountyPoints", "itmPoints"] as const;

  it.each(nullable)("moving row with NULL %s rejects the whole correction", async (key) => {
    resetFakeResultsDb();
    for (let place = 1; place <= 6; place++) addResult(`p${place}`, place);
    addResult("p7", 7, { [key]: null });
    addResult("p8", 8);
    const before = resultsSnapshot();

    await expectRejected(
      correctCompletedTournamentPlaces("t1", withSwap("p7", "p8")),
      LEGACY_BREAKDOWN_MESSAGE
    );
    expect(resultsSnapshot()).toEqual(before);
    expect(updateStatements()).toBe(0);
  });

  it("NULL on the counterpart row (whose frozen ITM would be reused) also rejects", async () => {
    resetFakeResultsDb();
    for (let place = 1; place <= 7; place++) addResult(`p${place}`, place);
    addResult("p8", 8, { itmPoints: null });
    await expectRejected(
      correctCompletedTournamentPlaces("t1", withSwap("p7", "p8")),
      LEGACY_BREAKDOWN_MESSAGE
    );
    expect(updateStatements()).toBe(0);
  });

  it("a NULL row NOT involved in any change does not block the correction", async () => {
    resetFakeResultsDb();
    for (let place = 1; place <= 4; place++) addResult(`p${place}`, place);
    addResult("p5", 5, { itmPoints: null, participationPoints: null });
    for (let place = 6; place <= 8; place++) addResult(`p${place}`, place);
    const legacyBefore = { ...rowOf("p5") };

    await correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"));
    expect(rowOf("p7").place).toBe(8);
    expect(rowOf("p5")).toEqual(legacyBefore);
  });
});

describe("post-commit side effects", () => {
  it("syncPlayerAchievements runs for each changed player only, without activity publishing", async () => {
    seedEight();
    await correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"));

    const calledFor = achievementMocks.syncPlayerAchievements.mock.calls.map((c) => c[0]).sort();
    expect(calledFor).toEqual(["p7", "p8"]);
    for (const call of achievementMocks.syncPlayerAchievements.mock.calls as unknown[][]) {
      // No options => publishActivityEvents is off.
      expect(call[1]).toBeUndefined();
    }
    expect(activityMocks.publishTournamentWinnerEvent).not.toHaveBeenCalled();
    expect(activityMocks.publishLegendaryAchievementEvent).not.toHaveBeenCalled();
    expect(achievementMocks.syncPlayersAchievementsIfEnabled).not.toHaveBeenCalled();
  });

  it("achievement resync happens only after the transaction committed", async () => {
    seedEight();
    achievementMocks.syncPlayerAchievements.mockImplementation(async () => {
      expect(fakeResults.state.log.at(-1)).toBe("tx:commit");
      return {};
    });
    await correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"));
    expect(achievementMocks.syncPlayerAchievements).toHaveBeenCalledTimes(2);
  });

  it("no sheet sync when the tournament has no linked tab", async () => {
    seedEight();
    const result = await correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"));
    expect(sheetMocks.readSpreadsheetTabValues).not.toHaveBeenCalled();
    expect(result.sheet_sync_warning).toBeUndefined();
  });
});

describe("Google Sheets best-effort sync", () => {
  function sheetValues(tournamentType: "classic" | "boss_bounty", playerIds: string[]) {
    const layout = getFreeSheetColumnLayout(tournamentType);
    const meta = Array.from({ length: 6 }, () => [] as string[]);
    // Data rows in a different order from places, to prove lookup by player_id.
    const data = playerIds.map((id) => {
      const row = layout.headers.map(() => "x");
      row[0] = id;
      return row;
    });
    return [...meta, layout.headers, ...data];
  }

  it("writes ONLY Место and Рейтинг cells of changed players, matched by player_id", async () => {
    resetFakeResultsDb({ googleSheetTabName: "Tab A", tournamentType: "classic" });
    seedEight();
    // Sheet row order: p8, p1, p2, ..., p7  -> p8 at sheet row 8, p7 at row 15.
    sheetMocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues("classic", ["p8", "p1", "p2", "p3", "p4", "p5", "p6", "p7"])
    );

    const result = await correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"));

    expect(result.sheet_sync_warning).toBeUndefined();
    expect(sheetMocks.batchUpdateSpreadsheetValues).toHaveBeenCalledTimes(1);
    const updates = sheetMocks.batchUpdateSpreadsheetValues.mock.calls[0][0] as {
      range: string;
      values: unknown[][];
    }[];
    // classic layout: Место = column M (index 12), Рейтинг = column N (index 13).
    expect(updates).toEqual([
      { range: "Tab A!M15", values: [[8]] },
      { range: "Tab A!N15", values: [[rowOf("p7").ratingPoints]] },
      { range: "Tab A!M8", values: [[7]] },
      { range: "Tab A!N8", values: [[rowOf("p8").ratingPoints]] },
    ]);
  });

  it("boss_bounty layout targets the shifted Место/Рейтинг columns", async () => {
    resetFakeResultsDb({ googleSheetTabName: "Boss", tournamentType: "boss_bounty" });
    seedEight();
    sheetMocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues("boss_bounty", ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"])
    );
    await correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"));
    const ranges = (
      sheetMocks.batchUpdateSpreadsheetValues.mock.calls[0][0] as { range: string }[]
    ).map((u) => u.range);
    expect(ranges.sort()).toEqual(["Boss!N14", "Boss!N15", "Boss!O14", "Boss!O15"]);
  });

  it("a sheet write failure never rolls back the committed DB correction", async () => {
    resetFakeResultsDb({ googleSheetTabName: "Tab A" });
    seedEight();
    sheetMocks.readSpreadsheetTabValues.mockResolvedValue(
      sheetValues("classic", ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"])
    );
    sheetMocks.batchUpdateSpreadsheetValues.mockRejectedValue(new Error("quota exceeded"));

    const result = await correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"));

    expect(result.changed).toHaveLength(2);
    expect(result.sheet_sync_warning).toBeTruthy();
    expect(rowOf("p7").place).toBe(8);
    expect(rowOf("p8").place).toBe(7);
    expect(fakeResults.state.log).not.toContain("tx:rollback");
  });

  it("a sheet read failure / unexpected layout also just warns", async () => {
    resetFakeResultsDb({ googleSheetTabName: "Tab A" });
    seedEight();
    sheetMocks.readSpreadsheetTabValues.mockResolvedValue([["garbage"]]);
    const result = await correctCompletedTournamentPlaces("t1", withSwap("p7", "p8"));
    expect(result.sheet_sync_warning).toBeTruthy();
    expect(sheetMocks.batchUpdateSpreadsheetValues).not.toHaveBeenCalled();
    expect(rowOf("p7").place).toBe(8);
  });
});

describe("POST /api/admin/tournaments/:id/completed-place-correction", () => {
  function call(body: unknown) {
    return POST(
      new Request("http://localhost/api/admin/tournaments/t1/completed-place-correction", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: "t1" }) }
    );
  }

  it("200 with the changed rows on success", async () => {
    seedEight();
    const response = await call({ rows: withSwap("p7", "p8") });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.changed).toHaveLength(2);
  });

  it.each([
    ["not json", "not-json"],
    ["missing rows", {}],
    ["rows not array", { rows: "x" }],
    ["bad player_id", { rows: [{ player_id: 1, place: 1 }] }],
    ["bad place", { rows: [{ player_id: "p1", place: "1" }] }],
  ])("400 for malformed body (%s)", async (_label, body) => {
    seedEight();
    const response = await call(body);
    expect(response.status).toBe(400);
    expect(updateStatements()).toBe(0);
  });

  it("403 for a non-admin actor", async () => {
    seedEight();
    authMocks.assertServerActorRole.mockRejectedValue(new authMocks.ForbiddenActionError());
    const response = await call({ rows: withSwap("p7", "p8") });
    expect(response.status).toBe(403);
  });

  it("401 for an unauthenticated caller", async () => {
    seedEight();
    authMocks.assertServerActorRole.mockRejectedValue(new authMocks.UnauthorizedActionError());
    const response = await call({ rows: withSwap("p7", "p8") });
    expect(response.status).toBe(401);
  });

  it("404 for an unknown tournament", async () => {
    resetFakeResultsDb(null);
    const response = await call({ rows: [] });
    expect(response.status).toBe(404);
  });

  it("409 for stale / winner-pinned / not-completed rejections", async () => {
    seedEight();
    expect((await call({ rows: withSwap("p1", "p2") })).status).toBe(409);
    expect((await call({ rows: currentSubmission().slice(1) })).status).toBe(409);
    fakeResults.state.tournament!.status = "open";
    expect((await call({ rows: withSwap("p7", "p8") })).status).toBe(409);
  });
});
