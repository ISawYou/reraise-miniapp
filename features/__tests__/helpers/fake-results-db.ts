// Stateful fake of the slice of Drizzle's `db` that
// features/completed-tournament-place-correction.ts uses -- same
// "hand-built fake tx" technique as ./fake-capacity-db.ts, but modelling ONE
// tournament row, its `results` rows and the `players` display names.
//
// Crucially it ENFORCES, on every UPDATE, the same constraints Postgres
// enforces per statement on `results`:
//   - results_tournament_id_place_key  UNIQUE(tournament_id, place)
//   - results_place_check              place > 0
//   - results_rating_points_breakdown_check (NULL-tolerant, like Postgres)
// so a naive pairwise place swap (or a negative temp place) fails here the
// same way it would against the real database, and the module's two-phase
// write is genuinely exercised. A transaction that throws is rolled back.
//
// Also models the completion tail of
// features/tournament-completion-commit.ts: DELETE/INSERT on `results`
// (INSERT enforces the same constraints, plus
// UNIQUE(tournament_id, player_id)), UPDATE on `registrations` (status) and
// UPDATE on `tournaments` (status). Rollback restores all three.
import { Param, SQL } from "drizzle-orm";
import { players, registrations, results, tournaments } from "@/lib/db/schema";

export type FakeResultRow = {
  id: string;
  tournamentId: string;
  playerId: string;
  seasonId: string | null;
  place: number;
  reentries: number;
  knockouts: number;
  addons: number;
  bossKnockouts: number;
  freeReentries: number;
  mysteryBountyPoints: number;
  ratingPoints: number;
  arrived: boolean | null;
  participationPoints: number | null;
  knockoutPoints: number | null;
  bossBountyPoints: number | null;
  itmPoints: number | null;
  clubDiscountPercent: number;
  createdAt: Date;
};

export type FakeTournament = {
  id: string;
  status: string;
  kind: string;
  tournamentType: string;
  googleSheetTabName: string | null;
};

export type FakeRegistration = {
  id: string;
  tournamentId: string;
  playerId: string;
  status: string;
};

export type FakeResultsState = {
  tournament: FakeTournament | null;
  results: FakeResultRow[];
  registrations: FakeRegistration[];
  displayNames: Map<string, string>;
  // "tx:begin", "lock:tournaments", "select:results", "update:results", ...
  log: string[];
  // When set, the Nth (1-based) UPDATE statement throws -- simulates a
  // mid-transaction failure.
  failOnUpdateNumber: number | null;
  updateCount: number;
};

export const fakeResults: { state: FakeResultsState } = { state: emptyState() };

function emptyState(): FakeResultsState {
  return {
    tournament: {
      id: "t1",
      status: "completed",
      kind: "free",
      tournamentType: "classic",
      googleSheetTabName: null,
    },
    results: [],
    registrations: [],
    displayNames: new Map(),
    log: [],
    failOnUpdateNumber: null,
    updateCount: 0,
  };
}

export function resetFakeResultsDb(tournament: Partial<FakeTournament> | null = {}) {
  const base = emptyState();
  fakeResults.state = {
    ...base,
    tournament: tournament === null ? null : { ...base.tournament!, ...tournament },
  };
  return fakeResults.state;
}

export function addResult(
  playerId: string,
  place: number,
  breakdown: {
    participationPoints?: number | null;
    knockoutPoints?: number | null;
    bossBountyPoints?: number | null;
    mysteryBountyPoints?: number;
    itmPoints?: number | null;
    knockouts?: number;
    reentries?: number;
    displayName?: string;
  } = {}
): FakeResultRow {
  const participationPoints =
    breakdown.participationPoints === undefined ? 10 : breakdown.participationPoints;
  const knockoutPoints = breakdown.knockoutPoints === undefined ? 2 * place : breakdown.knockoutPoints;
  const bossBountyPoints = breakdown.bossBountyPoints === undefined ? 1 : breakdown.bossBountyPoints;
  const mysteryBountyPoints = breakdown.mysteryBountyPoints ?? 3;
  const itmPoints = breakdown.itmPoints === undefined ? 100 - place * 5 : breakdown.itmPoints;
  const components = [participationPoints, knockoutPoints, bossBountyPoints, itmPoints];
  const ratingPoints = components.some((v) => v == null)
    ? 999 // legacy row: arbitrary historical value, breakdown unknown
    : (participationPoints as number) +
      (knockoutPoints as number) +
      (bossBountyPoints as number) +
      mysteryBountyPoints +
      (itmPoints as number);

  const row: FakeResultRow = {
    id: `res-${playerId}`,
    tournamentId: fakeResults.state.tournament?.id ?? "t1",
    playerId,
    seasonId: "s1",
    place,
    reentries: breakdown.reentries ?? 1 + (place % 3),
    knockouts: breakdown.knockouts ?? place,
    addons: place % 2,
    bossKnockouts: place % 4,
    freeReentries: place % 2,
    mysteryBountyPoints,
    ratingPoints,
    arrived: true,
    participationPoints,
    knockoutPoints,
    bossBountyPoints,
    itmPoints,
    clubDiscountPercent: place % 3 === 0 ? 10 : 0,
    createdAt: new Date("2026-09-01T00:00:00Z"),
  };
  fakeResults.state.results.push(row);
  fakeResults.state.displayNames.set(playerId, breakdown.displayName ?? `Name-${playerId}`);
  return row;
}

export function addRegistration(playerId: string, status = "registered"): FakeRegistration {
  const row: FakeRegistration = {
    id: `reg-${playerId}`,
    tournamentId: fakeResults.state.tournament?.id ?? "t1",
    playerId,
    status,
  };
  fakeResults.state.registrations.push(row);
  return row;
}

// Every write statement the fake has seen (any table).
export function writeStatements(): string[] {
  return fakeResults.state.log.filter((entry) => /^(update|insert|delete):/.test(entry));
}

export function resultsSnapshot(): FakeResultRow[] {
  return fakeResults.state.results.map((row) => ({ ...row, createdAt: new Date(row.createdAt) }));
}

export function updateStatements(): number {
  return fakeResults.state.log.filter((entry) => entry === "update:results").length;
}

function collectParams(chunk: unknown, out: unknown[] = []): unknown[] {
  if (chunk instanceof Param) {
    out.push(chunk.value);
  } else if (chunk instanceof SQL) {
    for (const inner of chunk.queryChunks) collectParams(inner, out);
  } else if (Array.isArray(chunk)) {
    for (const inner of chunk) collectParams(inner, out);
  }
  return out;
}

function tableName(table: unknown): string {
  if (table === tournaments) return "tournaments";
  if (table === results) return "results";
  if (table === players) return "players";
  if (table === registrations) return "registrations";
  return "unknown";
}

function selectRows(table: unknown, cond: unknown): unknown[] {
  const state = fakeResults.state;
  const params = collectParams(cond);
  if (table === tournaments) {
    return state.tournament && params.includes(state.tournament.id) ? [{ ...state.tournament }] : [];
  }
  if (table === results) {
    return state.results
      .filter((row) => params.includes(row.tournamentId))
      .map((row) => ({ ...row }));
  }
  if (table === players) {
    return Array.from(state.displayNames.entries())
      .filter(([id]) => params.includes(id))
      .map(([id, displayName]) => ({ id, displayName }));
  }
  throw new Error("fake-results-db: unexpected table in select");
}

function assertConstraints(row: FakeResultRow) {
  const state = fakeResults.state;
  if (!(row.place > 0)) {
    throw new Error('new row for relation "results" violates check constraint "results_place_check"');
  }
  const clash = state.results.find(
    (other) => other !== row && other.tournamentId === row.tournamentId && other.place === row.place
  );
  if (clash) {
    throw new Error(
      'duplicate key value violates unique constraint "results_tournament_id_place_key"'
    );
  }
  const playerClash = state.results.find(
    (other) =>
      other !== row && other.tournamentId === row.tournamentId && other.playerId === row.playerId
  );
  if (playerClash) {
    throw new Error(
      'duplicate key value violates unique constraint "results_tournament_id_player_id_key"'
    );
  }
  const parts = [row.participationPoints, row.knockoutPoints, row.bossBountyPoints, row.itmPoints];
  if (parts.every((v) => v != null)) {
    const sum = (parts as number[]).reduce((a, b) => a + b, 0) + row.mysteryBountyPoints;
    if (sum !== row.ratingPoints) {
      throw new Error(
        'new row for relation "results" violates check constraint "results_rating_points_breakdown_check"'
      );
    }
  }
}

function makeExecutor() {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          let locked = false;
          const run = () => {
            fakeResults.state.log.push(`${locked ? "lock" : "select"}:${tableName(table)}`);
            return Promise.resolve(selectRows(table, cond));
          };
          return {
            for: (mode: string) => {
              locked = mode === "update";
              return run();
            },
            then: (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) =>
              run().then(resolve, reject),
          };
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Partial<FakeResultRow>) => ({
        where: (cond: unknown) => {
          const state = fakeResults.state;
          state.log.push(`update:${tableName(table)}`);
          state.updateCount += 1;
          if (state.failOnUpdateNumber === state.updateCount) {
            return Promise.reject(new Error("simulated connection failure"));
          }
          const params = collectParams(cond);
          if (table === tournaments) {
            if (state.tournament && params.includes(state.tournament.id)) {
              Object.assign(state.tournament, values);
            }
            return Promise.resolve();
          }
          if (table === registrations) {
            for (const reg of state.registrations) {
              if (
                params.includes(reg.tournamentId) &&
                params.includes(reg.playerId) &&
                params.includes(reg.status)
              ) {
                Object.assign(reg, values);
              }
            }
            return Promise.resolve();
          }
          if (table !== results) {
            return Promise.reject(new Error("fake-results-db: unexpected table in update"));
          }
          const targets = state.results.filter((row) => params.includes(row.id));
          try {
            for (const row of targets) {
              const previous = { ...row };
              Object.assign(row, values);
              try {
                assertConstraints(row);
              } catch (error) {
                Object.assign(row, previous);
                throw error;
              }
            }
          } catch (error) {
            return Promise.reject(error);
          }
          return Promise.resolve();
        },
      }),
    }),
    insert: (table: unknown) => {
      if (table !== results) {
        throw new Error("fake-results-db: unexpected table in insert");
      }
      return {
        values: (values: Array<Partial<FakeResultRow>>) => {
          const state = fakeResults.state;
          state.log.push("insert:results");
          try {
            for (const value of values) {
              const row = {
                id: `res-${value.playerId}-inserted`,
                seasonId: null,
                reentries: 0,
                knockouts: 0,
                addons: 0,
                bossKnockouts: 0,
                freeReentries: 0,
                mysteryBountyPoints: 0,
                arrived: null,
                participationPoints: null,
                knockoutPoints: null,
                bossBountyPoints: null,
                itmPoints: null,
                clubDiscountPercent: 0,
                createdAt: new Date("2026-10-10T00:00:00Z"),
                ...value,
              } as FakeResultRow;
              state.results.push(row);
              assertConstraints(row);
            }
          } catch (error) {
            return Promise.reject(error);
          }
          return Promise.resolve();
        },
      };
    },
    delete: (table: unknown) => {
      if (table !== results) {
        throw new Error("fake-results-db: unexpected table in delete");
      }
      return {
        where: (cond: unknown) => {
          const state = fakeResults.state;
          state.log.push("delete:results");
          const params = collectParams(cond);
          state.results = state.results.filter((row) => !params.includes(row.tournamentId));
          return Promise.resolve();
        },
      };
    },
  };
}

export const fakeResultsDb = {
  ...makeExecutor(),
  transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const state = fakeResults.state;
    state.log.push("tx:begin");
    const before = state.results.map((row) => ({ ...row }));
    const registrationsBefore = state.registrations.map((row) => ({ ...row }));
    const tournamentBefore = state.tournament ? { ...state.tournament } : null;
    try {
      const value = await fn(makeExecutor());
      state.log.push("tx:commit");
      return value;
    } catch (error) {
      state.results = before;
      state.registrations = registrationsBefore;
      state.tournament = tournamentBefore;
      state.log.push("tx:rollback");
      throw error;
    }
  },
};
