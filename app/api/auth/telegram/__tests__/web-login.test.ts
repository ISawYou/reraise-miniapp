import { createHash, createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

const mocks = vi.hoisted(() => ({
  ensurePlayerFromTelegramUser: vi.fn(),
  syncTelegramAvatar: vi.fn(),
}));

vi.mock("@/features/auth", () => ({ ensurePlayerFromTelegramUser: mocks.ensurePlayerFromTelegramUser }));
vi.mock("@/lib/avatar-sync", () => ({ syncTelegramAvatar: mocks.syncTelegramAvatar }));

const { GET: startTelegramLogin } = await import("@/app/api/auth/telegram/route");
const { GET: finishTelegramLogin } = await import("@/app/api/auth/telegram/callback/route");

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "123456:test-bot-token";
  process.env.SESSION_SECRET = "telegram-web-login-test-secret";
  mocks.ensurePlayerFromTelegramUser.mockReset().mockResolvedValue({ id: "player-1" });
  mocks.syncTelegramAvatar.mockReset().mockResolvedValue(undefined);
});

describe("Telegram web login", () => {
  it("keeps only an internal returnTo in the OAuth callback URL", async () => {
    const response = await startTelegramLogin(
      new Request("http://localhost/api/auth/telegram?returnTo=/players/player-1?tab=results"),
    );
    const location = response.headers.get("location");

    expect(response.status).toBe(307);
    expect(location).toContain("oauth.telegram.org/auth");
    expect(location).toContain(encodeURIComponent("/api/auth/telegram/callback?returnTo=%2Fplayers%2Fplayer-1%3Ftab%3Dresults"));
    expect(location).not.toContain("https%3A%2F%2F");
  });

  it("verifies Telegram data and redirects to the safe destination", async () => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN!;
    const params = new URLSearchParams({
      id: "42",
      auth_date: String(Math.floor(Date.now() / 1000)),
      first_name: "Player",
      returnTo: "/players/player-1?tab=results",
    });
    const checkString = [...params.entries()]
      .filter(([key]) => key !== "returnTo")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const secretKey = createHash("sha256").update(botToken).digest();
    params.set("hash", createHmac("sha256", secretKey).update(checkString).digest("hex"));

    const response = await finishTelegramLogin(
      new Request(`http://localhost/api/auth/telegram/callback?${params.toString()}`),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/players/player-1?tab=results");
    expect(response.cookies.get(COOKIE_NAME)?.httpOnly).toBe(true);
    expect(mocks.ensurePlayerFromTelegramUser).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
  });
});
