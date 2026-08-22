import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  verifySession: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {
    findById: mocks.findById,
    findByTelegramId: vi.fn(),
  },
}));
vi.mock("@/lib/telegram-web-session", () => ({
  COOKIE_NAME: "reraise_session",
  verifySession: mocks.verifySession,
}));

import { config, middleware } from "@/middleware";

describe("admin middleware for Club Activity CMS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifySession.mockReturnValue("player-1");
  });

  it("covers the new admin route and rejects an ordinary player", async () => {
    expect(config.matcher).toContain("/api/admin/:path*");
    mocks.findById.mockResolvedValue({ id: "player-1", role: "player" });
    const request = new NextRequest("https://re-raise.ru/api/admin/club-activity", {
      method: "POST",
      headers: { cookie: "reraise_session=signed" },
    });

    const response = await middleware(request);
    expect(response.status).toBe(403);
  });

  it("allows an admin to reach the route", async () => {
    mocks.findById.mockResolvedValue({ id: "admin-1", role: "admin" });
    const request = new NextRequest("https://re-raise.ru/api/admin/club-activity", {
      method: "POST",
      headers: { cookie: "reraise_session=signed" },
    });

    const response = await middleware(request);
    expect(response.status).toBe(200);
  });
});
