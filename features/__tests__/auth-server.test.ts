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
  assertPlayerActive,
  EmailAlreadyLinkedToAnotherPlayerError,
  PlayerBlockedError,
  PlayerMergedAwayError,
} = await import("@/features/auth-server");
// Real server action over the same mocked repository -- proves a direct
// bare-playerId action is actually blocked, not just the helper.
const { acceptTerms } = await import("@/features/auth");

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

describe("assertPlayerActive (bare-playerId server-action guard)", () => {
  it("returns an ordinary active player unchanged (regression)", async () => {
    const player = makePlayer({ id: "player-1" });
    mocks.findById.mockResolvedValue(player);

    await expect(assertPlayerActive("player-1")).resolves.toEqual(player);
    expect(mocks.findById).toHaveBeenCalledWith("player-1");
    // Raw by-id check only -- never canonical-redirects.
    expect(mocks.resolveCanonicalPlayer).not.toHaveBeenCalled();
  });

  it("still rejects a blocked (non-merged) player with the exact same PlayerBlockedError + message (regression)", async () => {
    mocks.findById.mockResolvedValue(makePlayer({ id: "player-1", is_blocked: true }));

    const err = await assertPlayerActive("player-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlayerBlockedError);
    expect(err).not.toBeInstanceOf(PlayerMergedAwayError);
    expect((err as Error).message).toBe("Аккаунт заблокирован администратором");
  });

  it("still rejects a missing player with the same message (regression)", async () => {
    mocks.findById.mockResolvedValue(null);
    await expect(assertPlayerActive("missing")).rejects.toThrow("Игрок не найден");
  });

  it("FAILS CLOSED on a merged-away source id: throws PlayerMergedAwayError, never resolves to the target", async () => {
    mocks.findById.mockResolvedValue(makePlayer({ id: "source", merged_into_player_id: "target" }));

    const err = await assertPlayerActive("source").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlayerMergedAwayError);
    expect((err as InstanceType<typeof PlayerMergedAwayError>).playerId).toBe("source");
    expect((err as Error).message).toBe("Аккаунт был объединён. Обновите страницу.");
    expect(mocks.resolveCanonicalPlayer).not.toHaveBeenCalled();
    expect(mocks.findById).toHaveBeenCalledTimes(1);
  });

  it("a merged-away source that is ALSO blocked is still rejected (merged-away wins, both fail closed)", async () => {
    mocks.findById.mockResolvedValue(
      makePlayer({ id: "source", merged_into_player_id: "target", is_blocked: true })
    );
    await expect(assertPlayerActive("source")).rejects.toBeInstanceOf(PlayerMergedAwayError);
  });

  it("the surviving merge TARGET is an ordinary active player and passes", async () => {
    // Target rows never carry merged_into_player_id themselves.
    const target = makePlayer({ id: "target", email: "moved@example.com", merged_into_player_id: null });
    mocks.findById.mockResolvedValue(target);

    await expect(assertPlayerActive("target")).resolves.toEqual(target);
  });

  it("an undefined merged_into_player_id (legacy row shape) is treated as not merged", async () => {
    const legacy = makePlayer({ id: "legacy" });
    delete (legacy as Partial<Player>).merged_into_player_id;
    mocks.findById.mockResolvedValue(legacy);

    await expect(assertPlayerActive("legacy")).resolves.toEqual(legacy);
  });
});

describe("direct server action through assertPlayerActive: acceptTerms", () => {
  it("a stale tab's merged-away source id cannot write accepted_terms onto the dead row", async () => {
    mocks.findById.mockResolvedValue(makePlayer({ id: "source", merged_into_player_id: "target" }));

    await expect(acceptTerms("source")).rejects.toBeInstanceOf(PlayerMergedAwayError);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("the target (and any ordinary active player) still accepts terms as before", async () => {
    mocks.findById.mockResolvedValue(makePlayer({ id: "target" }));
    mocks.update.mockResolvedValue(makePlayer({ id: "target" }));

    await acceptTerms("target");
    expect(mocks.update).toHaveBeenCalledWith(
      "target",
      expect.objectContaining({ accepted_terms_at: expect.any(String) })
    );
  });
});
