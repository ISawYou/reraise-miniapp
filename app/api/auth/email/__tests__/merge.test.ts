import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { COOKIE_NAME, signSession } from "@/lib/telegram-web-session";

const mocks = vi.hoisted(() => ({
  getPlayerFromSessionServer: vi.fn(),
  executeMerge: vi.fn(),
  finalizeMergeSideEffects: vi.fn(),
  findById: vi.fn(),
}));

vi.mock("@/features/auth-server", () => ({
  getPlayerFromSessionServer: mocks.getPlayerFromSessionServer,
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: { findById: mocks.findById },
}));

class FakeMergeIntentNotFoundError extends Error {}
class FakeMergeIntentForbiddenError extends Error {}
class FakeMergeIntentNotPendingError extends Error {}
class FakeMergeIntentExpiredError extends Error {}
class FakeAccountMergeUnavailableError extends Error {}

vi.mock("@/lib/player-merge", () => ({
  executeMerge: mocks.executeMerge,
  finalizeMergeSideEffects: mocks.finalizeMergeSideEffects,
  MergeIntentNotFoundError: FakeMergeIntentNotFoundError,
  MergeIntentForbiddenError: FakeMergeIntentForbiddenError,
  MergeIntentNotPendingError: FakeMergeIntentNotPendingError,
  MergeIntentExpiredError: FakeMergeIntentExpiredError,
  AccountMergeUnavailableError: FakeAccountMergeUnavailableError,
}));

const { POST } = await import("@/app/api/auth/email/merge/route");

const SESSION_PLAYER_ID = "11111111-1111-4111-8111-111111111111";

function requestWith(body: unknown, sessionValue?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sessionValue) headers.cookie = `${COOKIE_NAME}=${sessionValue}`;
  return new NextRequest("http://localhost/api/auth/email/merge", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.SESSION_SECRET = "merge-route-test-secret";
  mocks.getPlayerFromSessionServer.mockReset();
  mocks.executeMerge.mockReset();
  mocks.finalizeMergeSideEffects.mockReset().mockResolvedValue(undefined);
  mocks.findById.mockReset();
});

describe("POST /api/auth/email/merge", () => {
  it("rejects without a valid session -- target is never client-supplied", async () => {
    mocks.getPlayerFromSessionServer.mockResolvedValue(null);

    const response = await POST(requestWith({ mergeIntentId: "intent-1" }, "garbage"));

    expect(response.status).toBe(401);
    expect(mocks.executeMerge).not.toHaveBeenCalled();
  });

  it("target is always the session's own id -- the client cannot supply a different target/source", async () => {
    const sessionValue = signSession(SESSION_PLAYER_ID);
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.executeMerge.mockResolvedValue({ merged: true });
    mocks.findById.mockResolvedValue({ id: SESSION_PLAYER_ID });

    await POST(
      requestWith({ mergeIntentId: "intent-1", targetPlayerId: "someone-else" }, sessionValue)
    );

    expect(mocks.executeMerge).toHaveBeenCalledWith({
      intentId: "intent-1",
      sessionPlayerId: SESSION_PLAYER_ID,
    });
  });

  it("requires mergeIntentId", async () => {
    const sessionValue = signSession(SESSION_PLAYER_ID);
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });

    const response = await POST(requestWith({}, sessionValue));

    expect(response.status).toBe(400);
    expect(mocks.executeMerge).not.toHaveBeenCalled();
  });

  it("a conflict discovered inside the transaction returns 409 without finalizing side effects", async () => {
    const sessionValue = signSession(SESSION_PLAYER_ID);
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.executeMerge.mockResolvedValue({ merged: false, conflict: true, reason: "overlap" });

    const response = await POST(requestWith({ mergeIntentId: "intent-1" }, sessionValue));

    expect(response.status).toBe(409);
    expect(mocks.finalizeMergeSideEffects).not.toHaveBeenCalled();
  });

  it("returns the fresh target player and runs finalizeMergeSideEffects on success", async () => {
    const sessionValue = signSession(SESSION_PLAYER_ID);
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.executeMerge.mockResolvedValue({ merged: true });
    mocks.findById.mockResolvedValue({ id: SESSION_PLAYER_ID, email: "merged@example.com" });

    const response = await POST(requestWith({ mergeIntentId: "intent-1" }, sessionValue));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.player.email).toBe("merged@example.com");
    expect(mocks.finalizeMergeSideEffects).toHaveBeenCalledWith(SESSION_PLAYER_ID);
  });

  it("retries exactly once on a Postgres serialization failure, then succeeds", async () => {
    const sessionValue = signSession(SESSION_PLAYER_ID);
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.findById.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.executeMerge
      .mockRejectedValueOnce(Object.assign(new Error("serialization failure"), { code: "40001" }))
      .mockResolvedValueOnce({ merged: true });

    const response = await POST(requestWith({ mergeIntentId: "intent-1" }, sessionValue));

    expect(response.status).toBe(200);
    expect(mocks.executeMerge).toHaveBeenCalledTimes(2);
  });

  it("retries on a serialization failure nested under .cause, not just a flat top-level .code", async () => {
    const sessionValue = signSession(SESSION_PLAYER_ID);
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.findById.mockResolvedValue({ id: SESSION_PLAYER_ID });
    const nested = new Error("Failed query", {
      cause: Object.assign(new Error("serialization failure"), { code: "40001" }),
    });
    mocks.executeMerge.mockRejectedValueOnce(nested).mockResolvedValueOnce({ merged: true });

    const response = await POST(requestWith({ mergeIntentId: "intent-1" }, sessionValue));

    expect(response.status).toBe(200);
    expect(mocks.executeMerge).toHaveBeenCalledTimes(2);
  });

  it("does not retry a second time -- a repeated serialization failure surfaces as an error, not an infinite loop", async () => {
    const sessionValue = signSession(SESSION_PLAYER_ID);
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.executeMerge.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "40001" })
    );

    const response = await POST(requestWith({ mergeIntentId: "intent-1" }, sessionValue));

    expect(response.status).toBe(500);
    expect(mocks.executeMerge).toHaveBeenCalledTimes(2);
  });

  it("maps MergeIntentForbiddenError to 403", async () => {
    const sessionValue = signSession(SESSION_PLAYER_ID);
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.executeMerge.mockRejectedValue(new FakeMergeIntentForbiddenError("forbidden"));

    const response = await POST(requestWith({ mergeIntentId: "intent-1" }, sessionValue));

    expect(response.status).toBe(403);
  });

  it("maps MergeIntentNotPendingError to 409 -- duplicate confirm is rejected, not silently re-merged", async () => {
    const sessionValue = signSession(SESSION_PLAYER_ID);
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.executeMerge.mockRejectedValue(new FakeMergeIntentNotPendingError("done"));

    const response = await POST(requestWith({ mergeIntentId: "intent-1" }, sessionValue));

    expect(response.status).toBe(409);
  });

  it("maps MergeIntentExpiredError to 410", async () => {
    const sessionValue = signSession(SESSION_PLAYER_ID);
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.executeMerge.mockRejectedValue(new FakeMergeIntentExpiredError("expired"));

    const response = await POST(requestWith({ mergeIntentId: "intent-1" }, sessionValue));

    expect(response.status).toBe(410);
  });

  it("maps MergeIntentNotFoundError to 404", async () => {
    const sessionValue = signSession(SESSION_PLAYER_ID);
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.executeMerge.mockRejectedValue(new FakeMergeIntentNotFoundError("missing"));

    const response = await POST(requestWith({ mergeIntentId: "intent-1" }, sessionValue));

    expect(response.status).toBe(404);
  });

  // Blocker 4 (DATABASE_PROVIDER audit): the intent could only have been
  // created under DATABASE_PROVIDER=postgres, so reaching this means the
  // provider changed between intent creation and confirmation -- a
  // distinct 503, never a generic 500, and never a partial mutation
  // (executeMerge's own assertPostgresMode runs before opening any
  // transaction).
  it("maps AccountMergeUnavailableError to a distinct 503, not the generic 500", async () => {
    const sessionValue = signSession(SESSION_PLAYER_ID);
    mocks.getPlayerFromSessionServer.mockResolvedValue({ id: SESSION_PLAYER_ID });
    mocks.executeMerge.mockRejectedValue(new FakeAccountMergeUnavailableError());

    const response = await POST(requestWith({ mergeIntentId: "intent-1" }, sessionValue));

    expect(response.status).toBe(503);
    expect(mocks.finalizeMergeSideEffects).not.toHaveBeenCalled();
  });
});
