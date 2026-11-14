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

it.each(["attendance","eliminate"])("retains server-side staff authorization for final %s API",async suffix=>{
 expect(config.matcher).toContain('/api/admin/:path*');
 for(const role of [null,'player','operator','admin']){mocks.verifySession.mockReturnValue(role?'caller':null);mocks.findById.mockResolvedValue(role?{id:'caller',role}:null);const response=await middleware(new NextRequest(`https://re-raise.ru/api/admin/tournaments/final/${suffix}`,{method:'POST',headers:role?{cookie:'reraise_session=signed'}:{}}));expect(response.status).toBe(role===null?401:role==='player'?403:200);}
});

describe("native tournament console operator permissions", () => {
  const base = "/api/admin/tournaments/tournament-1/operations";
  const allowed = [["GET", "/api/admin/tournaments/tournament-1/complete-free"], ["GET", base], ["PATCH", base], ["GET", `${base}/complete`], ["POST", `${base}/complete`]];
  beforeEach(() => vi.clearAllMocks());
  async function access(role: string | null, method: string, path: string) {
    mocks.verifySession.mockReturnValue(role ? "caller" : null);
    mocks.findById.mockResolvedValue(role ? { id: "caller", role } : null);
    return middleware(new NextRequest(`https://re-raise.ru${path}`, {method, headers: role ? {cookie: "reraise_session=signed"} : {}}));
  }
  it.each(allowed)("permits operator %s %s through the actual middleware", async (method, path) => {
    expect(config.matcher).toContain("/api/admin/:path*");
    const response = await access("operator", method, path);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
  it.each(allowed)("retains all role boundaries for %s %s", async (method, path) => {
    expect((await access("admin", method, path)).status).toBe(200);
    expect((await access(null, method, path)).status).toBe(401);
    expect((await access("player", method, path)).status).toBe(403);
  });
  it.each([
    ["GET", `${base}/source`], ["POST", `${base}/source`],
    ["POST", base], ["PUT", base], ["DELETE", base], ["HEAD", base], ["OPTIONS", base],
    ["PATCH", `${base}/complete`], ["PUT", `${base}/complete`], ["DELETE", `${base}/complete`],
    ["HEAD", `${base}/complete`], ["OPTIONS", `${base}/complete`],
    ["GET", `${base}/complete/extra`], ["PATCH", `${base}/extra`],
    ["PATCH", "/api/admin/tournaments/tournament-1/complete-free"], ["GET", "/api/admin/tournaments/tournament-1/complete-free/extra"], ["GET", "/api/admin/settings"], ["DELETE", "/api/admin/players/player-1"],
  ])("keeps operator %s %s denied", async (method, path) => {
    expect((await access("operator", method, path)).status).toBe(403);
    expect((await access("admin", method, path)).status).toBe(200);
  });
});

describe("Profile artwork settings authorization", () => {
  it.each([
    ["GET", ""], ["PUT", ""], ["POST", "/upload"], ["POST", "/reset"],
    ["POST", "/reset-list"], ["PUT", "/profile"], ["DELETE", "/profile"],
  ])("protects %s %s with the existing administrator-only gate", async (method, suffix) => {
    for (const role of [null, "player", "operator", "admin"]) {
      mocks.verifySession.mockReturnValue(role ? "caller" : null);
      mocks.findById.mockResolvedValue(role ? { id: "caller", role } : null);
      const response = await middleware(new NextRequest(`https://re-raise.ru/api/admin/tournament-visuals${suffix}`, { method, headers: { cookie: "reraise_session=signed" } }));
      expect(response.status).toBe(role === "admin" ? 200 : role === null ? 401 : 403);
    }
  });
});

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
      // RELEASE A: referral simplification -- operator may list players and
      // edit ONLY referral_count via the narrow count-only route.
      ["GET", "/api/admin/referral"],
      ["PATCH", "/api/admin/referral/p1/count"],
      // RELEASE A: manual achievement moderation (Royal Flush) -- the
      // server-side assertManualAchievement guard independently rejects any
      // AUTOMATIC code regardless of this allowlist.
      ["GET", "/api/admin/achievements/manual"],
      ["POST", "/api/admin/achievements/manual"],
      ["DELETE", "/api/admin/achievements/manual"],
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
      // The generic bundled-action referral route (free-reentry balance,
      // Yandex review bonus) stays denied -- only the narrow count-only
      // route above is allowed (RELEASE A referral simplification).
      ["PATCH", "/api/admin/referral/p1"],
      ["GET", "/api/admin/activity"],
      ["GET", "/api/admin/academy"],
      // Global resync/visuals editing stay denied -- only the narrow
      // manual-grant/revoke route above is allowed (RELEASE A).
      ["POST", "/api/admin/achievements/resync"],
      ["GET", "/api/admin/achievements/visuals"],
      // Admin Shifts management (view all / edit amount / historical
      // backfill / full correction) stays Super-Admin-only -- self-service
      // lives outside /api/admin entirely (/api/admin-shift/me/*, not
      // covered by this middleware at all).
      ["GET", "/api/admin/admin-shifts"],
      ["POST", "/api/admin/admin-shifts"],
      ["PATCH", "/api/admin/admin-shifts/s1"],
      // Super Admin closing another admin's forgotten-open shift -- also
      // stays off the operator allowlist.
      ["POST", "/api/admin/admin-shifts/s1/close"],
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


describe("completed KO correction -- Super Admin only", () => {
  it.each(["GET", "POST"])("protects %s from unauthenticated, player and operator callers", async method => {
    for (const role of [null, "player", "operator", "admin"]) {
      mocks.verifySession.mockReturnValue(role ? "caller" : null);
      mocks.findById.mockResolvedValue(role ? { id: "caller", role } : null);
      const response = await middleware(new NextRequest("https://re-raise.ru/api/admin/tournaments/t1/completed-knockout-correction", { method, headers: { cookie: "reraise_session=signed" } }));
      expect(response.status).toBe(role === "admin" ? 200 : role === null ? 401 : 403);
    }
  });
});


describe("Qualification configuration -- Super Admin only",()=>{
 it.each([["GET","/api/admin/qualifications"],["POST","/api/admin/qualifications"],["GET","/api/admin/qualifications/e1"],["POST","/api/admin/qualifications/e1"]])("protects %s %s",async(method,path)=>{
  for(const role of [null,"player","operator","admin"]){mocks.verifySession.mockReturnValue(role?"caller":null);mocks.findById.mockResolvedValue(role?{id:"caller",role}:null);const r=await middleware(new NextRequest("https://re-raise.ru"+path,{method,headers:{cookie:"reraise_session=signed"}}));expect(r.status).toBe(role==="admin"?200:role===null?401:403);}
 });
});
