import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/telegram", () => ({
  getTelegramUser: () => null,
  isTelegramMiniAppContext: () => false,
}));
vi.mock("@/features/auth", () => ({ ensurePlayerFromTelegramUser: vi.fn() }));

const {
  AUTH_STATE_CHANGED_EVENT,
  invalidateCurrentPlayerCache,
  resolveCurrentPlayer,
  subscribeToAuthState,
} = await import("@/lib/current-player");

describe("current player cache", () => {
  beforeEach(() => {
    invalidateCurrentPlayerCache();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not retain a rejected bootstrap promise", async () => {
    const request = vi.mocked(fetch);
    request
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ player: { id: "p2" } }), { status: 200 }));

    await expect(resolveCurrentPlayer()).rejects.toThrow("network down");
    await expect(resolveCurrentPlayer()).resolves.toEqual({ id: "p2" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("publishes auth changes so mounted consumers can reload identity", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAuthState(listener);

    invalidateCurrentPlayerCache();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.dispatchEvent(new Event(AUTH_STATE_CHANGED_EVENT));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
