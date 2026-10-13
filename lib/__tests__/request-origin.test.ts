import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyRequestOrigin } from "@/lib/request-origin";

// classifyRequestOrigin only decides whether ambient browser credentials may be
// trusted for a mutation. It never identifies anybody.

function req(headers: Record<string, string> = {}, url = "https://re-raise.ru/api/players/x/follow") {
  return new Request(url, { method: "POST", headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("classifyRequestOrigin", () => {
  it("same-origin: Origin equals the request host (https)", () => {
    expect(classifyRequestOrigin(req({ origin: "https://re-raise.ru" }))).toBe("same-origin");
  });

  it("same-origin: honours the Host header behind a reverse proxy", () => {
    // request.url may be an internal address; the public host arrives in Host.
    const request = req({ origin: "https://re-raise.ru", host: "re-raise.ru" }, "http://127.0.0.1:3002/api/x");
    expect(classifyRequestOrigin(request)).toBe("same-origin");
  });

  it("same-origin: honours X-Forwarded-Host (first value of a list)", () => {
    const request = req(
      { origin: "https://www.re-raise.ru", "x-forwarded-host": "www.re-raise.ru, internal" },
      "http://127.0.0.1:3002/api/x"
    );
    expect(classifyRequestOrigin(request)).toBe("same-origin");
  });

  it("same-origin: also accepts the configured public app URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.re-raise.ru/");
    const request = req({ origin: "https://www.re-raise.ru" }, "http://127.0.0.1:3002/api/x");
    expect(classifyRequestOrigin(request)).toBe("same-origin");
  });

  it("same-origin: local development over http://localhost", () => {
    const request = req({ origin: "http://localhost:3100" }, "http://localhost:3100/api/x");
    expect(classifyRequestOrigin(request)).toBe("same-origin");
  });

  it("cross-origin: a different host", () => {
    expect(classifyRequestOrigin(req({ origin: "https://evil.example" }))).toBe("cross-origin");
  });

  it("cross-origin: look-alike hosts (suffix / prefix / userinfo tricks)", () => {
    for (const origin of [
      "https://re-raise.ru.evil.example",
      "https://evilre-raise.ru",
      "https://re-raise.ru@evil.example",
      "https://sub.re-raise.ru",
    ]) {
      expect(classifyRequestOrigin(req({ origin })), origin).toBe("cross-origin");
    }
  });

  it("cross-origin: the opaque Origin \"null\"", () => {
    expect(classifyRequestOrigin(req({ origin: "null" }))).toBe("cross-origin");
  });

  it("cross-origin: malformed Origin values are rejected safely, never thrown", () => {
    for (const origin of ["", "not a url", "://", "https://", "javascript:alert(1)", "https://re-raise.ru/path", "https://re-raise.ru?x=1"]) {
      expect(() => classifyRequestOrigin(req({ origin })), origin).not.toThrow();
      expect(classifyRequestOrigin(req({ origin })), origin).toBe("cross-origin");
    }
  });

  it("cross-origin: same host but plain http in production is not trusted", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(classifyRequestOrigin(req({ origin: "http://re-raise.ru" }))).toBe("cross-origin");
  });

  it("cross-origin: Sec-Fetch-Site cross-site / same-site, even with a matching-looking Origin", () => {
    expect(classifyRequestOrigin(req({ "sec-fetch-site": "cross-site" }))).toBe("cross-origin");
    expect(classifyRequestOrigin(req({ "sec-fetch-site": "same-site" }))).toBe("cross-origin");
    expect(classifyRequestOrigin(req({ origin: "https://re-raise.ru", "sec-fetch-site": "cross-site" }))).toBe(
      "cross-origin"
    );
  });

  it("same-origin: no Origin but Sec-Fetch-Site: same-origin", () => {
    expect(classifyRequestOrigin(req({ "sec-fetch-site": "same-origin" }))).toBe("same-origin");
  });

  it("unproven: no browser evidence at all", () => {
    expect(classifyRequestOrigin(req())).toBe("unproven");
    expect(classifyRequestOrigin(req({ "sec-fetch-site": "none" }))).toBe("unproven");
  });

  it("is not fooled by user-controlled identity headers", () => {
    expect(
      classifyRequestOrigin(
        req({ "x-player-id": "p", "x-viewer-id": "p", "x-follower-id": "p", origin: "https://evil.example" })
      )
    ).toBe("cross-origin");
  });
});
