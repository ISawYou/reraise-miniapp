import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcademyAuthGate } from "@/components/academy/academy-auth-gate";
import { useAcademyAccess } from "@/components/academy/academy-access-context";

const mocks = vi.hoisted(() => ({
  getTelegramInitData: vi.fn(),
  isTelegramMiniAppContext: vi.fn(),
  router: { replace: vi.fn(), refresh: vi.fn() },
  pathname: { current: "/academy/preflop/utg/train" },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname.current,
  useRouter: () => mocks.router,
}));

vi.mock("@/lib/telegram", () => ({
  getTelegramInitData: mocks.getTelegramInitData,
  isTelegramMiniAppContext: mocks.isTelegramMiniAppContext,
}));

let container: HTMLDivElement;
let root: Root;

type Routes = Record<string, () => Response>;

/** fetch stub answering by URL (each call gets a fresh Response). */
function stubFetch(routes: Routes) {
  const fetchMock = vi.fn(async (url: string) => {
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    return handler();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const FULL = { access: "FULL", season: { id: "s-1", title: "Осень 2026" } };
const BEGINNER = { access: "BEGINNER_ONLY", season: { id: "s-1", title: "Осень 2026" } };

function AccessProbe() {
  const access = useAcademyAccess();
  return <div data-testid="academy">Academy<span data-testid="tier">{access?.access ?? "none"}</span></div>;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderGate(
  children: ReactNode = <div data-testid="academy">Academy</div>,
) {
  await act(async () => {
    root.render(<AcademyAuthGate>{children}</AcademyAuthGate>);
  });
  await flush();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.router.replace.mockReset();
  mocks.router.refresh.mockReset();
  mocks.pathname.current = "/academy/preflop/utg/train";
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
    const fetchMock = stubFetch({
      "/api/auth/me": () => new Response(null, { status: 401 }),
    });

    await renderGate();

    expect(mocks.router.replace).toHaveBeenCalledWith(
      "/login?returnTo=%2Facademy%2Fpreflop%2Futg%2Ftrain%3Ffrom%3Dlesson",
    );
    expect(container.querySelector('[data-testid="academy"]')).toBeNull();
    // Access is never resolved for an unauthenticated visitor.
    expect(fetchMock).not.toHaveBeenCalledWith("/api/academy/access", expect.anything());
  });

  it("shows Academy when the canonical web session is valid", async () => {
    stubFetch({
      "/api/auth/me": () => Response.json({ player: { id: "web-player" } }),
      "/api/academy/access": () => Response.json(FULL),
    });

    await renderGate();

    expect(
      container.querySelector('[data-testid="academy"]')?.textContent,
    ).toBe("Academy");
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it("restores a missing Telegram cookie through the existing mini-app session route", async () => {
    mocks.isTelegramMiniAppContext.mockReturnValue(true);
    mocks.getTelegramInitData.mockResolvedValue("signed-init-data");
    const fetchMock = stubFetch({
      "/api/auth/me": () => new Response(null, { status: 401 }),
      "/api/auth/telegram/mini-app-session": () => Response.json({ ok: true, player: { id: "telegram-player" } }),
      "/api/academy/access": () => Response.json(FULL),
    });

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
    // The server-rendered page predates the cookie: it is re-rendered for the restored player.
    expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("AcademyAuthGate · access step", () => {
  it("resolves access AFTER authentication, without caching, and provides the server tier", async () => {
    const fetchMock = stubFetch({
      "/api/auth/me": () => Response.json({ player: { id: "web-player" } }),
      "/api/academy/access": () => Response.json(BEGINNER),
    });

    await renderGate(<AccessProbe />);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/auth/me", "/api/academy/access"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/academy/access", expect.objectContaining({ credentials: "include", cache: "no-store" }));
    expect(container.querySelector('[data-testid="tier"]')?.textContent).toBe("BEGINNER_ONLY");
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });

  it("shows 'Проверяем доступ...' (never the Academy content) until the tier is known", async () => {
    let releaseAccess: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/auth/me") return Response.json({ player: { id: "web-player" } });
      return new Promise<Response>((resolve) => { releaseAccess = resolve; });
    }));

    await renderGate(<AccessProbe />);

    expect(container.querySelector('[data-testid="academy"]')).toBeNull();
    expect(container.textContent).toContain("Проверяем доступ...");

    await act(async () => releaseAccess(Response.json(FULL)));
    await flush();
    expect(container.querySelector('[data-testid="tier"]')?.textContent).toBe("FULL");
  });

  it("re-checks access on every Academy navigation, so a newly arrived player unlocks without logging out", async () => {
    let tier = BEGINNER;
    const fetchMock = stubFetch({
      "/api/auth/me": () => Response.json({ player: { id: "web-player" } }),
      "/api/academy/access": () => Response.json(tier),
    });

    await renderGate(<AccessProbe />);
    expect(container.querySelector('[data-testid="tier"]')?.textContent).toBe("BEGINNER_ONLY");

    // Admin marks "Пришёл"; the player navigates inside Academy.
    tier = FULL;
    mocks.pathname.current = "/academy";
    await renderGate(<AccessProbe />);

    expect(container.querySelector('[data-testid="tier"]')?.textContent).toBe("FULL");
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/academy/access")).toHaveLength(2);
  });

  it("fails visibly (with retry) instead of showing Academy when the tier cannot be resolved", async () => {
    stubFetch({
      "/api/auth/me": () => Response.json({ player: { id: "web-player" } }),
      "/api/academy/access": () => Response.json({ error: "boom" }, { status: 500 }),
    });

    await renderGate(<AccessProbe />);

    expect(container.querySelector('[data-testid="academy"]')).toBeNull();
    expect(container.textContent).toContain("Не удалось проверить доступ к Академии");
    expect(container.querySelector("button")?.textContent).toBe("Повторить");
  });

  it("rejects an unknown tier value from the endpoint (never treated as FULL)", async () => {
    stubFetch({
      "/api/auth/me": () => Response.json({ player: { id: "web-player" } }),
      "/api/academy/access": () => Response.json({ access: "ADMIN", season: null }),
    });

    await renderGate(<AccessProbe />);

    expect(container.querySelector('[data-testid="academy"]')).toBeNull();
    expect(container.textContent).toContain("Не удалось проверить доступ к Академии");
  });
});
