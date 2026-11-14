import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ id: "staff", role: "admin" })),
  getTournamentById: vi.fn(),
  getTournamentSource: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  assertServerActorRole: mocks.auth,
  UnauthorizedActionError: class UnauthorizedActionError extends Error {},
  ForbiddenActionError: class ForbiddenActionError extends Error {},
}));
vi.mock("@/features/tournaments", () => ({ getTournamentById: mocks.getTournamentById }));
vi.mock("@/lib/tournament-source", () => ({ getTournamentSource: mocks.getTournamentSource }));

const { GET, POST } = await import("@/app/api/admin/tournaments/[id]/complete-free/route");
const context = { params: Promise.resolve({ id: "t1" }) };

describe("retired legacy free-sheet completion", () => {
  it("returns source metadata without reading or writing Google Sheets", async () => {
    mocks.getTournamentSource.mockResolvedValue("LEGACY_GOOGLE_SHEETS");
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sourceMode: "LEGACY_GOOGLE_SHEETS", retired: true });
  });

  it("rejects a PostgreSQL completion body and points staff to the native console", async () => {
    mocks.getTournamentById.mockResolvedValue({ status: "open" });
    mocks.getTournamentSource.mockResolvedValue("POSTGRESQL");
    const response = await POST(new Request("http://localhost", { method: "POST", body: "{}" }), context);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "POSTGRES_CONSOLE_REQUIRED", redirectUrl: "/admin/tournaments/t1/control" });
  });

  it("never re-completes a historical tournament", async () => {
    mocks.getTournamentById.mockResolvedValue({ status: "completed" });
    const response = await POST(new Request("http://localhost", { method: "POST", body: "{}" }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "TOURNAMENT_ALREADY_COMPLETED" });
  });
});
