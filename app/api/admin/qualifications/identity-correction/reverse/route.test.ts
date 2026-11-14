import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ auth: vi.fn(), reverse: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ assertServerActorRole: h.auth }));
vi.mock("@/lib/repositories/qualification/completed-identity-correction", () => ({
  IdentityCorrectionError: class IdentityCorrectionError extends Error { status = 409; },
  reverseCompletedIdentityCorrection: h.reverse,
}));

import { POST } from "./route";

beforeEach(() => { h.auth.mockReset(); h.reverse.mockReset(); h.auth.mockResolvedValue({ id: "admin", role: "admin" }); });

it("passes the original audit and authenticated actor to the guarded reversal", async () => {
  h.reverse.mockResolvedValue({ ok: true, version: 41 });
  const response = await POST(new Request("https://re-raise.ru/api/admin/qualifications/identity-correction/reverse", { method: "POST", body: JSON.stringify({ originalAuditId: "audit", expectedVersion: 40, reason: "Отмена проверенной identity коррекции" }) }));
  expect(response.status).toBe(200);
  expect(h.auth).toHaveBeenCalledWith(["admin"]);
  expect(h.reverse).toHaveBeenCalledWith("admin", "audit", 40, "Отмена проверенной identity коррекции");
});

it("rejects malformed reversal input before repository access", async () => {
  const response = await POST(new Request("https://re-raise.ru/api/admin/qualifications/identity-correction/reverse", { method: "POST", body: JSON.stringify({ originalAuditId: "audit", expectedVersion: "40", reason: "x" }) }));
  expect(response.status).toBe(400);
  expect(h.reverse).not.toHaveBeenCalled();
});
