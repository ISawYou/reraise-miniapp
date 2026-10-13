import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

// Authorization of the global "Неявки игроков" Server Actions through the
// REAL lib/admin-auth.ts decision path (signed session cookie -> player ->
// role check); only the request boundary (next/headers), the player lookup
// and the no-show data layer are faked.
const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findByTelegramId: vi.fn(),
  cookieJar: new Map<string, string>(),
  listNoShowPlayerSummaries: vi.fn(),
  clearPlayerOnlineRegistrationRestriction: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: { findById: mocks.findById, findByTelegramId: mocks.findByTelegramId },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookieJar.get(name);
      return value === undefined ? undefined : { value };
    },
  }),
}));
vi.mock("@/features/tournament-no-show", () => ({
  listNoShowPlayerSummaries: mocks.listNoShowPlayerSummaries,
  clearPlayerOnlineRegistrationRestriction: mocks.clearPlayerOnlineRegistrationRestriction,
}));

const { getAdminNoShowPlayers, allowPlayerOrdinaryRegistration } = await import(
  "@/features/no-show-admin-actions"
);
const { COOKIE_NAME, signSession } = await import("@/lib/telegram-web-session");

const roles: Record<string, string> = { "admin-1": "admin", "operator-1": "operator", "player-1": "player" };

function actor(id: string): Player {
  return {
    id,
    telegram_id: null,
    username: null,
    display_name: id,
    role: roles[id],
    is_blocked: false,
    merged_into_player_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
  } as Player;
}

function signIn(id: string | null) {
  mocks.cookieJar = new Map();
  if (id) mocks.cookieJar.set(COOKIE_NAME, signSession(id));
}

const summary = {
  player_id: "p1",
  nickname: "Lee",
  telegram_avatar_url: null,
  custom_avatar_url: null,
  no_show_count: 2,
  last_no_show_at: "2026-10-01T18:00:00.000Z",
  online_registration_restricted: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSION_SECRET = "no-show-admin-actions-test-secret";
  mocks.findById.mockImplementation(async (id: string) => actor(id));
  mocks.listNoShowPlayerSummaries.mockResolvedValue([summary]);
  mocks.clearPlayerOnlineRegistrationRestriction.mockResolvedValue({ cleared: true });
});

describe("getAdminNoShowPlayers -- admin/operator only", () => {
  it.each(["admin-1", "operator-1"])("%s can view the list", async (id) => {
    signIn(id);
    await expect(getAdminNoShowPlayers()).resolves.toEqual([summary]);
  });

  it("a normal player is denied and nothing is read", async () => {
    signIn("player-1");
    await expect(getAdminNoShowPlayers()).rejects.toThrow("Недостаточно прав");
    expect(mocks.listNoShowPlayerSummaries).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller is denied", async () => {
    signIn(null);
    await expect(getAdminNoShowPlayers()).rejects.toThrow("Не авторизовано");
    expect(mocks.listNoShowPlayerSummaries).not.toHaveBeenCalled();
  });
});

describe("allowPlayerOrdinaryRegistration ('Разрешить обычную запись')", () => {
  it.each(["admin-1", "operator-1"])("%s clears ONLY the restriction via the dedicated service", async (id) => {
    signIn(id);
    await expect(allowPlayerOrdinaryRegistration("p1")).resolves.toEqual({ ok: true, cleared: true });
    expect(mocks.clearPlayerOnlineRegistrationRestriction).toHaveBeenCalledWith("p1");
  });

  it("a normal player is denied and nothing changes", async () => {
    signIn("player-1");
    await expect(allowPlayerOrdinaryRegistration("p1")).rejects.toThrow("Недостаточно прав");
    expect(mocks.clearPlayerOnlineRegistrationRestriction).not.toHaveBeenCalled();
  });

  it("a blank player id is rejected without touching anything", async () => {
    signIn("admin-1");
    await expect(allowPlayerOrdinaryRegistration("  ")).resolves.toEqual({ ok: false, error: "Игрок не найден" });
    expect(mocks.clearPlayerOnlineRegistrationRestriction).not.toHaveBeenCalled();
  });
});
