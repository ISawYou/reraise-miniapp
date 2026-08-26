import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetPlayerBlocked = vi.fn();
const mockDeleteManualPlayer = vi.fn();

vi.mock("@/features/admin", () => ({
  setPlayerBlocked: mockSetPlayerBlocked,
  deleteManualPlayer: mockDeleteManualPlayer,
}));

const { PATCH } = await import("@/app/api/admin/players/[id]/route");

function jsonRequest(body?: unknown) {
  return new Request("http://localhost/api/admin/players/player-1", {
    method: "PATCH",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockSetPlayerBlocked.mockReset();
  mockDeleteManualPlayer.mockReset();
});

describe("PATCH /api/admin/players/[id]", () => {
  it("blocks a player", async () => {
    mockSetPlayerBlocked.mockResolvedValue({ id: "player-1", is_blocked: true });

    const response = await PATCH(jsonRequest({ action: "block" }), ctx("player-1"));
    const json = await response.json();

    expect(mockSetPlayerBlocked).toHaveBeenCalledWith("player-1", true);
    expect(response.status).toBe(200);
    expect(json.player.is_blocked).toBe(true);
  });

  it("unblocks a player", async () => {
    mockSetPlayerBlocked.mockResolvedValue({ id: "player-1", is_blocked: false });

    const response = await PATCH(jsonRequest({ action: "unblock" }), ctx("player-1"));
    const json = await response.json();

    expect(mockSetPlayerBlocked).toHaveBeenCalledWith("player-1", false);
    expect(json.player.is_blocked).toBe(false);
  });

  it("rejects an unknown action", async () => {
    const response = await PATCH(jsonRequest({ action: "delete" }), ctx("player-1"));
    expect(response.status).toBe(400);
    expect(mockSetPlayerBlocked).not.toHaveBeenCalled();
  });

  it("surfaces the admin-protection error from the feature layer", async () => {
    mockSetPlayerBlocked.mockRejectedValue(new Error("Нельзя заблокировать администратора"));

    const response = await PATCH(jsonRequest({ action: "block" }), ctx("admin-1"));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("Нельзя заблокировать администратора");
  });
});
