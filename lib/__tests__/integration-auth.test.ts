import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyIntegrationRequest } from "@/lib/integration-auth";

const ORIGINAL_TOKEN = process.env.POKER_CLOCK_INTEGRATION_TOKEN;
const TEST_TOKEN = "test-only-token-do-not-use-in-production-1234567890";

function requestWithAuth(header: string | null) {
  const headers = new Headers();
  if (header !== null) {
    headers.set("authorization", header);
  }
  return new Request("http://localhost/api/integrations/v1/tournaments", { headers });
}

describe("verifyIntegrationRequest", () => {
  beforeEach(() => {
    process.env.POKER_CLOCK_INTEGRATION_TOKEN = TEST_TOKEN;
  });

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.POKER_CLOCK_INTEGRATION_TOKEN;
    } else {
      process.env.POKER_CLOCK_INTEGRATION_TOKEN = ORIGINAL_TOKEN;
    }
  });

  it("accepts the correct bearer token", () => {
    expect(verifyIntegrationRequest(requestWithAuth(`Bearer ${TEST_TOKEN}`))).toBe(true);
  });

  it("rejects a missing Authorization header (401, not a crash)", () => {
    expect(verifyIntegrationRequest(requestWithAuth(null))).toBe(false);
  });

  it("rejects a non-Bearer scheme", () => {
    expect(verifyIntegrationRequest(requestWithAuth(`Basic ${TEST_TOKEN}`))).toBe(false);
  });

  it("rejects a wrong token", () => {
    expect(verifyIntegrationRequest(requestWithAuth("Bearer wrong-token"))).toBe(false);
  });

  it("rejects a token that is a prefix/suffix of the real one (length mismatch)", () => {
    expect(verifyIntegrationRequest(requestWithAuth(`Bearer ${TEST_TOKEN}extra`))).toBe(false);
    expect(
      verifyIntegrationRequest(requestWithAuth(`Bearer ${TEST_TOKEN.slice(0, -1)}`))
    ).toBe(false);
  });

  it("fails closed when the server has no token configured, even with a matching-looking header", () => {
    delete process.env.POKER_CLOCK_INTEGRATION_TOKEN;
    expect(verifyIntegrationRequest(requestWithAuth(`Bearer ${TEST_TOKEN}`))).toBe(false);
  });

  it("rejects an empty bearer token", () => {
    expect(verifyIntegrationRequest(requestWithAuth("Bearer "))).toBe(false);
  });
});
