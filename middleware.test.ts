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

describe("admin middleware for Dealer Payroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifySession.mockReturnValue("player-1");
  });

  it("rejects an ordinary player from every dealer payroll route -- listing, starting/ending a shift, editing dealers/shifts", async () => {
    mocks.findById.mockResolvedValue({ id: "player-1", role: "player" });

    for (const path of [
      "/api/admin/dealers",
      "/api/admin/dealers/p1",
      "/api/admin/dealers/shifts",
      "/api/admin/dealers/shifts/s1/end",
      "/api/admin/dealers/shifts/s1",
    ]) {
      const request = new NextRequest(`https://re-raise.ru${path}`, {
        method: "POST",
        headers: { cookie: "reraise_session=signed" },
      });
      const response = await middleware(request);
      expect(response.status).toBe(403);
    }
  });

  it("allows an admin to reach dealer payroll routes", async () => {
    mocks.findById.mockResolvedValue({ id: "admin-1", role: "admin" });
    const request = new NextRequest("https://re-raise.ru/api/admin/dealers", {
      headers: { cookie: "reraise_session=signed" },
    });

    const response = await middleware(request);
    expect(response.status).toBe(200);
  });
});

describe("admin middleware -- operator role (fail-closed allowlist)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifySession.mockReturnValue("operator-1");
    mocks.findById.mockResolvedValue({ id: "operator-1", role: "operator" });
  });

  function requestFor(method: string, path: string) {
    return new NextRequest(`https://re-raise.ru${path}`, {
      method,
      headers: { cookie: "reraise_session=signed" },
    });
  }

  it("allows the normal tournament-day operational flow", async () => {
    const allowed: [string, string][] = [
      ["GET", "/api/admin/tournaments"],
      ["POST", "/api/admin/tournaments"],
      ["POST", "/api/admin/tournaments/t1/attendance"],
      ["POST", "/api/admin/tournaments/t1/eliminate"],
      ["POST", "/api/admin/tournaments/t1/rebuy-state"],
      ["POST", "/api/admin/tournaments/t1/pull-sheet"],
      ["POST", "/api/admin/tournaments/t1/export-sheet"],
      ["GET", "/api/admin/tournaments/t1/late-registration"],
      ["POST", "/api/admin/tournaments/t1/late-registration"],
      ["POST", "/api/admin/tournaments/t1/mystery-bounty/activate"],
      ["POST", "/api/admin/tournaments/t1/complete-free"],
      ["POST", "/api/admin/tournaments/t1/complete-live"],
      ["POST", "/api/admin/tournaments/t1/poker-clock/finish"],
      ["GET", "/api/admin/nicknames/players"],
      ["GET", "/api/admin/dealers"],
      ["POST", "/api/admin/dealers/shifts"],
      ["POST", "/api/admin/dealers/shifts/s1/end"],
      // "Чай" toggle -- fixed 0/500, deliberately narrower than the
      // Super-Admin-only PATCH .../shifts/s1 below.
      ["PATCH", "/api/admin/dealers/shifts/s1/taxi-allowance"],
      // Nickname moderation -- approve-only.
      ["GET", "/api/admin/nicknames/pending"],
      ["PATCH", "/api/admin/nicknames/p1/approve"],
    ];

    for (const [method, path] of allowed) {
      const response = await middleware(requestFor(method, path));
      expect(response.status, `${method} ${path}`).toBe(200);
    }
  });

  it("denies destructive/system/unrelated admin endpoints by default (fail closed)", async () => {
    const denied: [string, string][] = [
      // Tournament DELETE has no /api/admin/** route at all -- it's a
      // Server Action, guarded separately (see features/tournaments.ts).
      // Everything below DOES have a route, and must still be denied.
      ["POST", "/api/admin/tournaments/notify"],
      ["GET", "/api/admin/tournaments/recipients"],
      ["GET", "/api/admin/players"],
      ["PATCH", "/api/admin/players/p1"],
      ["DELETE", "/api/admin/players/p1"],
      ["PATCH", "/api/admin/players/access"],
      // Reject / edit / set_admin_display_name -- approve is on a separate,
      // narrower route (.../n1/approve) that IS allowed above.
      ["PATCH", "/api/admin/nicknames/n1"],
      ["GET", "/api/admin/referral"],
      ["GET", "/api/admin/activity"],
      ["GET", "/api/admin/academy"],
      ["POST", "/api/admin/achievements/manual"],
      ["POST", "/api/admin/achievements/resync"],
      ["GET", "/api/admin/tournament-visuals"],
      ["GET", "/api/admin/settings"],
      // Season management/rollover -- high-impact rating configuration,
      // Super-Admin-only (season management v2).
      ["GET", "/api/admin/seasons"],
      ["POST", "/api/admin/seasons"],
      ["PATCH", "/api/admin/seasons/s1"],
      ["GET", "/api/admin/seasons/resolve"],
      ["POST", "/api/admin/seasons/resync"],
      ["POST", "/api/admin/seasons/s1/close"],
      ["POST", "/api/admin/seasons/s1/rollover"],
      ["GET", "/api/admin/seasons/s1/recap"],
      ["POST", "/api/admin/club-activity"],
      // Dealer administration/financial routes stay Super-Admin-only.
      ["POST", "/api/admin/dealers"],
      ["DELETE", "/api/admin/dealers/p1"],
      ["PATCH", "/api/admin/dealers/p1"],
      ["PATCH", "/api/admin/dealers/shifts/s1"],
      ["GET", "/api/admin/dealers/shifts/today"],
      ["GET", "/api/admin/dealers/shifts/recent"],
      ["GET", "/api/admin/dealers/stats"],
      // Role management is Super-Admin-only.
      ["GET", "/api/admin/roles"],
      ["PATCH", "/api/admin/roles"],
      // Season rating eligibility ("Вне зачёта") is Super-Admin-only.
      ["GET", "/api/admin/rating-eligibility"],
      ["PATCH", "/api/admin/rating-eligibility"],
      // Completed-tournament admin summary bundles dealer payout (financial
      // data) -- Super-Admin-only, same boundary as dealer stats.
      ["GET", "/api/admin/tournaments/t1/completion-summary"],
      // A brand-new, never-listed route must fail closed too.
      ["POST", "/api/admin/tournaments/t1/some-future-destructive-action"],
    ];

    for (const [method, path] of denied) {
      const response = await middleware(requestFor(method, path));
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });
});

describe("admin middleware for season rating eligibility (\"Вне зачёта\")", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifySession.mockReturnValue("player-1");
  });

  it("rejects an ordinary player from both listing and toggling exclusions", async () => {
    mocks.findById.mockResolvedValue({ id: "player-1", role: "player" });

    for (const [method, path] of [
      ["GET", "/api/admin/rating-eligibility"],
      ["PATCH", "/api/admin/rating-eligibility"],
    ] as const) {
      const request = new NextRequest(`https://re-raise.ru${path}`, {
        method,
        headers: { cookie: "reraise_session=signed" },
      });
      const response = await middleware(request);
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it("allows an admin (Super Admin) to reach it", async () => {
    mocks.findById.mockResolvedValue({ id: "admin-1", role: "admin" });
    const request = new NextRequest("https://re-raise.ru/api/admin/rating-eligibility", {
      headers: { cookie: "reraise_session=signed" },
    });

    const response = await middleware(request);
    expect(response.status).toBe(200);
  });
});

describe("admin middleware -- dealer-only user (dealer is NOT an auth role)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifySession.mockReturnValue("dealer-1");
  });

  function requestFor(method: string, path: string) {
    return new NextRequest(`https://re-raise.ru${path}`, {
      method,
      headers: { cookie: "reraise_session=signed" },
    });
  }

  // A "dealer-only user" has no dedicated auth role -- having a
  // dealer_profiles row is completely invisible to this middleware, which
  // only ever reads players.role. So a dealer with role: 'player' is
  // authorized IDENTICALLY to any other ordinary player: no /api/admin/**
  // access at all, including the Super-Admin-only completed-shift
  // correction endpoint this task adds (dealer/tournament/rate/tea
  // reassignment all live behind the SAME PATCH route already denied
  // below).
  it("a dealer-only user (role: player) gets no /api/admin/** access at all", async () => {
    mocks.findById.mockResolvedValue({ id: "dealer-1", role: "player" });

    for (const [method, path] of [
      ["GET", "/api/admin/dealers"],
      ["POST", "/api/admin/dealers/shifts"],
      ["PATCH", "/api/admin/dealers/shifts/s1"],
      ["PATCH", "/api/admin/dealers/shifts/s1/taxi-allowance"],
      ["GET", "/api/admin/dealers/stats"],
      ["GET", "/api/admin/rating-eligibility"],
      ["GET", "/api/admin/roles"],
      ["GET", "/api/admin/nicknames/pending"],
      ["PATCH", "/api/admin/nicknames/p1/approve"],
      ["POST", "/api/admin/tournaments/t1/poker-clock/finish"],
    ] as const) {
      const response = await middleware(requestFor(method, path));
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it("an unauthenticated dealer (no valid session at all) gets 401, not 403", async () => {
    mocks.verifySession.mockReturnValue(null);

    const response = await middleware(requestFor("GET", "/api/admin/dealers"));
    expect(response.status).toBe(401);
  });
});
