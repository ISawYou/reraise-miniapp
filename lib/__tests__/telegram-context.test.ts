import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// isTelegramMiniAppContext() is the project's signal for "are we inside a
// Telegram Mini App" (home bootstrap, academy auth, the app shell and now
// lib/client-request.ts all branch on it). Its decision must hold for the
// environments Re-Raise runs in: a plain browser must be `false` even when a
// PARTIAL window.Telegram exists (e.g. the Login widget script, or
// telegram-web-app.js loaded outside Telegram); real Mini App launches must be
// `true`, including after SPA navigation dropped the launch params.
//
// The module keeps sticky module-level state, so every test loads a fresh copy.

const INIT_DATA_KEY = "reraise.telegram.initData";

function initData(authDate: number) {
  return `auth_date=${authDate}&user=${encodeURIComponent(JSON.stringify({ id: 7, first_name: "T" }))}&hash=abc`;
}
const nowSeconds = () => Math.floor(Date.now() / 1000);

async function freshModule() {
  vi.resetModules();
  return import("@/lib/telegram");
}

function setLocation(search = "", hash = "") {
  window.history.replaceState(null, "", `/players/x${search}${hash}`);
}

beforeEach(() => {
  window.sessionStorage.clear();
  setLocation();
  // Replace the global test stub (which fakes a WebApp with initData "mock")
  // with "plain browser": no window.Telegram at all.
  delete (window as { Telegram?: unknown }).Telegram;
});

afterEach(() => {
  setLocation();
});

describe("isTelegramMiniAppContext", () => {
  it("plain browser (no window.Telegram): false", async () => {
    const { isTelegramMiniAppContext } = await freshModule();

    expect(isTelegramMiniAppContext()).toBe(false);
  });

  it("only the Telegram Login widget is present (window.Telegram.Login, no WebApp): false", async () => {
    window.Telegram = { Login: { auth: vi.fn() } };
    const { isTelegramMiniAppContext } = await freshModule();

    expect(isTelegramMiniAppContext()).toBe(false);
  });

  it("telegram-web-app.js loaded outside Telegram (WebApp object with empty initData and no user): false", async () => {
    window.Telegram = { WebApp: { initData: "", initDataUnsafe: {} } };
    const { isTelegramMiniAppContext } = await freshModule();

    expect(isTelegramMiniAppContext()).toBe(false);
  });

  it("WebApp.initData present (real Mini App): true", async () => {
    window.Telegram = { WebApp: { initData: initData(nowSeconds()), initDataUnsafe: {} } };
    const { isTelegramMiniAppContext } = await freshModule();

    expect(isTelegramMiniAppContext()).toBe(true);
  });

  it("WebApp.initDataUnsafe.user present: true", async () => {
    window.Telegram = { WebApp: { initData: "", initDataUnsafe: { user: { id: 1 } } } };
    const { isTelegramMiniAppContext } = await freshModule();

    expect(isTelegramMiniAppContext()).toBe(true);
  });

  it("launch params in the URL hash (Telegram Web/Desktop/mobile launch): true, and cached for later pages", async () => {
    setLocation("", `#tgWebAppData=${encodeURIComponent(initData(nowSeconds()))}&tgWebAppVersion=8`);
    const { isTelegramMiniAppContext } = await freshModule();

    expect(isTelegramMiniAppContext()).toBe(true);
    expect(window.sessionStorage.getItem(INIT_DATA_KEY)).toBeTruthy();
  });

  it("launch params in the query string: true", async () => {
    setLocation(`?tgWebAppData=${encodeURIComponent(initData(nowSeconds()))}`);
    const { isTelegramMiniAppContext } = await freshModule();

    expect(isTelegramMiniAppContext()).toBe(true);
  });

  it("after SPA navigation / reload dropped the launch params, still true via the initData cached by an earlier page", async () => {
    window.sessionStorage.setItem(INIT_DATA_KEY, initData(nowSeconds() - 60));
    const { isTelegramMiniAppContext } = await freshModule();

    expect(isTelegramMiniAppContext()).toBe(true);
  });

  it("a cached initData older than 24h is expired: false (and removed)", async () => {
    window.sessionStorage.setItem(INIT_DATA_KEY, initData(nowSeconds() - 25 * 60 * 60));
    const { isTelegramMiniAppContext } = await freshModule();

    expect(isTelegramMiniAppContext()).toBe(false);
    expect(window.sessionStorage.getItem(INIT_DATA_KEY)).toBeNull();
  });

  it("an unparseable cached value does not make a plain browser look like Telegram", async () => {
    window.sessionStorage.setItem(INIT_DATA_KEY, "garbage");
    const { isTelegramMiniAppContext } = await freshModule();

    expect(isTelegramMiniAppContext()).toBe(false);
  });

  it("is sticky for the rest of the session once true (WebApp reset by SDK re-init does not flip it back)", async () => {
    window.Telegram = { WebApp: { initData: initData(nowSeconds()), initDataUnsafe: {} } };
    const { isTelegramMiniAppContext } = await freshModule();
    expect(isTelegramMiniAppContext()).toBe(true);

    delete (window as { Telegram?: unknown }).Telegram;
    window.sessionStorage.clear();

    expect(isTelegramMiniAppContext()).toBe(true);
  });
});
