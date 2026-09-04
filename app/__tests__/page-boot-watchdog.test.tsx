// Home boot watchdog (app/page.tsx) -- a fail-safe timer around ONLY the
// initial `initializing` boot state. Mounts the real HomePage with every
// I/O-touching dependency mocked (Supabase client construction throws at
// import time without env vars; features/auth and features/tournaments
// pull in the repository layer) so only the watchdog's own timer/state
// logic is under test, not network behavior.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
}));

vi.mock("@/features/auth", () => ({
  ensurePlayerFromTelegramUser: vi.fn(),
  acceptTerms: vi.fn(),
  completeProfile: vi.fn(),
}));

vi.mock("@/features/tournaments", () => ({
  getVisibleOpenTournamentsForPlayer: vi.fn().mockResolvedValue([]),
  getPlayerRegistrations: vi.fn().mockResolvedValue([]),
  getTournamentRegistrationCounts: vi.fn().mockResolvedValue({}),
}));

const resolveCurrentPlayerMock = vi.fn();
vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => resolveCurrentPlayerMock(),
  invalidateCurrentPlayerCache: vi.fn(),
}));

vi.mock("@/lib/telegram", () => ({
  getTelegramUser: vi.fn(() => null),
  getTelegramInitData: vi.fn(async () => null),
  getTelegramWebApp: vi.fn(() => null),
  // No Telegram user + isTelegramMiniAppContext() === true keeps the
  // no-session catch branch from redirecting to /login, which would
  // otherwise blow up jsdom's un-implemented window.location.replace.
  isTelegramMiniAppContext: vi.fn(() => true),
}));

const logEventMock = vi.fn();
vi.mock("@/lib/activity-client", () => ({
  logEvent: (...args: unknown[]) => logEventMock(...args),
  setActivityPlayerId: vi.fn(),
}));

const { default: HomePage } = await import("@/app/page");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  resolveCurrentPlayerMock.mockReset();
  logEventMock.mockReset();
  vi.useFakeTimers();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const RECOVERY_TITLE = "Не удалось загрузить приложение";
const RECOVERY_BUTTON = "Повторить загрузку";

describe("Home boot watchdog", () => {
  it("does not show the recovery screen before the ~12s threshold while boot is stuck", async () => {
    resolveCurrentPlayerMock.mockImplementation(() => new Promise(() => {})); // never resolves

    await act(async () => {
      root.render(<HomePage />);
    });

    await act(async () => {
      vi.advanceTimersByTime(11000);
    });

    expect(container.textContent).not.toContain(RECOVERY_TITLE);
    expect(container.textContent).toContain("Загружаем...");
  });

  it("shows the recovery screen once boot is stuck past the threshold", async () => {
    resolveCurrentPlayerMock.mockImplementation(() => new Promise(() => {})); // never resolves

    await act(async () => {
      root.render(<HomePage />);
    });

    await act(async () => {
      vi.advanceTimersByTime(12000);
    });

    expect(container.textContent).toContain(RECOVERY_TITLE);
    const button = Array.from(container.querySelectorAll("button")).find(
      (el) => el.textContent === RECOVERY_BUTTON
    );
    expect(button).toBeDefined();
  });

  it("never shows the recovery screen once initialization finishes before the threshold", async () => {
    resolveCurrentPlayerMock.mockRejectedValue(new Error("no session"));

    await act(async () => {
      root.render(<HomePage />);
    });

    // Let the rejected promise's catch/finally settle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(12000);
    });

    expect(container.textContent).not.toContain(RECOVERY_TITLE);
    // Boot finished (initializing -> false); the app fell through to the
    // logged-out prompt, not the loader and not the watchdog screen.
    expect(container.textContent).toContain("Войдите, чтобы продолжить");
  });
});
