import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  read: vi.fn(),
  append: vi.fn(),
}));
vi.mock("@/lib/admin-auth", () => {
  class UnauthorizedActionError extends Error {}
  class ForbiddenActionError extends Error {}
  return { assertServerActorRole: h.auth, UnauthorizedActionError, ForbiddenActionError };
});
vi.mock("@/lib/repositories/pko/PostgresPkoLedgerRepository", () => ({
  PkoLedgerError: class extends Error { constructor(message: string, public status: number) { super(message); } },
  pkoLedgerRepository: { read: h.read, append: h.append },
}));
import { GET, POST } from "../route";
import { ForbiddenActionError, UnauthorizedActionError } from "@/lib/admin-auth";
import { PkoLedgerError } from "@/lib/repositories/pko/PostgresPkoLedgerRepository";
import { PkoAccountingError } from "@/lib/progressive-knockout-core";

const ctx = { params: Promise.resolve({ id: "tournament-id" }) };
const request = (body: unknown) => new Request("http://localhost/pko-ledger", {
  method: "POST", body: JSON.stringify(body),
});

beforeEach(() => {
  vi.stubEnv("DATABASE_PROVIDER", "postgres");
  h.auth.mockReset().mockResolvedValue({ id: "real-staff" });
  h.read.mockReset().mockResolvedValue({ revision: 0, events: [], snapshot: {} });
  h.append.mockReset().mockResolvedValue({ revision: 1, events: [], snapshot: {}, duplicate: false });
});

describe("PKO admin-only ledger endpoint", () => {
  it.each([GET, POST])("blocks unauthenticated access before any DB access", async handler => {
    h.auth.mockRejectedValue(new UnauthorizedActionError("Not signed in"));
    const response = await handler(request({ expectedRevision: 0, event: { kind: "entry" } }), ctx);
    expect(response.status).toBe(401);
    expect(h.read).not.toHaveBeenCalled();
    expect(h.append).not.toHaveBeenCalled();
  });
  it("rejects unauthorized roles", async () => {
    h.auth.mockRejectedValue(new ForbiddenActionError("Forbidden"));
    expect((await POST(request({ expectedRevision: 0, event: {} }), ctx)).status).toBe(403);
    expect(h.append).not.toHaveBeenCalled();
  });
  it("uses server actor ID, never caller-supplied actor ID", async () => {
    const event = { kind: "entry", eventId: "request-1", entryId: "entry-1", playerId: "player-1" };
    const response = await POST(request({ expectedRevision: 0, actorId: "forged-admin", event }), ctx);
    expect(response.status).toBe(200);
    expect(h.append).toHaveBeenCalledWith({
      tournamentId: "tournament-id", actorId: "real-staff", expectedRevision: 0, event,
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it.each([{}, { expectedRevision: -1, event: {} }, { expectedRevision: 1.5, event: {} }, { expectedRevision: 0 }])(
    "rejects missing or malformed optimistic revision / event: %j", async body => {
      expect((await POST(request(body), ctx)).status).toBe(400);
      expect(h.append).not.toHaveBeenCalled();
    },
  );
  it("fails closed if database provider is not postgres", async () => {
    vi.stubEnv("DATABASE_PROVIDER", "supabase");
    expect((await GET(request({}), ctx)).status).toBe(503);
    expect((await POST(request({ expectedRevision: 0, event: {} }), ctx)).status).toBe(503);
    expect(h.read).not.toHaveBeenCalled();
    expect(h.append).not.toHaveBeenCalled();
  });
  it("preserves server-side 409 revision conflicts", async () => {
    h.append.mockRejectedValue(new PkoLedgerError("Revision mismatch", 409));
    const response = await POST(request({ expectedRevision: 0, event: {} }), ctx);
    expect(response.status).toBe(409);
  });
  it("responds 400 to invalid PKO event data", async () => {
    h.append.mockRejectedValue(new PkoAccountingError("Invalid KO share"));
    const response = await POST(request({ expectedRevision: 0, event: {} }), ctx);
    expect(response.status).toBe(400);
  });
  it("does not leak unexpected database errors", async () => {
    h.append.mockRejectedValue(new Error("connection string: secret"));
    const response = await POST(request({ expectedRevision: 0, event: {} }), ctx);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});

it("allows staff ledger GET/POST and keeps unrelated admin paths denied", async () => {
  const { isAdminRouteAllowedForOperator } = await import("@/lib/admin-permissions");
  expect(isAdminRouteAllowedForOperator("GET", "/api/admin/tournaments/t/pko-ledger")).toBe(true);
  expect(isAdminRouteAllowedForOperator("POST", "/api/admin/tournaments/t/pko-ledger")).toBe(true);
  expect(isAdminRouteAllowedForOperator("PATCH", "/api/admin/tournaments/t/pko-ledger")).toBe(false);
  expect(isAdminRouteAllowedForOperator("POST", "/api/admin/tournaments/t/pko-ledger/audit")).toBe(false);
});
