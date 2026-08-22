import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcademyAuthGate } from "@/components/academy/academy-auth-gate";

const mocks = vi.hoisted(() => ({
  getTelegramInitData: vi.fn(),
  isTelegramMiniAppContext: vi.fn(),
  router: { replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/academy/preflop/utg/train",
  useRouter: () => mocks.router,
}));

vi.mock("@/lib/telegram", () => ({
  getTelegramInitData: mocks.getTelegramInitData,
  isTelegramMiniAppContext: mocks.isTelegramMiniAppContext,
}));

let container: HTMLDivElement;
let root: Root;

async function renderGate(
  children: ReactNode = <div data-testid="academy">Academy</div>,
) {
  await act(async () => {
    root.render(<AcademyAuthGate>{children}</AcademyAuthGate>);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.router.replace.mockReset();
  mocks.getTelegramInitData.mockReset().mockResolvedValue("");
  mocks.isTelegramMiniAppContext.mockReset().mockReturnValue(false);
  window.history.replaceState({}, "", "/academy/preflop/utg/train?from=lesson");
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("AcademyAuthGate", () => {
  it("redirects an unauthenticated web visitor to the existing email login before showing Academy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    await renderGate();

    expect(mocks.router.replace).toHaveBeenCalledWith(
      "/login?returnTo=%2Facademy%2Fpreflop%2Futg%2Ftrain%3Ffrom%3Dlesson",
    );
    expect(container.querySelector('[data-testid="academy"]')).toBeNull();
  });

  it("shows Academy when the canonical web session is valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ player: { id: "web-player" } })),
    );

    await renderGate();

    expect(
      container.querySelector('[data-testid="academy"]')?.textContent,
    ).toBe("Academy");
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it("restores a missing Telegram cookie through the existing mini-app session route", async () => {
    mocks.isTelegramMiniAppContext.mockReturnValue(true);
    mocks.getTelegramInitData.mockResolvedValue("signed-init-data");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({ ok: true, player: { id: "telegram-player" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await renderGate();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/telegram/mini-app-session",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ initData: "signed-init-data" }),
      }),
    );
    expect(
      container.querySelector('[data-testid="academy"]')?.textContent,
    ).toBe("Academy");
  });
});
