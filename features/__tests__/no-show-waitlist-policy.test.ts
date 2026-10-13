import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addRegistration,
  eliminate,
  fake,
  isRestricted,
  registrationOf,
  resetFakeCapacityDb,
  restrict,
  seatedCount,
  seedRegistrations,
  setPlayer,
  statusOf,
} from "./helpers/fake-capacity-db";

// The no-show waitlist policy, driven end-to-end against the REAL
// features/tournament-waitlist-capacity.ts (the ONE reconciler + the new
// "Не пришёл" / "Допустить в игру" / arrival operations) AND the REAL
// features/tournament-promotion-notification.ts dispatcher, over the
// stateful fake `db` (see ./helpers/fake-capacity-db.ts for what the fake
// does and does not prove -- the real-Postgres lock behavior is covered by
// no-show-waitlist-policy.postgres.integration.test.ts). Only the Telegram
// transport itself is mocked.
const telegram = vi.hoisted(() => ({
  send: vi.fn<(params: { telegramId: number; text: string; tournamentId: string }) => Promise<boolean>>(
    async () => true
  ),
}));

vi.mock("@/lib/db", async () => ({
  db: (await import("./helpers/fake-capacity-db")).fakeDb,
}));
vi.mock("@/lib/telegram-bot-notify", () => ({
  sendTournamentPromotionTelegramNotification: telegram.send,
  sendTeamsTelegramNotification: vi.fn(),
}));

const capacity = await import("@/features/tournament-waitlist-capacity");
const {
  ADMISSION_NO_SEAT_MESSAGE,
  admitPlayerToTournament,
  admitWaitlistedRegistrationWithinCapacity,
  clearOnlineRegistrationRestrictionOnArrival,
  markRegistrationNoShowWithinCapacity,
  reconcileTournamentWaitlistCapacity,
  TournamentRosterActionError,
} = capacity;
const { buildWaitlistPromotionMessage } = await import("@/features/tournament-promotion-notification");

const originalProvider = process.env.DATABASE_PROVIDER;
const STARTED = new Date(Date.now() - 60 * 60 * 1000); // started an hour ago
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

beforeEach(() => {
  process.env.DATABASE_PROVIDER = "postgres";
  resetFakeCapacityDb({ maxPlayers: 40 });
  fake.state.startAt = STARTED;
  telegram.send.mockReset();
  telegram.send.mockResolvedValue(true);
});

afterEach(() => {
  process.env.DATABASE_PROVIDER = originalProvider;
});

function waitlistCount() {
  return fake.state.registrations.filter((row) => row.status === "waitlist").length;
}

// ---------------------------------------------------------------------------
// Auto promotion -- restricted candidates are skipped, never removed
// ---------------------------------------------------------------------------

describe("auto promotion skips restricted waitlist players (the ONE reconciler)", () => {
  it("queue [A restricted, B, C], one free seat => B promoted, A stays waitlist, C stays behind B", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("A", "waitlist");
    addRegistration("B", "waitlist");
    addRegistration("C", "waitlist");
    restrict("A");
    const aCreatedAt = registrationOf("A")!.createdAt.getTime();
    eliminate("p1");

    const result = await reconcileTournamentWaitlistCapacity("t1");

    expect(result.promotedPlayerIds).toEqual(["B"]);
    expect(statusOf("A")).toBe("waitlist");
    expect(statusOf("B")).toBe("registered");
    expect(statusOf("C")).toBe("waitlist");
    // queue position untouched, still in the waitlist, still restricted
    expect(registrationOf("A")!.createdAt.getTime()).toBe(aCreatedAt);
    expect(isRestricted("A")).toBe(true);
    expect(seatedCount()).toBe(40);
  });

  it("two free seats => B AND C promoted (FIFO among eligible), A remains waitlist", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("A", "waitlist");
    addRegistration("B", "waitlist");
    addRegistration("C", "waitlist");
    restrict("A");
    eliminate("p1");
    eliminate("p2");

    const result = await reconcileTournamentWaitlistCapacity("t1");

    expect(result.promotedPlayerIds).toEqual(["B", "C"]);
    expect(statusOf("A")).toBe("waitlist");
    expect(seatedCount()).toBe(40);
  });

  it("FIFO among eligible stays correct regardless of insertion order; restricted rows anywhere never block later eligible ones", async () => {
    seedRegistrations("p", 40, "registered");
    const t = (m: number) => new Date(Date.parse("2026-05-01T10:00:00Z") + m * 60_000);
    addRegistration("E4", "waitlist", t(4));
    addRegistration("R1", "waitlist", t(1));
    addRegistration("E2", "waitlist", t(2));
    addRegistration("R3", "waitlist", t(3));
    addRegistration("E5", "waitlist", t(5));
    restrict("R1");
    restrict("R3");
    eliminate("p1");
    eliminate("p2");

    const result = await reconcileTournamentWaitlistCapacity("t1");

    expect(result.promotedPlayerIds).toEqual(["E2", "E4"]);
    expect(statusOf("E5")).toBe("waitlist");
    expect(statusOf("R1")).toBe("waitlist");
    expect(statusOf("R3")).toBe("waitlist");
  });

  it("only restricted players waiting + free seats => nobody promoted, no overflow", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("A", "waitlist");
    restrict("A");
    eliminate("p1");

    const result = await reconcileTournamentWaitlistCapacity("t1");

    expect(result.promotedPlayerIds).toEqual([]);
    expect(statusOf("A")).toBe("waitlist");
    expect(seatedCount()).toBe(39);
  });

  it("Late Registration closed => no promotion at all (unchanged behavior)", async () => {
    fake.state.lateRegistrationClosed = true;
    seedRegistrations("p", 40, "registered");
    addRegistration("A", "waitlist");
    addRegistration("B", "waitlist");
    restrict("A");
    eliminate("p1");

    const result = await reconcileTournamentWaitlistCapacity("t1");

    expect(result.promotedPlayerIds).toEqual([]);
    expect(statusOf("B")).toBe("waitlist");
  });

  it("an elimination freeing a seat still skips the restricted player (eligible B promoted)", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("A", "waitlist");
    addRegistration("B", "waitlist");
    restrict("A");
    eliminate("p9");

    await reconcileTournamentWaitlistCapacity("t1");

    expect(statusOf("A")).toBe("waitlist");
    expect(statusOf("B")).toBe("registered");
  });

  it("Final Month (is_final) is outside the policy: a restricted player there is NOT skipped", async () => {
    fake.state.isFinal = true;
    seedRegistrations("p", 40, "registered");
    addRegistration("A", "waitlist");
    restrict("A");
    eliminate("p1");

    const result = await reconcileTournamentWaitlistCapacity("t1");

    expect(result.promotedPlayerIds).toEqual(["A"]);
  });
});

// ---------------------------------------------------------------------------
// Self-registration rule (admitPlayerToTournament, used by
// registerPlayerForTournament)
// ---------------------------------------------------------------------------

describe("restricted self-registration always lands in the waitlist", () => {
  it("unrestricted + free seat => registered, result shape unchanged (no policy flag)", async () => {
    seedRegistrations("p", 10, "registered");

    const reg = await admitPlayerToTournament("t1", "normal");

    expect(reg.status).toBe("registered");
    expect(reg).not.toHaveProperty("online_registration_restricted");
  });

  it("restricted + free seat (even 0/40) => waitlist, flagged for the UI", async () => {
    restrict("r");

    const reg = await admitPlayerToTournament("t1", "r");

    expect(reg.status).toBe("waitlist");
    expect(reg.online_registration_restricted).toBe(true);
    expect(seatedCount()).toBe(0);
  });

  it("restricted + full tournament => waitlist", async () => {
    seedRegistrations("p", 40, "registered");
    restrict("r");

    const reg = await admitPlayerToTournament("t1", "r");

    expect(reg.status).toBe("waitlist");
  });

  it("restricted player registering again while already waitlisted stays waitlisted, even with a free seat", async () => {
    seedRegistrations("p", 39, "registered");
    addRegistration("r", "waitlist");
    restrict("r");

    const reg = await admitPlayerToTournament("t1", "r");

    expect(reg.status).toBe("waitlist");
    expect(seatedCount()).toBe(39);
  });

  it("an existing REGISTERED seat from before the restriction is preserved untouched", async () => {
    addRegistration("r", "registered");
    restrict("r");

    const reg = await admitPlayerToTournament("t1", "r");

    expect(reg.status).toBe("registered");
    expect(statusOf("r")).toBe("registered");
  });

  it("a reactivated (previously cancelled) restricted row comes back as waitlist", async () => {
    addRegistration("r", "cancelled");
    restrict("r");

    const reg = await admitPlayerToTournament("t1", "r");

    expect(reg).toMatchObject({ id: "reg-r", status: "waitlist" });
  });

  it("a restricted waitlist row never blocks a newcomer from a free seat", async () => {
    seedRegistrations("p", 39, "registered");
    addRegistration("r", "waitlist");
    restrict("r");

    const reg = await admitPlayerToTournament("t1", "newcomer");

    expect(reg.status).toBe("registered");
    expect(statusOf("r")).toBe("waitlist");
  });

  it("Final Month: the restriction does not change admin-curated admission", async () => {
    fake.state.isFinal = true;
    restrict("r");

    const reg = await admitPlayerToTournament("t1", "r");

    expect(reg.status).toBe("registered");
    expect(reg).not.toHaveProperty("online_registration_restricted");
  });
});

// ---------------------------------------------------------------------------
// "Не пришёл"
// ---------------------------------------------------------------------------

describe("markRegistrationNoShowWithinCapacity ('Не пришёл')", () => {
  it("40/40 -> no-show -> 39/40 -> the next ELIGIBLE waitlisted player takes the seat -> 40/40; the no-show player stays waitlisted", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");

    const result = await markRegistrationNoShowWithinCapacity("t1", "reg-p5");

    const row = registrationOf("p5")!;
    expect(row.status).toBe("waitlist");
    expect(row.noShowAt).toBeInstanceOf(Date);
    expect(isRestricted("p5")).toBe(true);
    expect(result.promoted.promotedPlayerIds).toEqual(["w1"]);
    expect(statusOf("w1")).toBe("registered");
    expect(seatedCount()).toBe(40);
    expect(waitlistCount()).toBe(1);
  });

  it("frees exactly one seat when nobody eligible is waiting (39/40), and the no-show player does NOT auto-promote back", async () => {
    seedRegistrations("p", 40, "registered");

    await markRegistrationNoShowWithinCapacity("t1", "reg-p1");
    // A later reconciliation (e.g. the GS poller tick) still skips them.
    await reconcileTournamentWaitlistCapacity("t1");

    expect(statusOf("p1")).toBe("waitlist");
    expect(seatedCount()).toBe(39);
  });

  it("takes the tournament-row lock as the very first statement", async () => {
    seedRegistrations("p", 2, "registered");

    await markRegistrationNoShowWithinCapacity("t1", "reg-p1");

    expect(fake.state.log.slice(0, 2)).toEqual(["tx:begin", "lock:tournaments"]);
  });

  async function expectRejected(registrationId: string, message: RegExp) {
    const promise = markRegistrationNoShowWithinCapacity("t1", registrationId);
    await expect(promise).rejects.toBeInstanceOf(TournamentRosterActionError);
    await expect(markRegistrationNoShowWithinCapacity("t1", registrationId)).rejects.toThrow(message);
  }

  it("an ARRIVED player cannot be marked no-show (nothing changes)", async () => {
    addRegistration("a", "registered");
    fake.state.attendance.set("a", { arrived: true, arrivedAt: new Date() });

    await expectRejected("reg-a", /пришедший/);
    expect(statusOf("a")).toBe("registered");
    expect(registrationOf("a")!.noShowAt ?? null).toBeNull();
    expect(isRestricted("a")).toBe(false);
  });

  it("before the tournament start it cannot be marked", async () => {
    fake.state.startAt = FUTURE;
    addRegistration("a", "registered");

    await expectRejected("reg-a", /ещё не начался/);
    expect(statusOf("a")).toBe("registered");
    expect(isRestricted("a")).toBe(false);
  });

  it("a completed tournament cannot be changed", async () => {
    fake.state.status = "completed";
    addRegistration("a", "registered");

    await expectRejected("reg-a", /завершён/);
    expect(statusOf("a")).toBe("registered");
  });

  it("a waitlist row cannot be marked", async () => {
    addRegistration("w", "waitlist");

    await expectRejected("reg-w", /только для игрока из основной регистрации/);
    expect(isRestricted("w")).toBe(false);
  });

  it("a cancelled row cannot be marked", async () => {
    addRegistration("c", "cancelled");

    await expectRejected("reg-c", /только для игрока из основной регистрации/);
    expect(statusOf("c")).toBe("cancelled");
    expect(isRestricted("c")).toBe(false);
  });

  it("Final Month: the action is unavailable and creates NO restriction", async () => {
    fake.state.isFinal = true;
    addRegistration("f", "registered");

    await expectRejected("reg-f", /Финала месяца/);
    expect(statusOf("f")).toBe("registered");
    expect(registrationOf("f")!.noShowAt ?? null).toBeNull();
    expect(isRestricted("f")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// "Допустить в игру"
// ---------------------------------------------------------------------------

describe("admitWaitlistedRegistrationWithinCapacity ('Допустить в игру')", () => {
  it("restricted no-show A + free seat => registered, arrived, restriction cleared, THIS no_show_at cleared, capacity respected", async () => {
    seedRegistrations("p", 39, "registered");
    const a = addRegistration("A", "waitlist");
    a.noShowAt = new Date("2026-05-01T19:30:00Z");
    restrict("A");

    await admitWaitlistedRegistrationWithinCapacity("t1", "reg-A");

    expect(statusOf("A")).toBe("registered");
    expect(registrationOf("A")!.noShowAt).toBeNull();
    expect(fake.state.attendance.get("A")?.arrived).toBe(true);
    expect(isRestricted("A")).toBe(false);
    expect(seatedCount()).toBe(40);
  });

  it("no free seat => clear Russian error, A stays waitlist + restricted, attendance untouched", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("A", "waitlist");
    restrict("A");

    await expect(admitWaitlistedRegistrationWithinCapacity("t1", "reg-A")).rejects.toThrow(
      ADMISSION_NO_SEAT_MESSAGE
    );
    expect(ADMISSION_NO_SEAT_MESSAGE).toBe("Свободных мест нет — игрок остаётся в листе ожидания");
    expect(statusOf("A")).toBe("waitlist");
    expect(isRestricted("A")).toBe(true);
    expect(fake.state.attendance.has("A")).toBe(false);
    expect(seatedCount()).toBe(40);
  });

  // STAFF IN-PERSON OVERRIDE (intentional): the player standing at the desk
  // is admitted into the free seat even though `older` has been waiting
  // longer. Automatic promotion must NOT run first and hand that seat to
  // the remote, older waitlisted player.
  it("staff override: admits the SELECTED player even when an older waitlisted row exists", async () => {
    seedRegistrations("p", 39, "registered");
    addRegistration("older", "waitlist", new Date("2026-05-01T10:00:00Z"));
    addRegistration("selected", "waitlist", new Date("2026-05-01T12:00:00Z"));

    await admitWaitlistedRegistrationWithinCapacity("t1", "reg-selected");

    expect(statusOf("selected")).toBe("registered");
    expect(statusOf("older")).toBe("waitlist");
    expect(seatedCount()).toBe(40);
  });

  it("Late Registration closed => rejected, nothing changes", async () => {
    fake.state.lateRegistrationClosed = true;
    seedRegistrations("p", 10, "registered");
    addRegistration("A", "waitlist");

    await expect(admitWaitlistedRegistrationWithinCapacity("t1", "reg-A")).rejects.toThrow(
      /Поздняя регистрация закрыта/
    );
    expect(statusOf("A")).toBe("waitlist");
  });

  it("only a waitlist row can be admitted", async () => {
    addRegistration("r", "registered");
    await expect(admitWaitlistedRegistrationWithinCapacity("t1", "reg-r")).rejects.toThrow(
      /не находится в листе ожидания/
    );
  });

  it("a completed tournament cannot be changed", async () => {
    fake.state.status = "completed";
    addRegistration("A", "waitlist");
    await expect(admitWaitlistedRegistrationWithinCapacity("t1", "reg-A")).rejects.toThrow(/завершён/);
    expect(statusOf("A")).toBe("waitlist");
  });

  it("takes the tournament-row lock first and never runs auto-promotion before admitting", async () => {
    seedRegistrations("p", 39, "registered");
    addRegistration("older", "waitlist");
    addRegistration("A", "waitlist");

    await admitWaitlistedRegistrationWithinCapacity("t1", "reg-A");

    expect(fake.state.log.slice(0, 2)).toEqual(["tx:begin", "lock:tournaments"]);
    expect(statusOf("older")).toBe("waitlist");
  });
});

// ---------------------------------------------------------------------------
// Arrival clears the restriction
// ---------------------------------------------------------------------------

describe("clearOnlineRegistrationRestrictionOnArrival", () => {
  it("restricted player with a registered seat who is now arrived => restriction cleared, no_show_at untouched", async () => {
    const row = addRegistration("r", "registered");
    row.noShowAt = null;
    restrict("r");
    fake.state.attendance.set("r", { arrived: true, arrivedAt: new Date() });

    await expect(clearOnlineRegistrationRestrictionOnArrival("t1", "r")).resolves.toBe(true);
    expect(isRestricted("r")).toBe(false);
  });

  it("a WAITLIST row's arrival never clears the restriction (only admission does)", async () => {
    addRegistration("w", "waitlist");
    restrict("w");
    fake.state.attendance.set("w", { arrived: true, arrivedAt: new Date() });

    await expect(clearOnlineRegistrationRestrictionOnArrival("t1", "w")).resolves.toBe(false);
    expect(isRestricted("w")).toBe(true);
  });

  it("not actually arrived => nothing cleared", async () => {
    addRegistration("r", "registered");
    restrict("r");
    fake.state.attendance.set("r", { arrived: false, arrivedAt: null });

    await expect(clearOnlineRegistrationRestrictionOnArrival("t1", "r")).resolves.toBe(false);
    expect(isRestricted("r")).toBe(true);
  });

  it("unrestricted player => no-op without taking the lock", async () => {
    addRegistration("r", "registered");

    await expect(clearOnlineRegistrationRestrictionOnArrival("t1", "r")).resolves.toBe(false);
    expect(fake.state.log).not.toContain("lock:tournaments");
  });

  it("is a no-op outside DATABASE_PROVIDER=postgres (never throws on the attendance path)", async () => {
    process.env.DATABASE_PROVIDER = "supabase";
    await expect(clearOnlineRegistrationRestrictionOnArrival("t1", "x")).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Promotion notification -- at most once per registration, ever
// ---------------------------------------------------------------------------

describe("waitlist promotion notification", () => {
  it("auto-promotion => exactly one claim, one send to the right player, with the right tournament link", async () => {
    fake.state.title = "Вечерний турнир";
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    setPlayer("w1", { telegramId: 777 });
    eliminate("p1");

    await reconcileTournamentWaitlistCapacity("t1");

    expect(registrationOf("w1")!.waitlistPromotionNotificationClaimedAt).toBeInstanceOf(Date);
    expect(telegram.send).toHaveBeenCalledTimes(1);
    const params = telegram.send.mock.calls[0][0];
    expect(params.telegramId).toBe(777);
    expect(params.tournamentId).toBe("t1");
    expect(params.text).toContain("«Вечерний турнир»");
  });

  it("repeated reconciliation => no second claim, no second send", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    setPlayer("w1", { telegramId: 777 });
    eliminate("p1");

    await reconcileTournamentWaitlistCapacity("t1");
    const claimedAt = registrationOf("w1")!.waitlistPromotionNotificationClaimedAt;
    await reconcileTournamentWaitlistCapacity("t1");
    await reconcileTournamentWaitlistCapacity("t1");

    expect(registrationOf("w1")!.waitlistPromotionNotificationClaimedAt).toBe(claimedAt);
    expect(telegram.send).toHaveBeenCalledTimes(1);
  });

  it("waitlist -> registered -> waitlist (no-show) -> registered (admission) => still only ONE send", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    setPlayer("w1", { telegramId: 777 });
    eliminate("p1");

    await reconcileTournamentWaitlistCapacity("t1"); // first transition: sends
    expect(telegram.send).toHaveBeenCalledTimes(1);

    await markRegistrationNoShowWithinCapacity("t1", "reg-w1"); // back to waitlist
    expect(statusOf("w1")).toBe("waitlist");
    // Free a seat so staff can admit them again.
    eliminate("p2");
    await admitWaitlistedRegistrationWithinCapacity("t1", "reg-w1"); // second transition

    expect(statusOf("w1")).toBe("registered");
    expect(telegram.send).toHaveBeenCalledTimes(1);
  });

  it("manual admission is a real transition => one send through the same mechanism", async () => {
    seedRegistrations("p", 39, "registered");
    addRegistration("A", "waitlist");
    setPlayer("A", { telegramId: 4242 });
    restrict("A");

    await admitWaitlistedRegistrationWithinCapacity("t1", "reg-A");
    await reconcileTournamentWaitlistCapacity("t1");

    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect(telegram.send.mock.calls[0][0]).toMatchObject({ telegramId: 4242, tournamentId: "t1" });
  });

  it("Telegram failure (rejected promise) => promotion still committed, no exception, no retry", async () => {
    telegram.send.mockRejectedValue(new Error("network down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    setPlayer("w1", { telegramId: 777 });
    eliminate("p1");

    await expect(reconcileTournamentWaitlistCapacity("t1")).resolves.toMatchObject({
      promotedPlayerIds: ["w1"],
    });
    await reconcileTournamentWaitlistCapacity("t1");

    expect(statusOf("w1")).toBe("registered");
    expect(telegram.send).toHaveBeenCalledTimes(1);
    // Categorical log only -- never the message text or the chat id.
    for (const call of warn.mock.calls) {
      const logged = call.map(String).join(" ");
      expect(logged).not.toContain("777");
      expect(logged).not.toContain("основной регистрации");
    }
    warn.mockRestore();
  });

  it("Telegram reporting failure (false) => promotion stands, no second attempt", async () => {
    telegram.send.mockResolvedValue(false);
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    setPlayer("w1", { telegramId: 777 });
    eliminate("p1");

    await reconcileTournamentWaitlistCapacity("t1");
    await reconcileTournamentWaitlistCapacity("t1");

    expect(statusOf("w1")).toBe("registered");
    expect(telegram.send).toHaveBeenCalledTimes(1);
  });

  it("no telegram_id => promotion succeeds, nothing is sent, nothing fails", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    eliminate("p1");

    await expect(reconcileTournamentWaitlistCapacity("t1")).resolves.toMatchObject({
      promotedPlayerIds: ["w1"],
    });
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it("a promotion made inside a new entrant's admission is also notified exactly once", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("w1", "waitlist");
    setPlayer("w1", { telegramId: 5 });
    eliminate("p1");

    await admitPlayerToTournament("t1", "newcomer");

    expect(statusOf("w1")).toBe("registered");
    expect(telegram.send).toHaveBeenCalledTimes(1);
  });

  it("a no-show's freed seat promotion notifies the promoted player, never the no-show player", async () => {
    seedRegistrations("p", 40, "registered");
    setPlayer("p3", { telegramId: 3 });
    addRegistration("w1", "waitlist");
    setPlayer("w1", { telegramId: 11 });

    await markRegistrationNoShowWithinCapacity("t1", "reg-p3");

    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect(telegram.send.mock.calls[0][0].telegramId).toBe(11);
  });
});

describe("buildWaitlistPromotionMessage", () => {
  it("today's tournament (club time zone) uses the 'сегодняшний' copy with the start time", () => {
    const text = buildWaitlistPromotionMessage({
      title: "Deep Stack",
      startAt: new Date("2026-10-12T16:00:00Z"), // 19:00 Moscow
      now: new Date("2026-10-12T09:00:00Z"),
    });
    expect(text).toBe(
      "✅ Вы в основной регистрации на сегодняшний турнир «Deep Stack».\n\n" +
        "Для вас освободилось место. Ждём в клубе в 19:00.\n\n" +
        "Если планы изменились — пожалуйста, отмените запись в приложении."
    );
  });

  it("another day uses the date/time copy", () => {
    const text = buildWaitlistPromotionMessage({
      title: "Deep Stack",
      startAt: new Date("2026-10-14T16:00:00Z"),
      now: new Date("2026-10-12T09:00:00Z"),
    });
    expect(text).toBe(
      "✅ Вы в основной регистрации на турнир «Deep Stack».\n\n" +
        "Для вас освободилось место.\n" +
        "Начало: 14 октября, 19:00.\n\n" +
        "Если планы изменились — пожалуйста, отмените запись в приложении."
    );
  });

  it("'today' is decided in Europe/Moscow, not UTC (22:30 UTC = next Moscow day)", () => {
    const text = buildWaitlistPromotionMessage({
      title: "Night",
      startAt: new Date("2026-10-12T22:30:00Z"), // 13 Oct 01:30 Moscow
      now: new Date("2026-10-12T12:00:00Z"), // 12 Oct Moscow
    });
    expect(text).toContain("Начало: 13 октября, 01:30.");
  });
});

// ---------------------------------------------------------------------------
// Capacity invariant across all new paths (serialized by the fake's lock
// stand-in; real-Postgres concurrency is in the integration suite)
// ---------------------------------------------------------------------------

describe("capacity invariant -- never above max_players", () => {
  it("racing no-shows, admissions, self-registrations, eliminations and reconciles never exceed 40", async () => {
    seedRegistrations("p", 40, "registered");
    for (let i = 1; i <= 8; i++) addRegistration(`w${i}`, "waitlist");
    restrict("w1");
    restrict("w2");
    eliminate("p40");

    const outcomes = await Promise.allSettled([
      markRegistrationNoShowWithinCapacity("t1", "reg-p1"),
      admitWaitlistedRegistrationWithinCapacity("t1", "reg-w1"),
      admitWaitlistedRegistrationWithinCapacity("t1", "reg-w2"),
      admitPlayerToTournament("t1", "x"),
      markRegistrationNoShowWithinCapacity("t1", "reg-p2"),
      reconcileTournamentWaitlistCapacity("t1"),
      admitWaitlistedRegistrationWithinCapacity("t1", "reg-w8"),
      admitPlayerToTournament("t1", "y"),
    ]);

    expect(seatedCount()).toBeLessThanOrEqual(40);
    const log = fake.state.log;
    log.forEach((entry, index) => {
      if (entry === "tx:begin") expect(log[index + 1]).toBe("lock:tournaments");
    });
    const rejected = outcomes.filter((o) => o.status === "rejected");
    for (const o of rejected) {
      expect((o as PromiseRejectedResult).reason).toBeInstanceOf(TournamentRosterActionError);
    }
  });

  it("a no-show frees exactly one seat; an admission consumes exactly one", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("A", "waitlist");
    restrict("A");

    await markRegistrationNoShowWithinCapacity("t1", "reg-p1");
    expect(seatedCount()).toBe(39); // A restricted, p1 restricted => nobody auto-promoted

    await admitWaitlistedRegistrationWithinCapacity("t1", "reg-A");
    expect(seatedCount()).toBe(40);

    await expect(admitWaitlistedRegistrationWithinCapacity("t1", "reg-p1")).rejects.toThrow(
      ADMISSION_NO_SEAT_MESSAGE
    );
    expect(seatedCount()).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// No-show QUARANTINE -- THIS registration's no_show_at, independent of the
// player's global restriction (real-Postgres counterpart:
// no-show-quarantine.postgres.integration.test.ts)
// ---------------------------------------------------------------------------

describe("no-show quarantine (registration.no_show_at) -- never auto-promoted", () => {
  function quarantine(playerId: string) {
    registrationOf(playerId)!.noShowAt = new Date("2026-01-01T19:00:00Z");
  }

  it("1. an ordinary waitlist row (no_show_at NULL) auto-promotes", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("W", "waitlist");
    eliminate("p1");

    expect((await reconcileTournamentWaitlistCapacity("t1")).promotedPlayerIds).toEqual(["W"]);
  });

  it("2+3. a no-show row never auto-promotes -- also when the player is NOT (or no longer) restricted", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("N", "waitlist");
    quarantine("N");
    expect(isRestricted("N")).toBe(false);
    eliminate("p1");
    eliminate("p2");

    const result = await reconcileTournamentWaitlistCapacity("t1");

    expect(result.promotedPlayerIds).toEqual([]);
    expect(statusOf("N")).toBe("waitlist");
    expect(seatedCount()).toBe(38);
  });

  it("3. 'Не пришёл' then lifting the global restriction: the row stays quarantined on every later reconcile", async () => {
    resetFakeCapacityDb({ maxPlayers: 3 });
    fake.state.startAt = STARTED;
    seedRegistrations("p", 3, "registered");
    await markRegistrationNoShowWithinCapacity("t1", "reg-p1");
    setPlayer("p1", { restrictedAt: null });

    eliminate("p2");
    const result = await reconcileTournamentWaitlistCapacity("t1");

    expect(result.promotedPlayerIds).toEqual([]);
    expect(statusOf("p1")).toBe("waitlist");
    expect(registrationOf("p1")!.noShowAt).toBeInstanceOf(Date);
  });

  it("4. an eligible player BEHIND a no-show row still promotes (FIFO among eligible; the no-show keeps its place)", async () => {
    seedRegistrations("p", 40, "registered");
    addRegistration("N", "waitlist");
    addRegistration("B", "waitlist");
    addRegistration("C", "waitlist");
    quarantine("N");
    const nCreatedAt = registrationOf("N")!.createdAt.getTime();
    eliminate("p1");

    expect((await reconcileTournamentWaitlistCapacity("t1")).promotedPlayerIds).toEqual(["B"]);
    expect(statusOf("C")).toBe("waitlist");
    expect(registrationOf("N")!.createdAt.getTime()).toBe(nCreatedAt);
  });

  it("a newcomer is not queued behind a no-show row (it is not an eligible waiter)", async () => {
    resetFakeCapacityDb({ maxPlayers: 2 });
    addRegistration("p1", "registered");
    addRegistration("N", "waitlist");
    quarantine("N");

    expect((await admitPlayerToTournament("t1", "new")).status).toBe("registered");
  });

  it("5+6. 'Допустить в игру' admits a quarantined no-show when a seat is free: registered, THIS no_show_at cleared, arrived, restriction cleared", async () => {
    resetFakeCapacityDb({ maxPlayers: 3 });
    fake.state.startAt = STARTED;
    seedRegistrations("p", 3, "registered");
    await markRegistrationNoShowWithinCapacity("t1", "reg-p3");
    expect(isRestricted("p3")).toBe(true);

    await admitWaitlistedRegistrationWithinCapacity("t1", "reg-p3");

    expect(statusOf("p3")).toBe("registered");
    expect(registrationOf("p3")!.noShowAt).toBeNull();
    expect(fake.state.attendance.get("p3")?.arrived).toBe(true);
    expect(isRestricted("p3")).toBe(false);
    expect(seatedCount()).toBe(3);
  });

  it("5. admission of a no-show still respects capacity and Late Registration", async () => {
    resetFakeCapacityDb({ maxPlayers: 2 });
    fake.state.startAt = STARTED;
    seedRegistrations("p", 2, "registered");
    addRegistration("N", "waitlist");
    quarantine("N");

    await expect(admitWaitlistedRegistrationWithinCapacity("t1", "reg-N")).rejects.toThrow(ADMISSION_NO_SEAT_MESSAGE);
    expect(registrationOf("N")!.noShowAt).toBeInstanceOf(Date);

    eliminate("p1");
    fake.state.lateRegistrationClosed = true;
    await expect(admitWaitlistedRegistrationWithinCapacity("t1", "reg-N")).rejects.toThrow(TournamentRosterActionError);
    expect(statusOf("N")).toBe("waitlist");
  });

  it("a cancelled no-show row is reactivated back INTO quarantine (cancel + re-register is no bypass)", async () => {
    seedRegistrations("p", 5, "registered");
    addRegistration("N", "cancelled");
    quarantine("N");

    const again = await admitPlayerToTournament("t1", "N");

    expect(again.status).toBe("waitlist");
    expect(registrationOf("N")!.noShowAt).toBeInstanceOf(Date);
    expect((await reconcileTournamentWaitlistCapacity("t1")).promotedPlayerIds).toEqual([]);
  });

  it("7. capacity never exceeds max_players with a mix of no-show rows and eligible waiters", async () => {
    resetFakeCapacityDb({ maxPlayers: 5 });
    fake.state.startAt = STARTED;
    seedRegistrations("p", 5, "registered");
    for (const id of ["N1", "W1", "N2", "W2", "W3"]) addRegistration(id, "waitlist");
    quarantine("N1");
    quarantine("N2");
    eliminate("p1");
    eliminate("p2");
    eliminate("p3");

    const result = await reconcileTournamentWaitlistCapacity("t1");

    expect(result.promotedPlayerIds).toEqual(["W1", "W2", "W3"]);
    expect(seatedCount()).toBe(5);
    expect(statusOf("N1")).toBe("waitlist");
    expect(statusOf("N2")).toBe("waitlist");
  });
});
