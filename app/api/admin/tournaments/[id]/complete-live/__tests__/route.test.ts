import { beforeEach, describe, expect, it, vi } from "vitest";
import { TournamentAlreadyCompletedError } from "@/lib/tournament-errors";

const mocks = vi.hoisted(() => ({
  getTournamentById: vi.fn(),
  completeTournamentFromLiveEntries: vi.fn(),
  auth: vi.fn(async () => ({ id: "staff", role: "operator" })),
}));

vi.mock("@/features/tournaments", () => ({
  getTournamentById: mocks.getTournamentById,
  completeTournamentFromLiveEntries: mocks.completeTournamentFromLiveEntries,
}));

vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: mocks.auth,
  UnauthorizedActionError: class UnauthorizedActionError extends Error {},
  ForbiddenActionError: class ForbiddenActionError extends Error {},
}));

const { POST } = await import("@/app/api/admin/tournaments/[id]/complete-live/route");

function context(id = "t1") {
  return { params: Promise.resolve({ id }) };
}

function request(body: unknown) {
  return new Request("http://localhost/api/admin/tournaments/t1/complete-live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const rows = [
  { player_id: "p1", arrived: true, rebuys: 1, addons: 0, knockouts: 0, place: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTournamentById.mockResolvedValue({ id: "t1", status: "open", kind: "cash" });
  mocks.completeTournamentFromLiveEntries.mockResolvedValue({ completedCount: 1 });
});

describe("POST /api/admin/tournaments/[id]/complete-live -- re-completion guard", () => {
  it("an already-completed tournament is rejected with 409 before completion", async () => {
    mocks.getTournamentById.mockResolvedValue({ id: "t1", status: "completed", kind: "cash" });

    const response = await POST(request({ rows }), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Турнир уже завершён" });
    expect(mocks.completeTournamentFromLiveEntries).not.toHaveBeenCalled();
  });

  it("race loser: the locked check inside completion rejects -> 409", async () => {
    mocks.completeTournamentFromLiveEntries.mockRejectedValue(new TournamentAlreadyCompletedError());

    const response = await POST(request({ rows }), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Турнир уже завершён" });
  });

  it("an open tournament completes from PostgreSQL live state", async () => {
    const response = await POST(request({ rows }), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, completedCount: 1 });
    expect(mocks.completeTournamentFromLiveEntries).toHaveBeenCalledWith("t1");
  });
});
