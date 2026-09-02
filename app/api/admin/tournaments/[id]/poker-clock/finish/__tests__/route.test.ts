import { describe, expect, it, vi, beforeEach } from "vitest";

// Admin/operator auth itself is enforced entirely by middleware.ts (see
// lib/admin-permissions.ts + middleware.test.ts's "poker-clock/finish"
// coverage and lib/__tests__/admin-permissions.test.ts) -- this route, like
// every other /api/admin/** handler, does no auth check of its own. This
// file only covers this route's own narrow behavior.
const mocks = vi.hoisted(() => ({
  getTournamentById: vi.fn(),
  finishPokerClockTournament: vi.fn(),
}));

vi.mock("@/features/tournaments", () => ({
  getTournamentById: mocks.getTournamentById,
}));

vi.mock("@/lib/poker-clock-client", () => ({
  finishPokerClockTournament: mocks.finishPokerClockTournament,
}));

const { POST } = await import(
  "@/app/api/admin/tournaments/[id]/poker-clock/finish/route"
);

function context(id = "t1") {
  return { params: Promise.resolve({ id }) };
}

function request() {
  return new Request("http://localhost/api/admin/tournaments/t1/poker-clock/finish", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getTournamentById.mockResolvedValue({ id: "t1", status: "completed" });
  mocks.finishPokerClockTournament.mockResolvedValue({ status: "not_linked" });
});

describe("POST /api/admin/tournaments/[id]/poker-clock/finish", () => {
  it("verifies the ReRaise tournament exists before doing anything else", async () => {
    await POST(request(), context("t1"));

    expect(mocks.getTournamentById).toHaveBeenCalledWith("t1");
  });

  it("rejects a non-completed ReRaise tournament with 409, without calling Poker Clock at all", async () => {
    mocks.getTournamentById.mockResolvedValue({ id: "t1", status: "open" });

    const response = await POST(request(), context());
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toBeTruthy();
    expect(mocks.finishPokerClockTournament).not.toHaveBeenCalled();
  });

  it.each(["open", "closed", "draft"] as const)(
    "rejects status=%s the same way -- only status === 'completed' is accepted",
    async (status) => {
      mocks.getTournamentById.mockResolvedValue({ id: "t1", status });

      const response = await POST(request(), context());

      expect(response.status).toBe(409);
      expect(mocks.finishPokerClockTournament).not.toHaveBeenCalled();
    }
  );

  it("calls ONLY finishPokerClockTournament for an already-completed tournament -- no rating/results/GS write of any kind", async () => {
    await POST(request(), context("t1"));

    expect(mocks.finishPokerClockTournament).toHaveBeenCalledTimes(1);
    expect(mocks.finishPokerClockTournament).toHaveBeenCalledWith("t1");
  });

  it("FINISHED succeeds with clean admin-facing semantics", async () => {
    mocks.finishPokerClockTournament.mockResolvedValue({ status: "finished" });

    const response = await POST(request(), context());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ pokerClockSync: { status: "finished" } });
  });

  it("NOT_LINKED resolves safely, same clean shape as FINISHED", async () => {
    mocks.finishPokerClockTournament.mockResolvedValue({ status: "not_linked" });

    const response = await POST(request(), context());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ pokerClockSync: { status: "not_linked" } });
  });

  it("FAILED does not modify ReRaise -- still a 200 with the failed status, not an HTTP error, no internal reason leaked", async () => {
    mocks.finishPokerClockTournament.mockResolvedValue({
      status: "failed",
      reason: "lifecycle_conflict",
    });

    const response = await POST(request(), context());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ pokerClockSync: { status: "failed" } });
    expect(JSON.stringify(json)).not.toContain("lifecycle_conflict");
  });

  it("is safe to call repeatedly -- two calls each independently resolve, Poker Clock's own idempotent endpoint is what backs this, not any local state", async () => {
    mocks.finishPokerClockTournament.mockResolvedValue({ status: "finished" });

    const first = await POST(request(), context("t1"));
    const second = await POST(request(), context("t1"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.finishPokerClockTournament).toHaveBeenCalledTimes(2);
    expect(mocks.getTournamentById).toHaveBeenCalledTimes(2);
  });

  it("an unexpected error (e.g. tournament lookup failure) returns a safe 500, never a raw internal message leak beyond what's expected", async () => {
    mocks.getTournamentById.mockRejectedValue(new Error("db connection reset"));

    const response = await POST(request(), context());
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBeTruthy();
  });
});
