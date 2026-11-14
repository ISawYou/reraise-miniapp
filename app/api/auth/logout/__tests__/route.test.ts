import { describe, expect, it } from "vitest";
import { COOKIE_NAME } from "@/lib/telegram-web-session";
import { POST } from "@/app/api/auth/logout/route";

describe("POST /api/auth/logout", () => {
  it("clears the HttpOnly session cookie", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const cookie = response.cookies.get(COOKIE_NAME);
    expect(cookie?.value).toBe("");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(0);
  });

  it("is idempotent when there is no current cookie", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });
});
