import { beforeEach, describe, expect, it, vi } from "vitest";

const telegram = vi.hoisted(() => ({ miniApp: false, initData: "signed-init-data" }));
vi.mock("@/lib/telegram", () => ({
  isTelegramMiniAppContext: () => telegram.miniApp,
  getTelegramInitData: async () => telegram.initData,
}));

const { uploadPlayerAvatar } = await import("@/lib/player-avatar-client");

beforeEach(() => {
  telegram.miniApp = false;
  vi.restoreAllMocks();
});

describe("uploadPlayerAvatar", () => {
  it("builds a cookie-authenticated multipart web request without actor fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ player: { id: "player-1" } }), { status: 200 })
    );
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff]).buffer], "avatar.jpg", { type: "image/jpeg" });

    await uploadPlayerAvatar("player-1", file);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/players/player-1/avatar");
    expect(init?.credentials).toBe("include");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("file")).toBe(file);
    expect([...((init?.body as FormData).keys())]).toEqual(["file"]);
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
    expect(new Headers(init?.headers).has("x-telegram-init-data")).toBe(false);
  });

  it("preserves verified Telegram header construction and never retries the POST", async () => {
    telegram.miniApp = true;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network"));

    await expect(uploadPlayerAvatar("player-1", new File(["x"], "a.jpg"))).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("x-telegram-init-data")).toBe("signed-init-data");
  });
});
