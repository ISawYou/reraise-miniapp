import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendTeamsTelegramNotification,
  sendTournamentPromotionTelegramNotification,
} from "@/lib/telegram-bot-notify";

// lib/telegram-bot-notify.ts was generalized (one internal sender) without
// changing sendTeamsTelegramNotification's public behavior; the tournament
// promotion wrapper reuses the same sender.
const TOKEN = "123456:SECRET-TEST-TOKEN";
const originalToken = process.env.TELEGRAM_BOT_TOKEN;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = originalToken;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sentBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as { body: string };
  return JSON.parse(init.body);
}

describe("sendTeamsTelegramNotification -- public API unchanged", () => {
  it("posts the same sendMessage body (with the web_app button) and returns true", async () => {
    const ok = await sendTeamsTelegramNotification({
      telegramId: 42,
      text: "Приглашение",
      buttonText: "Открыть",
      path: "/teams?tab=my-team",
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      expect.objectContaining({ method: "POST" })
    );
    const body = sentBody();
    expect(body.chat_id).toBe(42);
    expect(body.text).toBe("Приглашение");
    const keyboard = (body.reply_markup as { inline_keyboard: { text: string; web_app: { url: string } }[][] }).inline_keyboard;
    expect(keyboard[0][0].text).toBe("Открыть");
    expect(keyboard[0][0].web_app.url).toMatch(/\/teams\?tab=my-team$/);
  });

  it("plain text (no button) when buttonText is omitted", async () => {
    await sendTeamsTelegramNotification({ telegramId: 1, text: "x" });
    expect(sentBody()).not.toHaveProperty("reply_markup");
  });

  it("keeps its '[teams]' log prefix and never throws when not configured", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(sendTeamsTelegramNotification({ telegramId: 1, text: "x" })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("[teams]");
  });
});

describe("sendTournamentPromotionTelegramNotification", () => {
  it("adds the 'Открыть турнир' Mini App button pointing at /tournaments/{id}", async () => {
    const ok = await sendTournamentPromotionTelegramNotification({
      telegramId: 77,
      text: "✅ Вы в основной регистрации",
      tournamentId: "abc-123",
    });

    expect(ok).toBe(true);
    const body = sentBody();
    expect(body.chat_id).toBe(77);
    const button = (body.reply_markup as { inline_keyboard: { text: string; web_app: { url: string } }[][] }).inline_keyboard[0][0];
    expect(button.text).toBe("Открыть турнир");
    expect(button.web_app.url).toMatch(/\/tournaments\/abc-123$/);
  });

  it("a Telegram API failure returns false, never throws, and logs only a category (no token, no text, no chat id)", async () => {
    fetchMock.mockResolvedValue(new Response("Forbidden: bot was blocked by the user; text=secret body", { status: 403 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      sendTournamentPromotionTelegramNotification({ telegramId: 987654, text: "PRIVATE TEXT", tournamentId: "t" })
    ).resolves.toBe(false);

    const logged = warn.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("bot blocked by user");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("PRIVATE TEXT");
    expect(logged).not.toContain("987654");
    expect(logged).not.toContain("secret body");
  });

  it("a network error returns false and never throws", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      sendTournamentPromotionTelegramNotification({ telegramId: 1, text: "x", tournamentId: "t" })
    ).resolves.toBe(false);
  });
});
