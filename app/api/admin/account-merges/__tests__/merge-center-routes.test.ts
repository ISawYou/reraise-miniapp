import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Player } from "@/types/domain";

// Super-Admin Merge Center routes: search / preview / execute (and the
// conflict-queue GET). Runs the REAL lib/admin-auth.ts chain
// (assertServerActorRole -> resolveCurrentServerActor ->
// resolveAuthenticatedCaller -> verifySession -> canonical resolution) --
// only next/headers (request scope) and the player repository are faked --
// plus the REAL middleware.ts for the operator gate.

const mocks = vi.hoisted(() => ({
  cookieValue: { current: undefined as string | undefined },
  findById: vi.fn(),
  findByTelegramId: vi.fn(),
  listConflicts: vi.fn(),
  previewAdminMerge: vi.fn(),
  executeAdminMerge: vi.fn(),
  searchPlayersForAdminMerge: vi.fn(),
  finalizeMergeSideEffects: vi.fn(),
  computeTournamentOverlap: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({
    get: (name: string) =>
      name === "reraise_session" && mocks.cookieValue.current ? { value: mocks.cookieValue.current } : undefined,
  }),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: { findById: mocks.findById, findByTelegramId: mocks.findByTelegramId },
  playerMergeIntentRepository: { listConflicts: mocks.listConflicts },
}));

class FakeAccountMergeUnavailableError extends Error {}
class FakeAdminMergeConfirmationError extends Error {}
class FakeAdminMergeConcurrentUpdateError extends Error {}

vi.mock("@/lib/player-merge", () => ({
  ADMIN_MERGE_CONFIRMATION: "ОБЪЕДИНИТЬ",
  AccountMergeUnavailableError: FakeAccountMergeUnavailableError,
  AdminMergeConfirmationError: FakeAdminMergeConfirmationError,
  AdminMergeConcurrentUpdateError: FakeAdminMergeConcurrentUpdateError,
  previewAdminMerge: mocks.previewAdminMerge,
  executeAdminMerge: mocks.executeAdminMerge,
  searchPlayersForAdminMerge: mocks.searchPlayersForAdminMerge,
  finalizeMergeSideEffects: mocks.finalizeMergeSideEffects,
  computeTournamentOverlap: mocks.computeTournamentOverlap,
}));

const { signSession } = await import("@/lib/telegram-web-session");
const searchRoute = await import("@/app/api/admin/account-merges/search/route");
const previewRoute = await import("@/app/api/admin/account-merges/preview/route");
const executeRoute = await import("@/app/api/admin/account-merges/execute/route");
const queueRoute = await import("@/app/api/admin/account-merges/route");
const { middleware } = await import("@/middleware");

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

function player(id: string, role: Player["role"]): Player {
  return {
    id,
    telegram_id: null,
    username: null,
    display_name: role,
    role,
    created_at: "2026-01-01T00:00:00.000Z",
    merged_into_player_id: null,
  } as Player;
}

function signInAs(role: Player["role"] | null) {
  if (!role) {
    mocks.cookieValue.current = undefined;
    return;
  }
  mocks.cookieValue.current = signSession(ADMIN_ID);
  mocks.findById.mockImplementation(async (id: string) => (id === ADMIN_ID ? player(ADMIN_ID, role) : null));
}

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validExecuteBody = { targetPlayerId: TARGET_ID, sourcePlayerId: SOURCE_ID, confirmation: "ОБЪЕДИНИТЬ" };

const mergedResult = {
  merged: true,
  target_player_id: TARGET_ID,
  source_player_id: SOURCE_ID,
  final_identity: {
    player_id: TARGET_ID,
    display_name: "T",
    email: "t@example.com",
    telegram_linked: true,
    telegram_username: "t",
    role: "player",
    is_blocked: false,
    online_registration_restricted: false,
  },
  transferred_tournament_count: 2,
};

beforeEach(() => {
  process.env.SESSION_SECRET = "merge-center-route-test-secret";
  vi.clearAllMocks();
  mocks.findById.mockReset();
  mocks.findByTelegramId.mockReset();
  mocks.searchPlayersForAdminMerge.mockResolvedValue([]);
  mocks.previewAdminMerge.mockResolvedValue({ eligible: true, blockers: [], warnings: [] });
  mocks.executeAdminMerge.mockResolvedValue(mergedResult);
  mocks.finalizeMergeSideEffects.mockResolvedValue(undefined);
  mocks.listConflicts.mockResolvedValue([]);
});

describe("authorization -- every Merge Center endpoint is Super-Admin only (route-level check, not just middleware)", () => {
  const calls = {
    search: () => searchRoute.GET(new Request("http://localhost/api/admin/account-merges/search?q=ivan")),
    preview: () =>
      previewRoute.POST(post("http://localhost/api/admin/account-merges/preview", { targetPlayerId: TARGET_ID, sourcePlayerId: SOURCE_ID })),
    execute: () => executeRoute.POST(post("http://localhost/api/admin/account-merges/execute", validExecuteBody)),
    queue: () => queueRoute.GET(),
  };

  for (const [name, call] of Object.entries(calls)) {
    it(`${name}: anonymous -> 401, player -> 403, operator -> 403, admin -> allowed`, async () => {
      signInAs(null);
      expect((await call()).status).toBe(401);

      signInAs("player");
      expect((await call()).status).toBe(403);

      signInAs("operator");
      expect((await call()).status).toBe(403);

      signInAs("admin");
      expect((await call()).status).toBe(200);
    });
  }

  it("non-admin callers never reach the merge engine", async () => {
    for (const role of [null, "player", "operator"] as const) {
      signInAs(role);
      await calls.execute();
      await calls.preview();
      await calls.search();
    }
    expect(mocks.executeAdminMerge).not.toHaveBeenCalled();
    expect(mocks.previewAdminMerge).not.toHaveBeenCalled();
    expect(mocks.searchPlayersForAdminMerge).not.toHaveBeenCalled();
  });

  it("middleware (operator allowlist) denies operators on every Merge Center route and lets admins through", async () => {
    const paths: Array<[string, string]> = [
      ["GET", "/api/admin/account-merges"],
      ["GET", "/api/admin/account-merges/search?q=ivan"],
      ["POST", "/api/admin/account-merges/preview"],
      ["POST", "/api/admin/account-merges/execute"],
    ];
    for (const [method, path] of paths) {
      for (const [role, expected] of [
        ["operator", 403],
        ["player", 403],
        ["admin", 200],
      ] as const) {
        mocks.findById.mockResolvedValue(player(ADMIN_ID, role));
        const request = new NextRequest(`http://localhost${path}`, {
          method,
          headers: { cookie: `reraise_session=${signSession(ADMIN_ID)}` },
        });
        const response = await middleware(request);
        expect(response.status, `${role} ${method} ${path}`).toBe(expected);
      }
    }
  });
});

describe("POST /api/admin/account-merges/execute", () => {
  beforeEach(() => signInAs("admin"));

  it("passes ONLY target/source/confirmation to the engine -- client-supplied actor ids, plans, precedence and blocker overrides are ignored", async () => {
    const response = await executeRoute.POST(
      post("http://localhost/api/admin/account-merges/execute", {
        ...validExecuteBody,
        actorPlayerId: "evil-actor",
        plan: { moveEmail: true, moveTelegram: true },
        blockers: [],
        force: true,
        fieldPrecedence: { role: "source" },
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.executeAdminMerge).toHaveBeenCalledTimes(1);
    expect(mocks.executeAdminMerge).toHaveBeenCalledWith({
      targetPlayerId: TARGET_ID,
      sourcePlayerId: SOURCE_ID,
      confirmation: "ОБЪЕДИНИТЬ",
    });
  });

  it("verifies the typed confirmation server-side -- anything but the exact word is rejected without calling the engine", async () => {
    for (const confirmation of [undefined, "", "объединить", "ОБЪЕДИНИТЬ ", "MERGE"]) {
      const response = await executeRoute.POST(
        post("http://localhost/api/admin/account-merges/execute", { ...validExecuteBody, confirmation })
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.executeAdminMerge).not.toHaveBeenCalled();
  });

  it("rejects malformed ids with 400", async () => {
    const response = await executeRoute.POST(
      post("http://localhost/api/admin/account-merges/execute", { ...validExecuteBody, sourcePlayerId: "not-a-uuid" })
    );
    expect(response.status).toBe(400);
    expect(mocks.executeAdminMerge).not.toHaveBeenCalled();
  });

  it("blocked merge -> 409 with the server-computed blockers; no side effects run", async () => {
    mocks.executeAdminMerge.mockResolvedValue({
      merged: false,
      blockers: [{ code: "tournament_overlap", message: "Оба аккаунта имеют данные турнира X — 12.10.2026" }],
    });

    const response = await executeRoute.POST(post("http://localhost/api/admin/account-merges/execute", validExecuteBody));

    expect(response.status).toBe(409);
    expect((await response.json()).blockers[0].code).toBe("tournament_overlap");
    expect(mocks.finalizeMergeSideEffects).not.toHaveBeenCalled();
  });

  it("success -> refreshes target achievements after commit", async () => {
    const response = await executeRoute.POST(post("http://localhost/api/admin/account-merges/execute", validExecuteBody));

    expect(response.status).toBe(200);
    expect(mocks.finalizeMergeSideEffects).toHaveBeenCalledWith(TARGET_ID);
    expect((await response.json()).achievementRefreshFailed).toBe(false);
  });

  it("achievement refresh failure does NOT fail the (already committed) merge -- reported separately", async () => {
    mocks.finalizeMergeSideEffects.mockRejectedValue(new Error("cache down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await executeRoute.POST(post("http://localhost/api/admin/account-merges/execute", validExecuteBody));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.achievementRefreshFailed).toBe(true);
    errorSpy.mockRestore();
  });

  it("concurrent-update failure -> 409, never a 500", async () => {
    mocks.executeAdminMerge.mockRejectedValue(new FakeAdminMergeConcurrentUpdateError("changed"));
    const response = await executeRoute.POST(post("http://localhost/api/admin/account-merges/execute", validExecuteBody));
    expect(response.status).toBe(409);
  });

  it("logs only UUIDs and the outcome -- never emails or Telegram ids", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await executeRoute.POST(post("http://localhost/api/admin/account-merges/execute", validExecuteBody));

    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).toContain(ADMIN_ID);
    expect(logged).toContain(TARGET_ID);
    expect(logged).toContain(SOURCE_ID);
    expect(logged).not.toContain("t@example.com");
    expect(logged).not.toContain("telegram_username");
    infoSpy.mockRestore();
  });
});

describe("POST /api/admin/account-merges/preview and GET search", () => {
  beforeEach(() => signInAs("admin"));

  it("preview forwards only the two ids (server recomputes everything)", async () => {
    await previewRoute.POST(
      post("http://localhost/api/admin/account-merges/preview", {
        targetPlayerId: TARGET_ID,
        sourcePlayerId: SOURCE_ID,
        blockers: [],
      })
    );
    expect(mocks.previewAdminMerge).toHaveBeenCalledWith({ targetPlayerId: TARGET_ID, sourcePlayerId: SOURCE_ID });
  });

  it("search forwards the q parameter", async () => {
    await searchRoute.GET(new Request("http://localhost/api/admin/account-merges/search?q=%40ivan"));
    expect(mocks.searchPlayersForAdminMerge).toHaveBeenCalledWith("@ivan");
  });
});
