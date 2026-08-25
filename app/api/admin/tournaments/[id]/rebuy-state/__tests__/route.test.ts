import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSetTournamentPlayerRebuyState = vi.fn();

vi.mock("@/features/tournaments", () => ({
  setTournamentPlayerRebuyState: mockSetTournamentPlayerRebuyState,
}));

const { POST } = await import("@/app/api/admin/tournaments/[id]/rebuy-state/route");

function context(id = "t1") {
  return { params: Promise.resolve({ id }) };
}

function request(body: unknown) {
  return new Request("http://localhost/api/admin/tournaments/t1/rebuy-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockSetTournamentPlayerRebuyState.mockReset();
});

describe("POST /api/admin/tournaments/[id]/rebuy-state", () => {
  it("threads player_id/rebuys/addons through and returns the repository result", async () => {
    mockSetTournamentPlayerRebuyState.mockResolvedValue({ rebuys: 2, addons: 1 });

    const response = await POST(request({ player_id: "p1", rebuys: 2, addons: 1 }), context("t1"));
    const json = await response.json();

    expect(mockSetTournamentPlayerRebuyState).toHaveBeenCalledWith("t1", "p1", 2, 1);
    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, rebuys: 2, addons: 1 });
  });

  it("rejects a missing player_id", async () => {
    const response = await POST(request({ rebuys: 1, addons: 0 }), context());
    expect(response.status).toBe(400);
    expect(mockSetTournamentPlayerRebuyState).not.toHaveBeenCalled();
  });

  it("rejects a negative rebuys value", async () => {
    const response = await POST(request({ player_id: "p1", rebuys: -1, addons: 0 }), context());
    expect(response.status).toBe(400);
    expect(mockSetTournamentPlayerRebuyState).not.toHaveBeenCalled();
  });

  it("rejects a negative addons value", async () => {
    const response = await POST(request({ player_id: "p1", rebuys: 0, addons: -1 }), context());
    expect(response.status).toBe(400);
    expect(mockSetTournamentPlayerRebuyState).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric rebuys/addons", async () => {
    const response = await POST(
      request({ player_id: "p1", rebuys: "two", addons: 0 }),
      context()
    );
    expect(response.status).toBe(400);
    expect(mockSetTournamentPlayerRebuyState).not.toHaveBeenCalled();
  });

  it("accepts rebuys:0, addons:0 (the untouched default) without error", async () => {
    mockSetTournamentPlayerRebuyState.mockResolvedValue({ rebuys: 0, addons: 0 });

    const response = await POST(request({ player_id: "p1", rebuys: 0, addons: 0 }), context());

    expect(response.status).toBe(200);
    expect(mockSetTournamentPlayerRebuyState).toHaveBeenCalledWith("t1", "p1", 0, 0);
  });

  it("returns 500 with the feature-layer error message when the repository call throws", async () => {
    mockSetTournamentPlayerRebuyState.mockRejectedValue(new Error("db unreachable"));

    const response = await POST(request({ player_id: "p1", rebuys: 1, addons: 0 }), context());
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("db unreachable");
  });
});
