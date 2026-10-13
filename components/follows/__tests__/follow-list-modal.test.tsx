// Followers / following list sheet (Batch D). Renders the REAL modal and the
// REAL lib/follows-client.ts; only the HTTP transport underneath
// (@/lib/client-request's fetchJsonWithRetry) is mocked, so URL construction
// and response validation are exercised for real.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchJsonWithRetry: vi.fn(),
}));

vi.mock("@/lib/client-request", () => ({
  fetchAdminJson: vi.fn(),
  fetchJsonWithRetry: mocks.fetchJsonWithRetry,
  getAdminHeaders: vi.fn(async () => ({})),
}));

// A plain anchor: the modal's own behavior (href, onClose on click) is what is
// under test, not Next's router, which has no provider here.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { FollowListModal } = await import("@/components/follows/follow-list-modal");

type Item = {
  id: string;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
};

const PLAYER = "22222222-2222-4222-8222-222222222222";
const OTHER_PLAYER = "33333333-3333-4333-8333-333333333333";

const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function item(n: number, overrides: Partial<Item> = {}): Item {
  return { id: pid(n), display_name: `Player ${n}`, telegram_avatar_url: null, custom_avatar_url: null, ...overrides };
}
function items(from: number, count: number): Item[] {
  return Array.from({ length: count }, (_, i) => item(from + i));
}

let container: HTMLDivElement;
let root: Root;
let onClose: Mock<() => void>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onClose = vi.fn();
  mocks.fetchJsonWithRetry.mockReset();
  // The scroll lock restores the scroll offset on unmount; jsdom has no scrollTo.
  vi.stubGlobal("scrollTo", vi.fn());
  // Row links must not make jsdom try to navigate.
  container.addEventListener(
    "click",
    (event) => {
      if ((event.target as HTMLElement).closest("a")) event.preventDefault();
    },
    true
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

type Props = { playerId?: string; mode?: "followers" | "following"; title?: string };

async function renderModal(props: Props = {}) {
  await act(async () =>
    root.render(
      <FollowListModal
        playerId={props.playerId ?? PLAYER}
        mode={props.mode ?? "followers"}
        title={props.title ?? "Подписчики"}
        onClose={onClose}
      />
    )
  );
  await settle();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const rows = () => Array.from(container.querySelectorAll("li"));
const sheet = () => container.querySelector('[role="dialog"]') as HTMLElement;
const backdrop = () => container.firstElementChild as HTMLElement;
const loadMoreButton = () =>
  Array.from(container.querySelectorAll("button")).find((b) =>
    ["Показать ещё"].includes((b.textContent ?? "").trim())
  ) as HTMLButtonElement | undefined;
const urls = () => mocks.fetchJsonWithRetry.mock.calls.map(([url]) => url as string);

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("states", () => {
  it("A. shows «Загрузка...» while the first page loads", async () => {
    mocks.fetchJsonWithRetry.mockReturnValue(new Promise(() => {}));
    await renderModal();

    expect(container.textContent).toContain("Загрузка...");
    expect(rows()).toHaveLength(0);
  });

  it("B. shows exactly «Пока никого нет» for an empty list, and no «Показать ещё»", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({ items: [], total: 0 });
    await renderModal();

    expect(container.textContent).toContain("Пока никого нет");
    expect(container.textContent).not.toContain("Загрузка...");
    expect(loadMoreButton()).toBeUndefined();
  });

  it("C. renders avatar and name for one or many rows (custom avatar wins over Telegram's)", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({
      items: [
        item(1, { display_name: "Alex", telegram_avatar_url: "https://example.com/tg.png" }),
        item(2, { display_name: "Boris", telegram_avatar_url: "https://example.com/tg2.png", custom_avatar_url: "https://example.com/custom.png" }),
        item(3, { display_name: "Clara" }),
      ],
      total: 3,
    });
    await renderModal();

    expect(rows()).toHaveLength(3);
    expect(rows().map((r) => r.textContent?.trim())).toEqual(["Alex", "Boris", "C" + "Clara"]);
    const images = Array.from(container.querySelectorAll("img"));
    expect(images.map((img) => img.getAttribute("src"))).toEqual([
      "https://example.com/tg.png",
      "https://example.com/custom.png",
    ]);
  });

  it("D. a player without any avatar gets the first-letter fallback", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({ items: [item(1, { display_name: "алексей" })], total: 1 });
    await renderModal();

    expect(container.querySelector("img")).toBeNull();
    expect(rows()[0].textContent).toBe("Аалексей");
  });

  it("E. an API error is shown locally, the dialog stays open", async () => {
    mocks.fetchJsonWithRetry.mockRejectedValue(new Error("Не удалось загрузить список. Попробуйте ещё раз."));
    await renderModal();

    const error = container.querySelector("p.text-red-300");
    expect(error?.textContent).toBe("Не удалось загрузить список. Попробуйте ещё раз.");
    expect(sheet()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Загрузка...");
  });

  it("an error without a message falls back to a safe text (no raw object)", async () => {
    mocks.fetchJsonWithRetry.mockRejectedValue({ stack: "secret stack" });
    await renderModal();

    expect(container.textContent).toContain("Не удалось загрузить список. Попробуйте ещё раз.");
    expect(container.textContent).not.toContain("secret stack");
  });

  it("a malformed response is an error, not an empty list", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({ nothing: true });
    await renderModal();

    expect(container.querySelector("p.text-red-300")).not.toBeNull();
    expect(container.textContent).not.toContain("Пока никого нет");
  });

  it("renders only name and avatar: no username/email/id text, no follow button", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({
      items: [{ ...item(1, { display_name: "Alex" }), username: "secret_handle", email: "secret@example.com" }],
      total: 1,
    });
    await renderModal();

    expect(container.textContent).not.toContain("secret");
    expect(container.textContent).not.toContain(pid(1));
    expect(Array.from(container.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["×"]);
  });

  it("requests the right endpoint per mode, first page 50 / offset 0", async () => {
    mocks.fetchJsonWithRetry.mockResolvedValue({ items: [], total: 0 });

    await renderModal({ mode: "followers" });
    expect(urls()).toEqual([`/api/players/${PLAYER}/followers?limit=50&offset=0`]);

    await act(async () => root.unmount());
    root = createRoot(container);
    mocks.fetchJsonWithRetry.mockClear();

    await renderModal({ mode: "following", title: "Подписки" });
    expect(urls()).toEqual([`/api/players/${PLAYER}/following?limit=50&offset=0`]);
  });
});

describe("navigation and closing", () => {
  beforeEach(() => {
    mocks.fetchJsonWithRetry.mockResolvedValue({ items: [item(1), item(2)], total: 2 });
  });

  it("F. each row links to /players/{id}", async () => {
    await renderModal();

    const hrefs = Array.from(container.querySelectorAll("li a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([`/players/${pid(1)}`, `/players/${pid(2)}`]);
  });

  it("G. clicking a row closes the modal", async () => {
    await renderModal();

    await click(container.querySelector("li a")!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("H. a backdrop click closes", async () => {
    await renderModal();

    await click(backdrop());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("I. a click inside the sheet does NOT close", async () => {
    await renderModal();

    await click(sheet());
    await click(container.querySelector("h2")!);
    await click(container.querySelector("ul")!);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("J. Escape closes; other keys do not", async () => {
    await renderModal();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the × button closes", async () => {
    await renderModal();

    await click(container.querySelector('button[aria-label="Закрыть"]')!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("K. is a labelled modal dialog: role, aria-modal, aria-labelledby -> the title", async () => {
    await renderModal({ title: "Подписки", mode: "following" });

    const dialog = sheet();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe("Подписки");
  });

  it("locks background scroll while open and restores it on close", async () => {
    await renderModal();
    expect(document.body.style.position).toBe("fixed");

    await act(async () => root.unmount());
    expect(document.body.style.position).toBe("");
    root = createRoot(container);
  });
});

describe("pagination", () => {
  // A server stand-in holding 120 players, newest first.
  function serve(total: number, overrides: (offset: number) => Item[] | null = () => null) {
    mocks.fetchJsonWithRetry.mockImplementation(async (url: string) => {
      const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
      const limit = Number(new URL(url, "http://x").searchParams.get("limit"));
      const custom = overrides(offset);
      const page = custom ?? items(offset + 1, Math.max(0, Math.min(limit, total - offset)));
      return { items: page, total };
    });
  }

  it("1-5. 120 players: 50 -> «Показать ещё» -> offset 50 -> 100 (button stays) -> offset 100 -> 120 (button gone)", async () => {
    serve(120);
    await renderModal();

    expect(rows()).toHaveLength(50);
    expect(loadMoreButton()).toBeDefined();

    await click(loadMoreButton()!);
    await settle();
    expect(urls()[1]).toBe(`/api/players/${PLAYER}/followers?limit=50&offset=50`);
    expect(rows()).toHaveLength(100);
    expect(loadMoreButton()).toBeDefined();

    await click(loadMoreButton()!);
    await settle();
    expect(urls()[2]).toBe(`/api/players/${PLAYER}/followers?limit=50&offset=100`);
    expect(rows()).toHaveLength(120);
    expect(loadMoreButton()).toBeUndefined();

    // The server's newest-first order is kept, page 1 is not replaced.
    expect(rows()[0].textContent).toContain("Player 1");
    expect(rows()[119].textContent).toContain("Player 120");
  });

  it("exactly one page worth (50 of 50) never shows «Показать ещё»", async () => {
    serve(50);
    await renderModal();

    expect(rows()).toHaveLength(50);
    expect(loadMoreButton()).toBeUndefined();
  });

  it("6. a double click while loading more sends only one request; the button is disabled with a loading label", async () => {
    serve(120);
    await renderModal();

    const second = deferred<{ items: Item[]; total: number }>();
    mocks.fetchJsonWithRetry.mockImplementation(() => second.promise);

    const button = loadMoreButton()!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await click(container.querySelector("button.w-full")!);

    expect(mocks.fetchJsonWithRetry).toHaveBeenCalledTimes(2); // page 1 + exactly one load-more
    const busy = container.querySelector("button.w-full") as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toBe("Загрузка...");

    await act(async () => second.resolve({ items: items(51, 50), total: 120 }));
    await settle();
    expect(rows()).toHaveLength(100);
    expect(mocks.fetchJsonWithRetry).toHaveBeenCalledTimes(2);
  });

  it("7. a failed load-more keeps the first page and shows a local error", async () => {
    serve(120);
    await renderModal();
    mocks.fetchJsonWithRetry.mockRejectedValue(new Error("Не удалось загрузить список. Попробуйте ещё раз."));

    await click(loadMoreButton()!);
    await settle();

    expect(rows()).toHaveLength(50);
    expect(container.querySelector("p.text-red-300")?.textContent).toBe("Не удалось загрузить список. Попробуйте ещё раз.");
    expect(sheet()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(loadMoreButton()).toBeDefined();
    expect((loadMoreButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("8. retrying after a failed load-more succeeds and clears the error", async () => {
    serve(120);
    await renderModal();
    mocks.fetchJsonWithRetry.mockRejectedValueOnce(new Error("Сеть нестабильна. Попробуйте еще раз."));

    await click(loadMoreButton()!);
    await settle();
    expect(container.textContent).toContain("Сеть нестабильна");

    serve(120);
    await click(loadMoreButton()!);
    await settle();

    expect(rows()).toHaveLength(100);
    expect(container.querySelector("p.text-red-300")).toBeNull();
    // The retry asked for the SAME offset again, not a skipped one.
    expect(urls().filter((u) => u.endsWith("offset=50"))).toHaveLength(2);
  });

  it("9. a player id repeated across pages is rendered once, order untouched, and the next offset counts rows received", async () => {
    // The page-2 response repeats Player 50 (a new follower shifted the window).
    serve(120, (offset) => (offset === 50 ? [item(50), ...items(51, 49)] : null));
    await renderModal();

    await click(loadMoreButton()!);
    await settle();

    const names = rows().map((r) => r.textContent);
    expect(names.filter((n) => n?.includes("Player 50"))).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
    expect(rows()).toHaveLength(99);

    await click(loadMoreButton()!);
    await settle();
    // 50 + 50 rows were RECEIVED, so the third request starts at 100 (not at 99).
    expect(urls()[2]).toBe(`/api/players/${PLAYER}/followers?limit=50&offset=100`);
  });

  it("an empty page while total claims more ends pagination instead of leaving a dead button", async () => {
    serve(120, (offset) => (offset === 50 ? [] : null));
    await renderModal();

    await click(loadMoreButton()!);
    await settle();

    expect(rows()).toHaveLength(50);
    expect(loadMoreButton()).toBeUndefined();
  });

  it("following mode paginates against /following", async () => {
    serve(70);
    await renderModal({ mode: "following", title: "Подписки" });

    await click(loadMoreButton()!);
    await settle();

    expect(urls()).toEqual([
      `/api/players/${PLAYER}/following?limit=50&offset=0`,
      `/api/players/${PLAYER}/following?limit=50&offset=50`,
    ]);
    expect(rows()).toHaveLength(70);
  });
});

describe("stale requests", () => {
  it("a response that arrives after the modal was closed (unmounted) is dropped without errors", async () => {
    const pending = deferred<{ items: Item[]; total: number }>();
    mocks.fetchJsonWithRetry.mockReturnValue(pending.promise);
    await renderModal();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => root.unmount());
    await act(async () => pending.resolve({ items: items(1, 3), total: 3 }));
    await settle();

    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it("a first page that lands after switching to another player never overwrites the new list", async () => {
    const slow = deferred<{ items: Item[]; total: number }>();
    mocks.fetchJsonWithRetry.mockImplementation((url: string) =>
      url.includes(PLAYER) ? slow.promise : Promise.resolve({ items: [item(7, { display_name: "New player's follower" })], total: 1 })
    );
    await renderModal({ playerId: PLAYER });
    await renderModal({ playerId: OTHER_PLAYER });
    expect(container.textContent).toContain("New player's follower");

    await act(async () => slow.resolve({ items: [item(9, { display_name: "OLD player's follower" })], total: 1 }));
    await settle();

    expect(container.textContent).toContain("New player's follower");
    expect(container.textContent).not.toContain("OLD player's follower");
  });

  it("a load-more response that lands after switching mode is not appended to the other list", async () => {
    mocks.fetchJsonWithRetry.mockImplementation(async (url: string) => {
      const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
      return { items: items(offset + 1, 50), total: 120 };
    });
    await renderModal({ mode: "followers" });

    const slowMore = deferred<{ items: Item[]; total: number }>();
    mocks.fetchJsonWithRetry.mockImplementation((url: string) =>
      url.includes("offset=50") ? slowMore.promise : Promise.resolve({ items: [item(900, { display_name: "Following row" })], total: 1 })
    );
    await click(loadMoreButton()!);

    await renderModal({ mode: "following", title: "Подписки" });
    expect(rows().map((r) => r.textContent)).toEqual(["Following row"].map((t) => "F" + t));

    await act(async () => slowMore.resolve({ items: items(51, 50), total: 120 }));
    await settle();

    expect(rows()).toHaveLength(1);
  });
});
