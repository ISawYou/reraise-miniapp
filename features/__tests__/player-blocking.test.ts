import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPlayerRepository = {
  findById: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/lib/repositories", () => ({
  playerRepository: mockPlayerRepository,
}));

vi.mock("@/lib/telegram-web-session", () => ({
  verifySession: vi.fn(),
}));

const { setPlayerBlocked } = await import("@/features/admin");
const {
  getPlayerFromSessionServer,
  assertPlayerActive,
  PlayerBlockedError,
} = await import("@/features/auth-server");
const { verifySession } = await import("@/lib/telegram-web-session");

function player(overrides: Record<string, unknown> = {}) {
  return {
    id: "player-1",
    telegram_id: null,
    username: null,
    display_name: "Player One",
    role: "player" as const,
    is_blocked: false,
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockPlayerRepository.findById.mockReset();
  mockPlayerRepository.update.mockReset();
  vi.mocked(verifySession).mockReset();
});

describe("setPlayerBlocked (admin action)", () => {
  it("blocks an ordinary player", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player());
    mockPlayerRepository.update.mockResolvedValue(player({ is_blocked: true }));

    const result = await setPlayerBlocked("player-1", true);

    expect(mockPlayerRepository.update).toHaveBeenCalledWith("player-1", {
      is_blocked: true,
    });
    expect(result.is_blocked).toBe(true);
  });

  it("unblocks a previously blocked player", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player({ is_blocked: true }));
    mockPlayerRepository.update.mockResolvedValue(player({ is_blocked: false }));

    const result = await setPlayerBlocked("player-1", false);

    expect(mockPlayerRepository.update).toHaveBeenCalledWith("player-1", {
      is_blocked: false,
    });
    expect(result.is_blocked).toBe(false);
  });

  it("refuses to block an admin, protecting against accidental self-lockout", async () => {
    mockPlayerRepository.findById.mockResolvedValue(
      player({ id: "admin-1", role: "admin" })
    );

    await expect(setPlayerBlocked("admin-1", true)).rejects.toThrow(
      "Нельзя заблокировать администратора"
    );
    expect(mockPlayerRepository.update).not.toHaveBeenCalled();
  });

  it("throws for an unknown player id", async () => {
    mockPlayerRepository.findById.mockResolvedValue(null);

    await expect(setPlayerBlocked("missing", true)).rejects.toThrow("Игрок не найден");
  });
});

describe("getPlayerFromSessionServer", () => {
  it("resolves an active player from a valid session", async () => {
    vi.mocked(verifySession).mockReturnValue("player-1");
    mockPlayerRepository.findById.mockResolvedValue(player());

    const result = await getPlayerFromSessionServer("signed-cookie");

    expect(result?.id).toBe("player-1");
  });

  it("denies a blocked player even though the signed session is still cryptographically valid", async () => {
    vi.mocked(verifySession).mockReturnValue("player-1");
    mockPlayerRepository.findById.mockResolvedValue(player({ is_blocked: true }));

    const result = await getPlayerFromSessionServer("signed-cookie");

    expect(result).toBeNull();
  });

  it("returns null when there is no session", async () => {
    const result = await getPlayerFromSessionServer(undefined);
    expect(result).toBeNull();
    expect(mockPlayerRepository.findById).not.toHaveBeenCalled();
  });
});

describe("assertPlayerActive", () => {
  it("returns the player when active", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player());
    await expect(assertPlayerActive("player-1")).resolves.toMatchObject({
      id: "player-1",
    });
  });

  it("throws PlayerBlockedError for a blocked player", async () => {
    mockPlayerRepository.findById.mockResolvedValue(player({ is_blocked: true }));
    await expect(assertPlayerActive("player-1")).rejects.toBeInstanceOf(
      PlayerBlockedError
    );
  });

  it("throws for a missing player", async () => {
    mockPlayerRepository.findById.mockResolvedValue(null);
    await expect(assertPlayerActive("missing")).rejects.toThrow("Игрок не найден");
  });
});
