import { beforeEach, describe, expect, it, vi } from "vitest";
import { TournamentAlreadyCompletedError } from "@/lib/tournament-errors";

const mocks = vi.hoisted(() => ({
  getTournamentById: vi.fn(),
  completeTournamentFromLiveEntries: vi.fn(),
  syncTournamentLiveSheet: vi.fn(),
}));

vi.mock("@/features/tournaments", () => ({
  getTournamentById: mocks.getTournamentById,
  completeTournamentFromLiveEntries: mocks.completeTournamentFromLiveEntries,
}));

vi.mock("@/app/api/admin/tournaments/[id]/live-sync/route", () => ({
  syncTournamentLiveSheet: mocks.syncTournamentLiveSheet,
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
  mocks.syncTournamentLiveSheet.mockResolvedValue(undefined);
});

describe("POST /api/admin/tournaments/[id]/complete-live -- re-completion guard", () => {
  it("an already-completed tournament is rejected with 409 BEFORE the pre-completion live/Sheets sync and with no completion call", async () => {
    mocks.getTournamentById.mockResolvedValue({ id: "t1", status: "completed", kind: "cash" });

    const response = await POST(request({ rows }), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Турнир уже завершён" });
    expect(mocks.syncTournamentLiveSheet).not.toHaveBeenCalled();
    expect(mocks.completeTournamentFromLiveEntries).not.toHaveBeenCalled();
  });

  it("race loser: the locked check inside completion rejects -> 409, and the post-completion Sheets sync does not run", async () => {
    mocks.completeTournamentFromLiveEntries.mockRejectedValue(new TournamentAlreadyCompletedError());

    const response = await POST(request({ rows }), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Турнир уже завершён" });
    // Only the pre-completion sync ran (the loser had already passed the
    // unlocked pre-check); the post-completion one never does.
    expect(mocks.syncTournamentLiveSheet).toHaveBeenCalledTimes(1);
  });

  it("an open tournament still completes normally: pre-sync, completion, post-sync", async () => {
    const response = await POST(request({ rows }), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, completedCount: 1 });
    expect(mocks.completeTournamentFromLiveEntries).toHaveBeenCalledWith("t1");
    expect(mocks.syncTournamentLiveSheet).toHaveBeenCalledTimes(2);
  });
});
