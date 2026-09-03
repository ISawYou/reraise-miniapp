import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { COOKIE_NAME, signSession, verifySession } from "@/lib/telegram-web-session";

const mocks = vi.hoisted(() => ({
  ensurePlayerFromEmailServer: vi.fn(),
  linkEmailToPlayerServer: vi.fn(),
  getPlayerFromSessionServer: vi.fn(),
  verifyEmailOtpCode: vi.fn(),
  createMergeIntent: vi.fn(),
}));

class FakeEmailAlreadyLinkedToAnotherPlayerError extends Error {
  readonly sourcePlayerId: string;
  constructor(sourcePlayerId: string) {
    super("Этот email уже привязан к другому игроку");
    this.sourcePlayerId = sourcePlayerId;
  }
}

class FakeAccountMergeUnavailableError extends Error {}

vi.mock("@/lib/email-otp", () => ({
  isValidEmail: () => true,
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
  verifyEmailOtpCode: mocks.verifyEmailOtpCode,
}));

vi.mock("@/features/auth-server", () => ({
  ensurePlayerFromEmailServer: mocks.ensurePlayerFromEmailServer,
  linkEmailToPlayerServer: mocks.linkEmailToPlayerServer,
  getPlayerFromSessionServer: mocks.getPlayerFromSessionServer,
  EmailAlreadyLinkedToAnotherPlayerError: FakeEmailAlreadyLinkedToAnotherPlayerError,
}));

vi.mock("@/lib/player-merge", () => ({
  createMergeIntent: mocks.createMergeIntent,
  AccountMergeUnavailableError: FakeAccountMergeUnavailableError,
}));

const { POST } = await import("@/app/api/auth/email/verify-code/route");

beforeEach(() => {
  process.env.SESSION_SECRET = "academy-web-auth-regression-secret";
  mocks.verifyEmailOtpCode.mockReset().mockResolvedValue({ ok: true, otpId: "otp-1" });
  mocks.ensurePlayerFromEmailServer.mockReset().mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    email: "player@example.com",
  });
  mocks.linkEmailToPlayerServer.mockReset();
  mocks.getPlayerFromSessionServer.mockReset();
  mocks.createMergeIntent.mockReset();
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

describe("valid OTP + email belongs to another player", () => {
  const SESSION_PLAYER_ID = "22222222-2222-4222-8222-222222222222";
  const SOURCE_PLAYER_ID = "33333333-3333-4333-8333-333333333333";

  it("self-service eligible -> 409 with canMerge + mergeIntentId, no player mutation beyond the merge intent", async () => {
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.linkEmailToPlayerServer.mockRejectedValue(
      new FakeEmailAlreadyLinkedToAnotherPlayerError(SOURCE_PLAYER_ID)
    );
    mocks.createMergeIntent.mockResolvedValue({ id: "intent-1", status: "pending" });

    const response = await POST(
      new NextRequest("http://localhost/api/auth/email/verify-code", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${COOKIE_NAME}=${signSession(SESSION_PLAYER_ID)}`,
        },
        body: JSON.stringify({ email: "taken@example.com", code: "123456", purpose: "link_email" }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.canMerge).toBe(true);
    expect(payload.mergeIntentId).toBe("intent-1");
    expect(mocks.createMergeIntent).toHaveBeenCalledWith({
      targetPlayerId: SESSION_PLAYER_ID,
      sourcePlayerId: SOURCE_PLAYER_ID,
      email: "taken@example.com",
      otpVerificationId: "otp-1",
    });
  });

  it("not self-service eligible -> 409 without canMerge, points to admin review", async () => {
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.linkEmailToPlayerServer.mockRejectedValue(
      new FakeEmailAlreadyLinkedToAnotherPlayerError(SOURCE_PLAYER_ID)
    );
    mocks.createMergeIntent.mockResolvedValue({ id: "intent-2", status: "conflict" });

    const response = await POST(
      new NextRequest("http://localhost/api/auth/email/verify-code", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${COOKIE_NAME}=${signSession(SESSION_PLAYER_ID)}`,
        },
        body: JSON.stringify({ email: "taken@example.com", code: "123456", purpose: "link_email" }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.canMerge).toBe(false);
    expect(payload.mergeIntentId).toBeUndefined();
  });

  // Blocker 4 (DATABASE_PROVIDER audit): under a non-Postgres provider,
  // createMergeIntent() throws AccountMergeUnavailableError -- the route
  // must fold this into the SAME "canMerge: false, contact admin" shape a
  // genuine conflict already returns, never surface a raw 500, and never
  // advertise the "Объединить аккаунты" button the client only shows on
  // canMerge: true.
  it("falls back to canMerge: false (never a raw 500) when account merging is unavailable under the current DATABASE_PROVIDER", async () => {
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.linkEmailToPlayerServer.mockRejectedValue(
      new FakeEmailAlreadyLinkedToAnotherPlayerError(SOURCE_PLAYER_ID)
    );
    mocks.createMergeIntent.mockRejectedValue(new FakeAccountMergeUnavailableError());

    const response = await POST(
      new NextRequest("http://localhost/api/auth/email/verify-code", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${COOKIE_NAME}=${signSession(SESSION_PLAYER_ID)}`,
        },
        body: JSON.stringify({ email: "taken@example.com", code: "123456", purpose: "link_email" }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.canMerge).toBe(false);
    expect(payload.mergeIntentId).toBeUndefined();
  });

  it("rejects link_email with no valid session -- canonical-resolved identity, never a raw cookie read", async () => {
    mocks.getPlayerFromSessionServer.mockResolvedValue(null);

    const response = await POST(
      new NextRequest("http://localhost/api/auth/email/verify-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "taken@example.com", code: "123456", purpose: "link_email" }),
      })
    );

    expect(response.status).toBe(401);
    expect(mocks.linkEmailToPlayerServer).not.toHaveBeenCalled();
  });
});
