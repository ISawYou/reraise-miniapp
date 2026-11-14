import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ auth: vi.fn(), preview: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ assertServerActorRole: h.auth }));
vi.mock("@/lib/repositories/qualification/completed-identity-correction", () => ({
  IdentityCorrectionError: class IdentityCorrectionError extends Error { status = 409; },
  previewCompletedIdentityCorrection: h.preview,
  applyCompletedIdentityCorrection: h.apply,
}));

import { GET, POST } from "./route";

beforeEach(() => { h.auth.mockReset(); h.preview.mockReset(); h.apply.mockReset(); h.auth.mockResolvedValue({ id: "admin", role: "admin" }); });

it("allows only the Super Admin server guard to preview", async () => {
  h.preview.mockResolvedValue({ event: { status: "completed", version: 39 } });
  const response = await GET(new Request("https://re-raise.ru/api/admin/qualifications/identity-correction?version=39"));
  expect(response.status).toBe(200);
  expect(h.auth).toHaveBeenCalledWith(["admin"]);
  expect(h.preview).toHaveBeenCalledWith(39);
});

it("validates apply input and passes the authenticated actor, never a client actor", async () => {
  h.apply.mockResolvedValue({ ok: true, version: 40 });
  const response = await POST(new Request("https://re-raise.ru/api/admin/qualifications/identity-correction", { method: "POST", body: JSON.stringify({ expectedVersion: 39, reason: "Исправление подтверждённой identity записи" }) }));
  expect(response.status).toBe(200);
  expect(h.apply).toHaveBeenCalledWith("admin", 39, "Исправление подтверждённой identity записи");
});

it("rejects malformed apply requests before repository access", async () => {
  const response = await POST(new Request("https://re-raise.ru/api/admin/qualifications/identity-correction", { method: "POST", body: JSON.stringify({ expectedVersion: "39", reason: "x" }) }));
  expect(response.status).toBe(400);
  expect(h.apply).not.toHaveBeenCalled();
});
