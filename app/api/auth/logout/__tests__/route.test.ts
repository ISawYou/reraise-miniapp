import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";
import { POST } from "@/app/api/auth/logout/route";

describe("POST /api/auth/logout", () => {
  it("clears the HttpOnly session cookie", async () => {
    const response = await POST(
      new NextRequest("https://reraise.test/api/auth/logout", {
        method: "POST",
        headers: {
          origin: "https://reraise.test",
          cookie: `${COOKIE_NAME}=signed-session`,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const cookie = response.cookies.get(COOKIE_NAME);
    expect(cookie?.value).toBe("");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(0);
  });

  it("is idempotent when there is no current cookie", async () => {
    const response = await POST(
      new NextRequest("https://reraise.test/api/auth/logout", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  it("rejects a cross-site POST before clearing the cookie", async () => {
    const response = await POST(
      new NextRequest("https://reraise.test/api/auth/logout", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          cookie: `${COOKIE_NAME}=signed-session`,
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.cookies.get(COOKIE_NAME)).toBeUndefined();
  });

  it("rejects a request marked cross-site even when Origin is omitted", async () => {
    const response = await POST(
      new NextRequest("https://reraise.test/api/auth/logout", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
