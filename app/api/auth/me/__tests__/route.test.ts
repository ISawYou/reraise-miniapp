import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Player } from "@/types/domain";

// GET /api/auth/me is the web session bootstrap (lib/current-player.ts). A
// still-validly-signed cookie for a soft-merged player must resolve to the
// surviving account (lib/canonical-player.ts), never the merged-away row.

const mocks = vi.hoisted(() => ({ findById: vi.fn() }));

vi.mock("@/lib/repositories", () => ({ playerRepository: { findById: mocks.findById } }));

const { GET } = await import("@/app/api/auth/me/route");
const { COOKIE_NAME, signSession } = await import("@/lib/telegram-web-session");

function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    telegram_id: null,
    username: null,
    display_name: id,
    role: "player",
    created_at: "2026-01-01T00:00:00.000Z",
    merged_into_player_id: null,
    ...overrides,
  } as Player;
}

function requestWithCookie(playerId: string) {
  return new NextRequest("http://localhost/api/auth/me", {
    headers: { cookie: `${COOKIE_NAME}=${signSession(playerId)}` },
  });
}

beforeEach(() => {
  process.env.SESSION_SECRET = "auth-me-route-test-secret";
  mocks.findById.mockReset();
});

describe("GET /api/auth/me -- canonical resolution", () => {
  it("an unmerged player resolves to itself (unchanged behavior)", async () => {
    mocks.findById.mockImplementation(async (id: string) => player(id));

    const response = await GET(requestWithCookie("p1"));

    expect(response.status).toBe(200);
    expect((await response.json()).player.id).toBe("p1");
  });

  it("an old cookie for a merged-away source resolves to the surviving target", async () => {
    mocks.findById.mockImplementation(async (id: string) =>
      id === "source" ? player("source", { merged_into_player_id: "target" }) : player("target")
    );

    const response = await GET(requestWithCookie("source"));

    expect(response.status).toBe(200);
    expect((await response.json()).player.id).toBe("target");
  });

  it("fails closed on a dangling merge pointer instead of returning the dead row", async () => {
    mocks.findById.mockImplementation(async (id: string) =>
      id === "source" ? player("source", { merged_into_player_id: "gone" }) : null
    );

    const response = await GET(requestWithCookie("source"));

    expect(response.status).toBe(404);
  });

  it("still returns a blocked player as before (blocked handling unchanged)", async () => {
    mocks.findById.mockImplementation(async (id: string) => player(id, { is_blocked: true }));

    const response = await GET(requestWithCookie("p1"));

    expect(response.status).toBe(200);
    expect((await response.json()).player.is_blocked).toBe(true);
  });
});
