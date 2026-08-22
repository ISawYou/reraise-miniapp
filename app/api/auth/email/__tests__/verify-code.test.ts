import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { COOKIE_NAME, verifySession } from "@/lib/telegram-web-session";

const mocks = vi.hoisted(() => ({
  ensurePlayerFromEmailServer: vi.fn(),
  linkEmailToPlayerServer: vi.fn(),
  verifyEmailOtpCode: vi.fn(),
}));

vi.mock("@/lib/email-otp", () => ({
  isValidEmail: () => true,
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
  verifyEmailOtpCode: mocks.verifyEmailOtpCode,
}));

vi.mock("@/features/auth-server", () => ({
  ensurePlayerFromEmailServer: mocks.ensurePlayerFromEmailServer,
  linkEmailToPlayerServer: mocks.linkEmailToPlayerServer,
}));

const { POST } = await import("@/app/api/auth/email/verify-code/route");

beforeEach(() => {
  process.env.SESSION_SECRET = "academy-web-auth-regression-secret";
  mocks.verifyEmailOtpCode.mockReset().mockResolvedValue({ ok: true });
  mocks.ensurePlayerFromEmailServer.mockReset().mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    email: "player@example.com",
  });
  mocks.linkEmailToPlayerServer.mockReset();
});

describe("email OTP canonical session", () => {
  it("sets the same signed reraise_session consumed by Academy", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/auth/email/verify-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "Player@Example.com",
          code: "123456",
          purpose: "login",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const sessionCookie = response.cookies.get(COOKIE_NAME);
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.path).toBe("/");
    expect(verifySession(sessionCookie?.value ?? "")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });
});
