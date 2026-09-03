import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findByEmail: vi.fn(),
  update: vi.fn(),
  verifySession: vi.fn(),
  resolveCanonicalPlayer: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {
    findById: mocks.findById,
    findByEmail: mocks.findByEmail,
    update: mocks.update,
  },
}));

vi.mock("@/lib/telegram-web-session", () => ({
  verifySession: mocks.verifySession,
}));

vi.mock("@/lib/canonical-player", () => ({
  resolveCanonicalPlayer: mocks.resolveCanonicalPlayer,
}));

const {
  linkEmailToPlayerServer,
  getPlayerFromSessionServer,
  EmailAlreadyLinkedToAnotherPlayerError,
  PlayerMergedAwayError,
} = await import("@/features/auth-server");

function makePlayer(overrides: Partial<Player>): Player {
  return {
    id: "player-1",
    telegram_id: null,
    email: null,
    username: null,
    display_name: "Player",
    role: "player",
    created_at: "2026-01-01T00:00:00.000Z",
    is_blocked: false,
    merged_into_player_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.findById.mockReset();
  mocks.findByEmail.mockReset();
  mocks.update.mockReset();
  mocks.verifySession.mockReset();
  mocks.resolveCanonicalPlayer.mockReset();
});

describe("linkEmailToPlayerServer", () => {
  it("rejects linking an email directly to a merged-away player, even called with its raw id", async () => {
    mocks.findById.mockResolvedValue(makePlayer({ id: "source", merged_into_player_id: "target" }));

    await expect(linkEmailToPlayerServer("source", "a@example.com")).rejects.toThrow(
      PlayerMergedAwayError
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("throws EmailAlreadyLinkedToAnotherPlayerError carrying the source player id when the email belongs elsewhere", async () => {
    mocks.findById.mockResolvedValue(makePlayer({ id: "caller" }));
    mocks.findByEmail.mockResolvedValue(makePlayer({ id: "other-player", email: "a@example.com" }));

    try {
      await linkEmailToPlayerServer("caller", "a@example.com");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EmailAlreadyLinkedToAnotherPlayerError);
      expect((err as InstanceType<typeof EmailAlreadyLinkedToAnotherPlayerError>).sourcePlayerId).toBe(
        "other-player"
      );
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("links the email when it is free or already the caller's own", async () => {
    mocks.findById.mockResolvedValue(makePlayer({ id: "caller" }));
    mocks.findByEmail.mockResolvedValue(null);
    mocks.update.mockResolvedValue(makePlayer({ id: "caller", email: "a@example.com" }));

    const result = await linkEmailToPlayerServer("caller", "a@example.com");

    expect(result.email).toBe("a@example.com");
    expect(mocks.update).toHaveBeenCalledWith("caller", { email: "a@example.com" });
  });
});

describe("getPlayerFromSessionServer", () => {
  it("resolves through resolveCanonicalPlayer, not the raw session row", async () => {
    mocks.verifySession.mockReturnValue("source-id");
    const raw = makePlayer({ id: "source-id", merged_into_player_id: "target-id" });
    const canonical = makePlayer({ id: "target-id" });
    mocks.findById.mockResolvedValue(raw);
    mocks.resolveCanonicalPlayer.mockResolvedValue(canonical);

    const result = await getPlayerFromSessionServer("signed-cookie");

    expect(mocks.resolveCanonicalPlayer).toHaveBeenCalledWith(raw);
    expect(result).toEqual(canonical);
  });

  it("returns null when canonical resolution fails closed", async () => {
    mocks.verifySession.mockReturnValue("source-id");
    mocks.findById.mockResolvedValue(makePlayer({ id: "source-id", merged_into_player_id: "ghost" }));
    mocks.resolveCanonicalPlayer.mockResolvedValue(null);

    expect(await getPlayerFromSessionServer("signed-cookie")).toBeNull();
  });

  it("still enforces is_blocked on the canonically-resolved player", async () => {
    mocks.verifySession.mockReturnValue("player-1");
    const player = makePlayer({ id: "player-1", is_blocked: true });
    mocks.findById.mockResolvedValue(player);
    mocks.resolveCanonicalPlayer.mockResolvedValue(player);

    expect(await getPlayerFromSessionServer("signed-cookie")).toBeNull();
  });
});
