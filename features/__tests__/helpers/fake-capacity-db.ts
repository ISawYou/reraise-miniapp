// Stateful fake of the slice of Drizzle's `db` that
// features/tournament-waitlist-capacity.ts uses -- same "hand-built fake tx"
// technique as features/__tests__/teams.test.ts and
// lib/__tests__/player-merge.test.ts, but backed by an in-memory model of
// ONE tournament (registrations, eliminations, late-registration snapshot)
// instead of canned per-call responses, so multi-step scenarios (eliminate
// -> promote -> register -> ...) can be driven end-to-end against the REAL
// capacity logic.
//
// What it models: every select returns the current in-memory rows (copies,
// so the module can't mutate state without an explicit write); writes apply
// to the model; a transaction that throws is rolled back; and transactions
// run strictly one at a time (a mutex), standing in for the real
// `SELECT ... FOR UPDATE` tournament-row lock that every capacity
// transaction takes first. What it deliberately does NOT prove: that the
// real Postgres row lock serializes concurrent transactions this way --
// that is standard, well-understood Postgres behavior (same caveat as
// teams.test.ts), and the module's own lock-first ordering is asserted via
// `log` instead.
import { Param, SQL } from "drizzle-orm";
import {
  players,
  registrations,
  tournamentAttendance,
  tournamentLateRegistration,
  tournamentMysteryBounty,
  tournamentPlayerEliminations,
  tournaments,
} from "@/lib/db/schema";

export type FakeRegistration = {
  id: string;
  playerId: string;
  tournamentId: string;
  status: string;
  createdAt: Date;
  // No-show waitlist policy columns (registrations.no_show_at /
  // waitlist_promotion_notification_claimed_at).
  noShowAt?: Date | null;
  waitlistPromotionNotificationClaimedAt?: Date | null;
};

// players.online_registration_restricted_at / telegram_id, for the
// no-show waitlist policy. A player absent from the map is unrestricted
// and has no telegram_id.
export type FakePlayer = {
  restrictedAt: Date | null;
  telegramId: number | null;
  // Set only for players CREATED through the fake (walk-in insert).
  displayName?: string;
};

export type FakeLateRegistrationSnapshot = {
  tournamentId: string;
  arrivedPlayersCount: number;
  initialStacksCount: number;
  totalEntriesCount: number;
  rebuysCount: number;
  addonsCount: number;
  tournamentType: string;
  ratingFormulaVersion: string;
  ratingGuarantee: number | null;
  ratingPlaces: unknown[];
  closedAt: Date;
};

export type FakeCapacityState = {
  tournamentId: string;
  maxPlayers: number;
  tournamentExists: boolean;
  // Simple open/closed flag -- sufficient for capacity tests that only
  // care whether promotion is allowed, not the snapshot's content.
  lateRegistrationClosed: boolean;
  // The full snapshot row once Late Registration is closed via
  // closeTournamentLateRegistration, or null while open/not yet set. When
  // set, its presence also implies `lateRegistrationClosed`. Kept separate
  // from the boolean above so simple capacity tests can keep setting just
  // the boolean without having to fabricate a full row.
  lateRegistrationSnapshot: FakeLateRegistrationSnapshot | null;
  // The Mystery Bounty envelope snapshot row, or null while unset --
  // modeled the same way as lateRegistrationSnapshot above, for the
  // shared-lock tests in late-registration.test.ts.
  mysteryBountySnapshot: Record<string, unknown> | null;
  registrations: FakeRegistration[];
  eliminations: Map<string, boolean>;
  players: Map<string, FakePlayer>;
  attendance: Map<string, { arrived: boolean; arrivedAt: Date | null }>;
  // Tournament meta read by the no-show/admission actions.
  title: string;
  startAt: Date;
  status: string;
  isFinal: boolean;
  // Every statement, in order: "tx:begin", "lock:tournaments",
  // "select:registrations", "update:registrations", ... -- used to assert
  // lock-first ordering.
  log: string[];
};

let seq = 0;
let clock = Date.parse("2026-01-01T00:00:00Z");

export const fake: { state: FakeCapacityState } = {
  state: emptyState(),
};

function emptyState(): FakeCapacityState {
  return {
    tournamentId: "t1",
    maxPlayers: 40,
    tournamentExists: true,
    lateRegistrationClosed: false,
    lateRegistrationSnapshot: null,
    mysteryBountySnapshot: null,
    registrations: [],
    eliminations: new Map(),
    players: new Map(),
    attendance: new Map(),
    title: "Турнир",
    startAt: new Date("2026-01-01T00:00:00Z"),
    status: "open",
    isFinal: false,
    log: [],
  };
}

export function resetFakeCapacityDb(
  overrides: Partial<
    Omit<
      FakeCapacityState,
      | "registrations"
      | "eliminations"
      | "log"
      | "lateRegistrationSnapshot"
      | "mysteryBountySnapshot"
      | "players"
      | "attendance"
    >
  > = {}
) {
  seq = 0;
  clock = Date.parse("2026-01-01T00:00:00Z");
  fake.state = { ...emptyState(), ...overrides };
  return fake.state;
}

// Adds a registration with a strictly increasing created_at (FIFO order =
// insertion order unless `createdAt` is given explicitly).
export function addRegistration(
  playerId: string,
  status: string,
  createdAt?: Date
): FakeRegistration {
  const row: FakeRegistration = {
    id: `reg-${playerId}`,
    playerId,
    tournamentId: fake.state.tournamentId,
    status,
    createdAt: createdAt ?? new Date((clock += 60_000)),
  };
  fake.state.registrations.push(row);
  return row;
}

export function seedRegistrations(prefix: string, count: number, status: string) {
  for (let i = 1; i <= count; i++) {
    addRegistration(`${prefix}${i}`, status);
  }
}

export function eliminate(playerId: string, eliminated = true) {
  fake.state.eliminations.set(playerId, eliminated);
}

export function setPlayer(playerId: string, patch: Partial<FakePlayer>) {
  const current = fake.state.players.get(playerId) ?? { restrictedAt: null, telegramId: null };
  fake.state.players.set(playerId, { ...current, ...patch });
}

export function restrict(playerId: string, at = new Date("2026-01-01T00:00:00Z")) {
  setPlayer(playerId, { restrictedAt: at });
}

export function isRestricted(playerId: string): boolean {
  return fake.state.players.get(playerId)?.restrictedAt != null;
}

export function registrationOf(playerId: string): FakeRegistration | undefined {
  return fake.state.registrations.find((row) => row.playerId === playerId);
}

export function statusOf(playerId: string): string | undefined {
  return fake.state.registrations.find((row) => row.playerId === playerId)?.status;
}

// Ground truth, computed independently of the module under test.
export function seatedCount(): number {
  return fake.state.registrations.filter(
    (row) =>
      (row.status === "registered" || row.status === "attended") &&
      fake.state.eliminations.get(row.playerId) !== true
  ).length;
}

// Collects bound parameter values from a Drizzle condition (eq/inArray/and)
// -- only recurses through SQL chunks and arrays, never into Column/Table
// objects (which are cyclic).
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

function selectRows(table: unknown): unknown[] {
  const state = fake.state;
  if (table === tournaments) {
    return state.tournamentExists
      ? [
          {
            id: state.tournamentId,
            maxPlayers: state.maxPlayers,
            title: state.title,
            startAt: new Date(state.startAt),
            status: state.status,
            isFinal: state.isFinal,
          },
        ]
      : [];
  }
  if (table === players) {
    return Array.from(state.players.entries()).map(([id, player]) => ({
      id,
      restrictedAt: player.restrictedAt,
      telegramId: player.telegramId,
    }));
  }
  if (table === tournamentAttendance) {
    return Array.from(state.attendance.entries()).map(([playerId, row]) => ({
      playerId,
      arrived: row.arrived,
      arrivedAt: row.arrivedAt,
    }));
  }
  if (table === tournamentLateRegistration) {
    if (state.lateRegistrationSnapshot) return [{ ...state.lateRegistrationSnapshot }];
    return state.lateRegistrationClosed ? [{ tournamentId: state.tournamentId }] : [];
  }
  if (table === tournamentMysteryBounty) {
    return state.mysteryBountySnapshot ? [{ ...state.mysteryBountySnapshot }] : [];
  }
  if (table === registrations) {
    return state.registrations.map((row) => ({
      id: row.id,
      playerId: row.playerId,
      status: row.status,
      createdAt: new Date(row.createdAt),
      noShowAt: row.noShowAt ?? null,
      waitlistPromotionNotificationClaimedAt: row.waitlistPromotionNotificationClaimedAt ?? null,
    }));
  }
  if (table === tournamentPlayerEliminations) {
    return Array.from(state.eliminations.entries()).map(([playerId, eliminated]) => ({
      playerId,
      eliminated,
    }));
  }
  throw new Error("fake-capacity-db: unexpected table in select");
}

function tableName(table: unknown): string {
  if (table === tournaments) return "tournaments";
  if (table === tournamentLateRegistration) return "tournament_late_registration";
  if (table === tournamentMysteryBounty) return "tournament_mystery_bounty";
  if (table === registrations) return "registrations";
  if (table === tournamentPlayerEliminations) return "tournament_player_eliminations";
  if (table === players) return "players";
  if (table === tournamentAttendance) return "tournament_attendance";
  return "unknown";
}

function makeExecutor() {
  return {
    select: () => ({
      from: (table: unknown) => ({
        // registrations INNER JOIN players -- only the promotion
        // notification dispatcher's recipient lookup uses this shape.
        innerJoin: () => ({
          where: (cond: unknown) => {
            fake.state.log.push(`select:${tableName(table)}+players`);
            const params = collectParams(cond);
            return Promise.resolve(
              fake.state.registrations
                .filter((row) => params.includes(row.id))
                .map((row) => ({
                  registrationId: row.id,
                  telegramId: fake.state.players.get(row.playerId)?.telegramId ?? null,
                }))
            );
          },
        }),
        where: () => {
          let locked = false;
          const run = () => {
            fake.state.log.push(`${locked ? "lock" : "select"}:${tableName(table)}`);
            return Promise.resolve(selectRows(table));
          };
          const thenable = {
            for: (mode: string) => {
              locked = mode === "update";
              return run();
            },
            limit: () => run(),
            then: (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) =>
              run().then(resolve, reject),
          };
          return thenable;
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          fake.state.log.push(`update:${tableName(table)}`);
          const params = collectParams(cond);
          if (table === players) {
            for (const [id, player] of fake.state.players.entries()) {
              if (params.includes(id) && "onlineRegistrationRestrictedAt" in values) {
                player.restrictedAt = (values.onlineRegistrationRestrictedAt as Date | null) ?? null;
              }
            }
            for (const id of params) {
              if (
                typeof id === "string" &&
                !fake.state.players.has(id) &&
                values.onlineRegistrationRestrictedAt != null &&
                fake.state.registrations.some((row) => row.playerId === id)
              ) {
                fake.state.players.set(id, {
                  restrictedAt: values.onlineRegistrationRestrictedAt as Date,
                  telegramId: null,
                });
              }
            }
            return Promise.resolve();
          }
          const requiresWaitlist = params.includes("waitlist");
          const requiresRegistered = params.includes("registered");
          // The notification claim is only ever written `WHERE ... IS NULL`.
          const isClaim = "waitlistPromotionNotificationClaimedAt" in values;
          for (const row of fake.state.registrations) {
            if (!params.includes(row.id)) continue;
            if (requiresWaitlist && row.status !== "waitlist") continue;
            if (requiresRegistered && row.status !== "registered") continue;
            if (isClaim && row.waitlistPromotionNotificationClaimedAt != null) continue;
            if ("status" in values) row.status = values.status as string;
            if ("noShowAt" in values) row.noShowAt = (values.noShowAt as Date | null) ?? null;
            if (isClaim) {
              row.waitlistPromotionNotificationClaimedAt =
                (values.waitlistPromotionNotificationClaimedAt as Date | null) ?? null;
            }
          }
          return Promise.resolve();
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        fake.state.log.push(`insert:${tableName(table)}`);
        if (table === registrations) {
          const row: FakeRegistration = {
            id: `reg-new-${++seq}`,
            playerId: values.playerId as string,
            tournamentId: values.tournamentId as string,
            status: values.status as string,
            createdAt: new Date((clock += 60_000)),
          };
          if (fake.state.registrations.some((r) => r.playerId === row.playerId)) {
            throw new Error("duplicate key value violates unique constraint");
          }
          fake.state.registrations.push(row);
          return { returning: () => Promise.resolve([{ ...row }]) };
        }
        if (table === players) {
          const id = `player-new-${++seq}`;
          fake.state.players.set(id, {
            restrictedAt: null,
            telegramId: (values.telegramId as number | null) ?? null,
            displayName: values.displayName as string,
          });
          return { returning: () => Promise.resolve([{ id }]) };
        }
        if (table === tournamentAttendance) {
          return {
            onConflictDoUpdate: () => {
              const playerId = values.playerId as string;
              const existing = fake.state.attendance.get(playerId);
              fake.state.attendance.set(playerId, {
                arrived: values.arrived as boolean,
                arrivedAt: existing?.arrivedAt ?? ((values.arrivedAt as Date | null) ?? null),
              });
              return Promise.resolve();
            },
          };
        }
        if (table === tournamentPlayerEliminations) {
          return {
            onConflictDoUpdate: () => {
              fake.state.eliminations.set(values.playerId as string, values.eliminated as boolean);
              return Promise.resolve();
            },
          };
        }
        if (table === tournamentLateRegistration) {
          return {
            onConflictDoNothing: () => ({
              returning: () => {
                if (fake.state.lateRegistrationSnapshot) {
                  // Lost the race under our own mutex-serialized "lock" --
                  // shouldn't happen in practice since the lock makes this
                  // branch unreachable, but mirrors onConflictDoNothing's
                  // real semantics if it ever did.
                  return Promise.resolve([]);
                }
                const row: FakeLateRegistrationSnapshot = {
                  tournamentId: values.tournamentId as string,
                  arrivedPlayersCount: values.arrivedPlayersCount as number,
                  initialStacksCount: values.initialStacksCount as number,
                  totalEntriesCount: values.totalEntriesCount as number,
                  rebuysCount: values.rebuysCount as number,
                  addonsCount: values.addonsCount as number,
                  tournamentType: values.tournamentType as string,
                  ratingFormulaVersion: values.ratingFormulaVersion as string,
                  ratingGuarantee: (values.ratingGuarantee as number | null) ?? null,
                  ratingPlaces: (values.ratingPlaces as unknown[]) ?? [],
                  closedAt: new Date((clock += 60_000)),
                };
                fake.state.lateRegistrationSnapshot = row;
                fake.state.lateRegistrationClosed = true;
                return Promise.resolve([{ ...row }]);
              },
            }),
          };
        }
        if (table === tournamentMysteryBounty) {
          return {
            onConflictDoNothing: () => ({
              returning: () => {
                if (fake.state.mysteryBountySnapshot) {
                  return Promise.resolve([]);
                }
                const row = { ...values, closedAt: new Date((clock += 60_000)), activatedAt: null, recalculatedAt: null };
                fake.state.mysteryBountySnapshot = row;
                return Promise.resolve([{ ...row }]);
              },
            }),
          };
        }
        throw new Error("fake-capacity-db: unexpected table in insert");
      },
    }),
  };
}

function snapshot(state: FakeCapacityState) {
  return {
    registrations: state.registrations.map((row) => ({ ...row })),
    eliminations: new Map(state.eliminations),
    players: new Map(Array.from(state.players.entries()).map(([id, p]) => [id, { ...p }])),
    attendance: new Map(Array.from(state.attendance.entries()).map(([id, a]) => [id, { ...a }])),
    lateRegistrationClosed: state.lateRegistrationClosed,
    lateRegistrationSnapshot: state.lateRegistrationSnapshot
      ? { ...state.lateRegistrationSnapshot }
      : null,
    mysteryBountySnapshot: state.mysteryBountySnapshot ? { ...state.mysteryBountySnapshot } : null,
  };
}

let txQueue: Promise<unknown> = Promise.resolve();

export const fakeDb = {
  ...makeExecutor(),
  transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const run = async () => {
      fake.state.log.push("tx:begin");
      const before = snapshot(fake.state);
      try {
        return await fn(makeExecutor());
      } catch (error) {
        fake.state.registrations = before.registrations;
        fake.state.eliminations = before.eliminations;
        fake.state.players = before.players;
        fake.state.attendance = before.attendance;
        fake.state.lateRegistrationClosed = before.lateRegistrationClosed;
        fake.state.lateRegistrationSnapshot = before.lateRegistrationSnapshot;
        fake.state.mysteryBountySnapshot = before.mysteryBountySnapshot;
        fake.state.log.push("tx:rollback");
        throw error;
      }
    };
    const result = txQueue.then(run, run);
    txQueue = result.catch(() => undefined);
    return result;
  },
};
