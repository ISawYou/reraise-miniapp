import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyFinanceSyncRequest } from "@/lib/finance-sync-auth";

const ORIGINAL_TOKEN = process.env.FINANCE_SYNC_TOKEN;
const TEST_TOKEN = "test-only-finance-sync-token-do-not-use-in-production";

function requestWithAuth(header: string | null) {
  const headers = new Headers();
  if (header !== null) {
    headers.set("authorization", header);
  }
  return new Request("http://localhost/api/internal/finance/tournaments", { headers });
}

describe("verifyFinanceSyncRequest", () => {
  beforeEach(() => {
    process.env.FINANCE_SYNC_TOKEN = TEST_TOKEN;
  });

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.FINANCE_SYNC_TOKEN;
    } else {
      process.env.FINANCE_SYNC_TOKEN = ORIGINAL_TOKEN;
    }
  });

  it("accepts the correct bearer token", () => {
    expect(verifyFinanceSyncRequest(requestWithAuth(`Bearer ${TEST_TOKEN}`))).toBe(true);
  });

  it("rejects a missing Authorization header (401, not a crash)", () => {
    expect(verifyFinanceSyncRequest(requestWithAuth(null))).toBe(false);
  });

  it("rejects a non-Bearer scheme", () => {
    expect(verifyFinanceSyncRequest(requestWithAuth(`Basic ${TEST_TOKEN}`))).toBe(false);
  });

  it("rejects a wrong token", () => {
    expect(verifyFinanceSyncRequest(requestWithAuth("Bearer wrong-token"))).toBe(false);
  });

  it("rejects a token that is a prefix/suffix of the real one (length mismatch)", () => {
    expect(verifyFinanceSyncRequest(requestWithAuth(`Bearer ${TEST_TOKEN}extra`))).toBe(false);
    expect(
      verifyFinanceSyncRequest(requestWithAuth(`Bearer ${TEST_TOKEN.slice(0, -1)}`))
    ).toBe(false);
  });

  it("fails closed when the server has no token configured, even with a matching-looking header", () => {
    delete process.env.FINANCE_SYNC_TOKEN;
    expect(verifyFinanceSyncRequest(requestWithAuth(`Bearer ${TEST_TOKEN}`))).toBe(false);
  });

  it("rejects an empty bearer token", () => {
    expect(verifyFinanceSyncRequest(requestWithAuth("Bearer "))).toBe(false);
  });

  it("never authenticates with the unrelated Poker Clock integration token", () => {
    delete process.env.FINANCE_SYNC_TOKEN;
    process.env.POKER_CLOCK_INTEGRATION_TOKEN = TEST_TOKEN;
    expect(verifyFinanceSyncRequest(requestWithAuth(`Bearer ${TEST_TOKEN}`))).toBe(false);
    delete process.env.POKER_CLOCK_INTEGRATION_TOKEN;
  });
});
