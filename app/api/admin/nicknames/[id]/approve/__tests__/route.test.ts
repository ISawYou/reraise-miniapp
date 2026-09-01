import { describe, expect, it, vi, beforeEach } from "vitest";

const mockApproveNickname = vi.fn();
const mockResolveCurrentServerActor = vi.fn();

vi.mock("@/features/auth", () => ({
  approveNickname: mockApproveNickname,
}));

vi.mock("@/lib/admin-auth", () => ({
  resolveCurrentServerActor: mockResolveCurrentServerActor,
}));

const { PATCH } = await import("@/app/api/admin/nicknames/[id]/approve/route");

function context(id = "p1") {
  return { params: Promise.resolve({ id }) };
}

function request() {
  return new Request("http://localhost/api/admin/nicknames/p1/approve", {
    method: "PATCH",
  });
}

beforeEach(() => {
  mockApproveNickname.mockReset();
  mockResolveCurrentServerActor.mockReset();
});

describe("PATCH /api/admin/nicknames/[id]/approve", () => {
  it("approves the player's CURRENT pending nickname as-is, reusing approveNickname", async () => {
    mockApproveNickname.mockResolvedValue({
      id: "p1",
      display_name: "NewNick",
      pending_display_name: undefined,
      email: "player@example.com",
      role: "player",
      is_blocked: false,
    });
    mockResolveCurrentServerActor.mockResolvedValue({ id: "admin1", role: "admin" });

    const response = await PATCH(request(), context());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockApproveNickname).toHaveBeenCalledWith("p1");
    expect(mockApproveNickname).toHaveBeenCalledTimes(1);
    expect(json.player.display_name).toBe("NewNick");
  });

  it("reads no body at all -- there is no way to supply/override the approved display_name", async () => {
    mockApproveNickname.mockResolvedValue({ id: "p1", display_name: "AsSubmitted" });
    mockResolveCurrentServerActor.mockResolvedValue({ id: "op1", role: "operator" });

    // A malicious/careless client attempt to smuggle a different name in --
    // the route never reads request.json() at all, so this is inert.
    const response = await PATCH(
      new Request("http://localhost/api/admin/nicknames/p1/approve", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: "Hijacked" }),
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mockApproveNickname).toHaveBeenCalledWith("p1");
  });

  it("strips email/role/is_blocked/etc. from the response for a non-admin (operator) caller", async () => {
    mockApproveNickname.mockResolvedValue({
      id: "p1",
      username: "u1",
      display_name: "NewNick",
      admin_display_name: undefined,
      email: "player@example.com",
      role: "player",
      is_blocked: false,
      telegram_id: 123,
    });
    mockResolveCurrentServerActor.mockResolvedValue({ id: "op1", role: "operator" });

    const response = await PATCH(request(), context());
    const json = await response.json();

    expect(json.player).toEqual({
      id: "p1",
      username: "u1",
      display_name: "NewNick",
      admin_display_name: undefined,
    });
    expect(json.player.email).toBeUndefined();
    expect(json.player.role).toBeUndefined();
    expect(json.player.is_blocked).toBeUndefined();
  });

  it("propagates 'not actually pending' as an error, same as today", async () => {
    mockApproveNickname.mockRejectedValue(new Error("Нет ника на модерации"));

    const response = await PATCH(request(), context());
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("Нет ника на модерации");
  });
});
