import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetPendingNicknames = vi.fn();
const mockResolveCurrentServerActor = vi.fn();

vi.mock("@/features/auth", () => ({
  getPendingNicknames: mockGetPendingNicknames,
}));

vi.mock("@/lib/admin-auth", () => ({
  resolveCurrentServerActor: mockResolveCurrentServerActor,
}));

const { GET } = await import("@/app/api/admin/nicknames/pending/route");

const fullPlayer = {
  id: "p1",
  username: "u1",
  display_name: "OldNick",
  admin_display_name: undefined,
  pending_display_name: "NewNick",
  email: "player@example.com",
  role: "player" as const,
  is_blocked: false,
  telegram_id: 123,
  referral_count: 4,
};

beforeEach(() => {
  mockGetPendingNicknames.mockReset();
  mockResolveCurrentServerActor.mockReset();
});

describe("GET /api/admin/nicknames/pending", () => {
  it("returns the full player payload for an admin caller, unchanged", async () => {
    mockGetPendingNicknames.mockResolvedValue([fullPlayer]);
    mockResolveCurrentServerActor.mockResolvedValue({ id: "admin1", role: "admin" });

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.players[0]).toEqual(fullPlayer);
  });

  it("strips email/role/is_blocked/referral stats/etc. for a non-admin (operator) caller", async () => {
    mockGetPendingNicknames.mockResolvedValue([fullPlayer]);
    mockResolveCurrentServerActor.mockResolvedValue({ id: "op1", role: "operator" });

    const response = await GET();
    const json = await response.json();

    expect(json.players[0]).toEqual({
      id: "p1",
      username: "u1",
      display_name: "OldNick",
      admin_display_name: undefined,
      pending_display_name: "NewNick",
    });
    expect(json.players[0].email).toBeUndefined();
    expect(json.players[0].role).toBeUndefined();
    expect(json.players[0].is_blocked).toBeUndefined();
    expect(json.players[0].telegram_id).toBeUndefined();
    expect(json.players[0].referral_count).toBeUndefined();
  });

  it("keeps what a decision actually needs: identity + the submitted nickname", async () => {
    mockGetPendingNicknames.mockResolvedValue([fullPlayer]);
    mockResolveCurrentServerActor.mockResolvedValue({ id: "op1", role: "operator" });

    const response = await GET();
    const json = await response.json();

    expect(json.players[0].display_name).toBe("OldNick");
    expect(json.players[0].pending_display_name).toBe("NewNick");
    expect(json.players[0].username).toBe("u1");
  });
});
