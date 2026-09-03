import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Player } from "@/types/domain";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findByTelegramId: vi.fn(),
  verifySession: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {
    findById: mocks.findById,
    findByTelegramId: mocks.findByTelegramId,
  },
}));

vi.mock("@/lib/telegram-web-session", () => ({
  COOKIE_NAME: "reraise_session",
  verifySession: mocks.verifySession,
}));

const { resolveAuthenticatedCaller } = await import("@/lib/admin-auth");

function makePlayer(overrides: Partial<Player>): Player {
  return {
    id: "session-player",
    telegram_id: null,
    email: null,
    username: null,
    display_name: "Player",
    role: "admin",
    created_at: "2026-01-01T00:00:00.000Z",
    merged_into_player_id: null,
    ...overrides,
  };
}

function cookies(value: string | undefined) {
  return { get: () => (value !== undefined ? { value } : undefined) };
}

const noHeaders = { get: () => null };

beforeEach(() => {
  mocks.findById.mockReset();
  mocks.findByTelegramId.mockReset();
  mocks.verifySession.mockReset();
});

// Production-incident-shaped regression: a still-validly-signed session for
// an already-merged player (lib/player-merge.ts's executeMerge) must not
// keep resolving to that now-non-canonical row -- especially not here,
// since this is the identity check behind middleware.ts's /api/admin/**
// gate. Mirrors the equivalent Sterling/spb-poker fix (commit 9c11688).
describe("resolveAuthenticatedCaller -- canonical resolution after merge", () => {
  it("resolves a stale cookie for an already-merged source to the canonical target", async () => {
    mocks.verifySession.mockReturnValue("source-id");
    const source = makePlayer({ id: "source-id", merged_into_player_id: "target-id", role: "player" });
    const target = makePlayer({ id: "target-id", role: "player" });
    mocks.findById.mockResolvedValueOnce(source).mockResolvedValueOnce(target);

    const caller = await resolveAuthenticatedCaller(noHeaders, cookies("signed-cookie"));

    expect(caller).toEqual(target);
  });

  it("never escalates privilege -- a stale admin session resolves to the target's actual, lesser role", async () => {
    mocks.verifySession.mockReturnValue("source-id");
    const source = makePlayer({ id: "source-id", merged_into_player_id: "target-id", role: "admin" });
    const target = makePlayer({ id: "target-id", role: "player" });
    mocks.findById.mockResolvedValueOnce(source).mockResolvedValueOnce(target);

    const caller = await resolveAuthenticatedCaller(noHeaders, cookies("signed-cookie"));

    expect(caller?.role).toBe("player");
  });

  it("returns null for a dangling merge pointer rather than falling back to the raw session row", async () => {
    mocks.verifySession.mockReturnValue("source-id");
    const source = makePlayer({ id: "source-id", merged_into_player_id: "ghost", role: "admin" });
    mocks.findById.mockResolvedValueOnce(source).mockResolvedValueOnce(null);

    const caller = await resolveAuthenticatedCaller(noHeaders, cookies("signed-cookie"));

    expect(caller).toBeNull();
  });

  it("leaves an unmerged caller's identity/role untouched", async () => {
    mocks.verifySession.mockReturnValue("player-id");
    const player = makePlayer({ id: "player-id", role: "operator" });
    mocks.findById.mockResolvedValueOnce(player);

    const caller = await resolveAuthenticatedCaller(noHeaders, cookies("signed-cookie"));

    expect(caller).toEqual(player);
  });
});
