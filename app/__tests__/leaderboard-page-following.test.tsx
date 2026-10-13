// Batch E: the "Подписки" view inside «Текущий сезон» -- a client-side filter
// of the official standings to "me + the players I follow", with OFFICIAL
// ranks. Same render convention as leaderboard-page-statistics.test.tsx (raw
// react-dom/client). Renders the REAL page, the REAL lib/follows-client.ts and
// the REAL lib/client-request.ts; only window.fetch (the network) and the
// current-player lookup are stubbed, so the request URLs asserted here are
// exactly what the browser would send.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Movement = { type: "up" | "down"; places: number } | { type: "new" } | { type: "same" };
type Row = {
  player_id: string;
  username: string | null;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  rating: number;
  rankMovement?: Movement;
};

const mocks = vi.hoisted(() => ({
  resolveViewer: (async () => ({ id: "p5" })) as () => Promise<{ id: string }>,
}));

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => mocks.resolveViewer(),
}));
vi.mock("@/lib/activity-client", () => ({ logEvent: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const { default: LeaderboardPage } = await import("@/app/leaderboard/page");

function row(id: string, name: string, rating: number, rankMovement?: Movement): Row {
  return { player_id: id, username: null, display_name: name, telegram_avatar_url: null, custom_avatar_url: null, rating, rankMovement };
}

// Official season standings: the number in front of a name is its index + 1.
//  #1 Alice  #2 Bob(up3)  #3 Carol(new)  #4 Dave  #5 Viewer(same)  #6..#10 filler
//  #11 Kate(down1)  #12 Liam  #13 Mia
function seasonRows(): Row[] {
  return [
    row("p1", "Alice", 900),
    row("p2", "Bob", 800, { type: "up", places: 3 }),
    row("p3", "Carol", 700, { type: "new" }),
    row("p4", "Dave", 600),
    row("p5", "Viewer", 500, { type: "same" }),
    row("p6", "Filler6", 450),
    row("p7", "Filler7", 440),
    row("p8", "Filler8", 430),
    row("p9", "Filler9", 420),
    row("p10", "Filler10", 410),
    row("p11", "Kate", 300, { type: "down", places: 1 }),
    row("p12", "Liam", 200),
    row("p13", "Mia", 100),
  ];
}
const OOC_ROWS = [row("oo1", "Oscar OOC", 450), row("oo2", "Olga OOC", 300)];

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let season: { leaderboard: Row[]; outOfCompetition: Row[] };
let followingIdsResponse: (playerId: string) => Promise<Response>;

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  mocks.resolveViewer = async () => ({ id: "p5" });
  season = { leaderboard: seasonRows(), outOfCompetition: OOC_ROWS };
  followingIdsResponse = async () => ok({ ids: ["p2", "p11"] });

  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/leaderboard") {
      return ok({ season: { id: "s1", title: "Сезон 1" }, leaderboard: season.leaderboard, outOfCompetition: season.outOfCompetition });
    }
    if (url === "/api/leaderboard/all-time") {
      return ok({ leaderboard: [row("p1", "Alice", 1900)] });
    }
    if (typeof url === "string" && url.startsWith("/api/leaderboard/statistics")) {
      return ok({ topPlayers: [{ playerId: "p1", displayName: "Alice", username: null, telegramAvatarUrl: null, customAvatarUrl: null, value: 42, rank: 1 }] });
    }
    const match = typeof url === "string" ? url.match(/^\/api\/players\/([^/]+)\/following\/ids$/) : null;
    if (match) return followingIdsResponse(decodeURIComponent(match[1]));
    return { ok: false, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 25; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// fetchJsonWithRetry re-sends a failed read once after 400 ms (existing default
// policy for GETs); a test that expects the FINAL failure has to let that pass.
async function waitForRetry() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
  await settle();
}

async function renderPage() {
  await act(async () => root.render(<LeaderboardPage />));
  await settle();
}

const buttonByText = (text: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === text) as HTMLButtonElement | undefined;

async function click(text: string) {
  const button = buttonByText(text);
  if (!button) throw new Error(`Button "${text}" not found`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

// The flat/ranked rows (RankRow links carry `border-b`; podium cards do not).
function rankedRows() {
  return Array.from(container.querySelectorAll("a.border-b")).map((a) => ({
    rank: a.children[0].textContent,
    name: a.querySelector("p.truncate")?.textContent ?? "",
    text: a.textContent ?? "",
    isYou: (a.textContent ?? "").includes("Это вы"),
  }));
}
const names = () => rankedRows().map((r) => r.name);
const hasPodium = () => container.querySelector(".grid-cols-3.items-end") !== null;
const hasTopNine = () => (container.textContent ?? "").includes("ТОП-9 → Финал месяца");
const idsCalls = () => fetchMock.mock.calls.filter(([url]) => /\/following\/ids$/.test(String(url)));
const text = () => container.textContent ?? "";

describe("placement and defaults", () => {
  it("A. the top-level tabs are still exactly Текущий сезон / Всё время / Статистика (no fourth «Подписки» tab)", async () => {
    await renderPage();

    const tabs = Array.from(container.querySelectorAll(".grid-cols-3 > button")).map((b) => b.textContent);
    expect(tabs).toEqual(["Текущий сезон", "Всё время", "Статистика"]);
  });

  it("B. inside «Текущий сезон» there is a secondary Все / Подписки selector", async () => {
    await renderPage();

    const group = container.querySelector('[role="group"]');
    expect(Array.from(group!.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Все", "Подписки"]);
  });

  it("C. default is «Все»: the normal season view with podium and ТОП-9, and no following request yet", async () => {
    await renderPage();

    expect(buttonByText("Все")?.getAttribute("aria-pressed")).toBe("true");
    expect(buttonByText("Подписки")?.getAttribute("aria-pressed")).toBe("false");
    expect(hasPodium()).toBe(true);
    expect(hasTopNine()).toBe(true);
    expect(text()).toContain("Ваша позиция");
    expect(idsCalls()).toHaveLength(0);
  });

  it("the selector is not shown in the other top-level modes", async () => {
    await renderPage();

    await click("Всё время");
    expect(container.querySelector('[role="group"]')).toBeNull();
    await click("Статистика");
    expect(container.querySelector('[role="group"]')).toBeNull();
  });
});

describe("loading following ids", () => {
  it("D. selecting «Подписки» loads the viewer's ids lazily from the public unbounded endpoint (plain GET, no auth headers)", async () => {
    await renderPage();
    expect(idsCalls()).toHaveLength(0);

    await click("Подписки");

    expect(idsCalls()).toHaveLength(1);
    const [url, init] = idsCalls()[0];
    expect(url).toBe("/api/players/p5/following/ids");
    expect(init).toEqual({ cache: "no-store" });
    // Never the paginated list.
    expect(fetchMock.mock.calls.some(([u]) => /\/following\?/.test(String(u)))).toBe(false);
  });

  it("E. Все -> Подписки -> Все -> Подписки requests the ids exactly once", async () => {
    await renderPage();

    await click("Подписки");
    await click("Все");
    await click("Подписки");
    await click("Все");
    await click("Подписки");

    expect(idsCalls()).toHaveLength(1);
    expect(names()).toEqual(["Bob", "Viewer", "Kate"]);
  });

  it("the ids stay cached across top-level mode changes too", async () => {
    await renderPage();
    await click("Подписки");
    await click("Всё время");
    await click("Текущий сезон");

    // The chosen view lives in page state like the statistics metric does.
    expect(buttonByText("Подписки")?.getAttribute("aria-pressed")).toBe("true");
    expect(names()).toEqual(["Bob", "Viewer", "Kate"]);
    expect(idsCalls()).toHaveLength(1);
  });

  it("a viewer who is not resolved yet is never treated as anonymous: loading, no request, then the real list", async () => {
    let resolve!: (value: { id: string }) => void;
    mocks.resolveViewer = () => new Promise((res) => (resolve = res));
    await renderPage();

    await click("Подписки");
    expect(text()).toContain("Загружаем...");
    expect(text()).not.toContain("Вы пока ни на кого не подписаны");
    expect(idsCalls()).toHaveLength(0);

    await act(async () => resolve({ id: "p5" }));
    await settle();

    expect(idsCalls()).toHaveLength(1);
    expect(names()).toEqual(["Bob", "Viewer", "Kate"]);
  });
});

describe("the Подписки view", () => {
  it("F-I. a flat list of me + followed players, with OFFICIAL ranks (#2, #5, #11 -- not #1, #2, #3), unfollowed players excluded", async () => {
    await renderPage();
    await click("Подписки");

    expect(rankedRows().map((r) => [r.rank, r.name])).toEqual([
      ["2", "Bob"],
      ["5", "Viewer"],
      ["11", "Kate"],
    ]);
    // Carol (#3) is not followed; the other ranked players aren't either.
    expect(text()).not.toContain("Carol");
    expect(text()).not.toContain("Alice");
    // The rank in this view equals the rank in «Все».
    await click("Все");
    const everyone = rankedRows().map((r) => [r.rank, r.name]);
    expect(everyone).toContainEqual(["11", "Kate"]);
    expect(everyone).toContainEqual(["5", "Viewer"]);
  });

  it("the viewer's own row is marked «Это вы»", async () => {
    await renderPage();
    await click("Подписки");

    expect(rankedRows().find((r) => r.name === "Viewer")?.isYou).toBe(true);
    expect(rankedRows().find((r) => r.name === "Bob")?.isYou).toBe(false);
  });

  it("G/H. no podium and no «ТОП-9 → Финал месяца» chip", async () => {
    await renderPage();
    await click("Подписки");

    expect(hasPodium()).toBe(false);
    expect(hasTopNine()).toBe(false);
  });

  it("shows the context copy «Игроки, на которых вы подписаны» (and only in this view)", async () => {
    await renderPage();
    expect(text()).not.toContain("Игроки, на которых вы подписаны");

    await click("Подписки");
    expect(text()).toContain("Игроки, на которых вы подписаны");
  });

  it("J. rank movement stays on the right player (and absent where the server sent none)", async () => {
    await renderPage();
    await click("Подписки");

    const byName = Object.fromEntries(rankedRows().map((r) => [r.name, r.text]));
    expect(byName["Bob"]).toContain("↑3");
    expect(byName["Kate"]).toContain("↓1");
    expect(byName["Viewer"]).toContain("—");
    expect(byName["Bob"]).not.toContain("↓");
    expect(text()).not.toContain("NEW"); // Carol's movement is not shown: Carol is not in this view
  });

  it("K. followed out-of-competition players render in «Вне зачёта», dimmed and WITHOUT a rank; unfollowed OOC players do not", async () => {
    followingIdsResponse = async () => ok({ ids: ["p2", "oo1"] });
    await renderPage();
    await click("Подписки");

    expect(text()).toContain("Вне зачёта");
    expect(text()).toContain("Oscar OOC");
    expect(text()).not.toContain("Olga OOC");
    const oscar = rankedRows().find((r) => r.name === "Oscar OOC");
    expect(oscar?.rank).toBe("—");
    // Ranked rows keep their real numbers: Bob #2, Viewer #5.
    expect(rankedRows().filter((r) => r.rank !== "—").map((r) => [r.rank, r.name])).toEqual([
      ["2", "Bob"],
      ["5", "Viewer"],
    ]);
  });

  it("an out-of-competition viewer sees themselves in «Вне зачёта» with the usual note", async () => {
    mocks.resolveViewer = async () => ({ id: "oo2" });
    followingIdsResponse = async () => ok({ ids: ["p1"] });
    await renderPage();
    await click("Подписки");

    expect(rankedRows().find((r) => r.name === "Alice")?.rank).toBe("1");
    expect(text()).toContain("Вы участвуете вне зачёта этого сезона");
    expect(rankedRows().find((r) => r.name === "Olga OOC")?.rank).toBe("—");
  });

  it("a followed player without season results is simply absent (no invented zero row)", async () => {
    followingIdsResponse = async () => ok({ ids: ["p2", "no-results-yet"] });
    await renderPage();
    await click("Подписки");

    expect(names()).toEqual(["Bob", "Viewer"]);
    expect(text()).not.toContain("no-results-yet");
  });

  it("the viewer is included even when they follow nobody in the season (they are in the list as themselves)", async () => {
    followingIdsResponse = async () => ok({ ids: ["no-results-yet"] });
    await renderPage();
    await click("Подписки");

    expect(rankedRows().map((r) => [r.rank, r.name])).toEqual([["5", "Viewer"]]);
    // Case C: the lone row is explained, not left to look like a bug.
    expect(text()).toContain("У ваших подписок пока нет результатов в этом сезоне");
  });

  it("P. back to «Все» restores the exact season presentation: podium, ТОП-9, full list, Ваша позиция", async () => {
    await renderPage();
    const allBefore = text();
    await click("Подписки");
    expect(hasPodium()).toBe(false);

    await click("Все");

    expect(hasPodium()).toBe(true);
    expect(hasTopNine()).toBe(true);
    expect(text()).toContain("Ваша позиция");
    expect(text()).not.toContain("Игроки, на которых вы подписаны");
    expect(text()).toBe(allBefore);
  });
});

describe("Ваша позиция", () => {
  it("is not repeated when the viewer's own row is already in the flat list (and is never a subset rank)", async () => {
    await renderPage();
    await click("Подписки");

    expect(text()).not.toContain("Ваша позиция");
    expect(rankedRows().find((r) => r.name === "Viewer")?.rank).toBe("5");
  });

  it("is shown (global, official) when the viewer follows nobody", async () => {
    followingIdsResponse = async () => ok({ ids: [] });
    await renderPage();
    await click("Подписки");

    expect(text()).toContain("Ваша позиция");
    expect(text()).toContain("#5"); // the real season position, not "#1 of followed"
  });

  it("is shown when the viewer has no season result of their own (so their status is still visible)", async () => {
    season = { leaderboard: seasonRows().filter((r) => r.player_id !== "p5"), outOfCompetition: OOC_ROWS };
    await renderPage();
    await click("Подписки");

    expect(names()).toEqual(["Bob", "Kate"]);
    expect(text()).toContain("Ваша позиция");
    expect(text()).toContain("Пока без позиции");
  });
});

describe("empty states", () => {
  it("L. anonymous: no following request, the empty state, no login prompt", async () => {
    mocks.resolveViewer = async () => {
      throw new Error("Необходимо войти в систему");
    };
    await renderPage();

    await click("Подписки");

    expect(idsCalls()).toHaveLength(0);
    expect(text()).toContain("Вы пока ни на кого не подписаны");
    expect(text()).not.toContain("Ваша позиция");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("M. the viewer follows nobody: «Вы пока ни на кого не подписаны» (even though they have a season row)", async () => {
    followingIdsResponse = async () => ok({ ids: [] });
    await renderPage();
    await click("Подписки");

    expect(text()).toContain("Вы пока ни на кого не подписаны");
    expect(text()).not.toContain("У ваших подписок пока нет результатов в этом сезоне");
    expect(rankedRows()).toHaveLength(0);
  });

  it("N. follows exist but neither the viewer nor the followed have season results: «У ваших подписок пока нет результатов в этом сезоне»", async () => {
    season = { leaderboard: seasonRows().filter((r) => r.player_id !== "p5" && r.player_id !== "p2" && r.player_id !== "p11"), outOfCompetition: [] };
    await renderPage();
    await click("Подписки");

    expect(text()).toContain("У ваших подписок пока нет результатов в этом сезоне");
    expect(text()).not.toContain("Вы пока ни на кого не подписаны");
  });

  it("an empty season with follows gives the same no-results message, not the «follow nobody» one", async () => {
    season = { leaderboard: [], outOfCompetition: [] };
    await renderPage();
    await click("Подписки");

    expect(text()).toContain("У ваших подписок пока нет результатов в этом сезоне");
    expect(text()).not.toContain("Вы пока ни на кого не подписаны");
  });
});

const NO_FOLLOW_RESULTS = "У ваших подписок пока нет результатов в этом сезоне";
const NOT_FOLLOWING = "Вы пока ни на кого не подписаны";
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// The five empty-state cases of the pre-release audit, side by side.
describe("empty-state matrix (A-E)", () => {
  it("A. no follows + the viewer HAS a result: no rows, global «Ваша позиция», «Вы пока ни на кого не подписаны»", async () => {
    followingIdsResponse = async () => ok({ ids: [] });
    await renderPage();
    await click("Подписки");

    expect(rankedRows()).toHaveLength(0);
    expect(text()).toContain("Ваша позиция");
    expect(text()).toContain("#5");
    expect(text()).toContain(NOT_FOLLOWING);
    expect(text()).not.toContain(NO_FOLLOW_RESULTS);
  });

  it("B. no follows + the viewer has NO result: no rows, «Пока без позиции», «Вы пока ни на кого не подписаны»", async () => {
    followingIdsResponse = async () => ok({ ids: [] });
    season = { leaderboard: seasonRows().filter((r) => r.player_id !== "p5"), outOfCompetition: OOC_ROWS };
    await renderPage();
    await click("Подписки");

    expect(rankedRows()).toHaveLength(0);
    expect(text()).toContain("Пока без позиции");
    expect(text()).toContain(NOT_FOLLOWING);
    expect(text()).not.toContain(NO_FOLLOW_RESULTS);
  });

  it("C. follows exist, none has a result, the viewer DOES: own row kept at the official rank, no duplicate «Ваша позиция», PLUS the no-results message", async () => {
    followingIdsResponse = async () => ok({ ids: ["no-results-yet", "also-none"] });
    await renderPage();
    await click("Подписки");

    expect(rankedRows().map((r) => [r.rank, r.name, r.isYou])).toEqual([["5", "Viewer", true]]);
    expect(text()).not.toContain("Ваша позиция");
    expect(occurrences(text(), NO_FOLLOW_RESULTS)).toBe(1);
    expect(text()).not.toContain(NOT_FOLLOWING);
    // The note sits BELOW the viewer's row.
    const note = container.querySelector('[data-testid="following-no-results"]');
    const viewerRow = rankedRows().length ? container.querySelector("a.border-b") : null;
    expect(note).not.toBeNull();
    expect(viewerRow!.compareDocumentPosition(note!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("C (out of competition). an out-of-competition viewer whose follows have no results keeps their row and gets the message", async () => {
    mocks.resolveViewer = async () => ({ id: "oo2" });
    followingIdsResponse = async () => ok({ ids: ["no-results-yet"] });
    await renderPage();
    await click("Подписки");

    expect(text()).toContain("Olga OOC");
    expect(text()).not.toContain("Ваша позиция");
    expect(occurrences(text(), NO_FOLLOW_RESULTS)).toBe(1);
  });

  it("C is NOT shown when at least one followed player has a result (ranked or out of competition)", async () => {
    followingIdsResponse = async () => ok({ ids: ["p2"] });
    await renderPage();
    await click("Подписки");
    expect(text()).not.toContain(NO_FOLLOW_RESULTS);
    expect(container.querySelector('[data-testid="following-no-results"]')).toBeNull();

    await click("Все");
    followingIdsResponse = async () => ok({ ids: ["oo1"] });
    // A fresh page for the out-of-competition-only variant.
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderPage();
    await click("Подписки");
    expect(text()).toContain("Oscar OOC");
    expect(text()).not.toContain(NO_FOLLOW_RESULTS);
  });

  it("D. follows exist but NOBODY (viewer included) has a result: no rows, «Пока без позиции», the no-results message", async () => {
    season = {
      leaderboard: seasonRows().filter((r) => r.player_id !== "p5" && r.player_id !== "p2" && r.player_id !== "p11"),
      outOfCompetition: [],
    };
    await renderPage();
    await click("Подписки");

    expect(rankedRows()).toHaveLength(0);
    expect(text()).toContain("Пока без позиции");
    expect(occurrences(text(), NO_FOLLOW_RESULTS)).toBe(1);
    expect(text()).not.toContain(NOT_FOLLOWING);
  });

  it("E. anonymous: no following-ids request, no rows, no private current-player card, «Вы пока ни на кого не подписаны»", async () => {
    mocks.resolveViewer = async () => {
      throw new Error("Необходимо войти в систему");
    };
    await renderPage();
    await click("Подписки");

    expect(idsCalls()).toHaveLength(0);
    expect(rankedRows()).toHaveLength(0);
    expect(text()).not.toContain("Ваша позиция");
    expect(text()).not.toContain("Пока без позиции");
    expect(text()).toContain(NOT_FOLLOWING);
    expect(text()).not.toContain(NO_FOLLOW_RESULTS);
  });
});

describe("failure isolation", () => {
  it("O. a failing following-ids request shows a LOCAL error, never the empty state, and «Все» stays fully usable", async () => {
    followingIdsResponse = async () => ({ ok: false, json: async () => ({ error: "Не удалось загрузить список. Попробуйте ещё раз." }) }) as Response;
    await renderPage();

    await click("Подписки");
    await waitForRetry();

    expect(text()).toContain("Не удалось загрузить список. Попробуйте ещё раз.");
    expect(text()).not.toContain("Вы пока ни на кого не подписаны");
    expect(text()).not.toContain("У ваших подписок пока нет результатов");

    await click("Все");
    expect(hasPodium()).toBe(true);
    expect(hasTopNine()).toBe(true);
    expect(names()).toContain("Kate");

    // The other top-level modes are untouched.
    await click("Всё время");
    expect(text()).toContain("1900");
    await click("Статистика");
    expect(text()).toContain("42");
  });

  it("an error response without a usable body still gives a safe local message", async () => {
    followingIdsResponse = async () => ok({ nope: true });
    await renderPage();

    await click("Подписки");

    expect(text()).toContain("Не удалось выполнить запрос");
    expect(text()).not.toContain("Вы пока ни на кого не подписаны");
  });

  it("«Повторить» retries the request and replaces the error with the list", async () => {
    followingIdsResponse = async () => ({ ok: false, json: async () => ({ error: "Сбой" }) }) as Response;
    await renderPage();
    await click("Подписки");
    await waitForRetry();
    expect(text()).toContain("Сбой");
    const callsAfterFailure = idsCalls().length;

    followingIdsResponse = async () => ok({ ids: ["p2"] });
    await click("Повторить");

    expect(idsCalls().length).toBeGreaterThan(callsAfterFailure);
    expect(names()).toEqual(["Bob", "Viewer"]);
    expect(text()).not.toContain("Сбой");
  });

  it("a failed request is not retried in a loop while the view stays open", async () => {
    followingIdsResponse = async () => ({ ok: false, json: async () => ({ error: "Сбой" }) }) as Response;
    await renderPage();
    await click("Подписки");
    await waitForRetry();
    expect(text()).toContain("Сбой");
    const calls = idsCalls().length;
    expect(calls).toBe(2); // the first attempt + fetchJsonWithRetry's single retry, nothing more

    await waitForRetry();
    await settle();

    expect(idsCalls()).toHaveLength(calls);
  });
});

describe("stale and concurrent requests", () => {
  it("changing mode while the ids are loading leaves the other modes untouched; the late result is cached for the Подписки view", async () => {
    let release!: (response: Response) => void;
    followingIdsResponse = () => new Promise((res) => (release = res));
    await renderPage();

    await click("Подписки");
    expect(text()).toContain("Загружаем...");

    await click("Всё время");
    expect(text()).toContain("1900");
    expect(text()).not.toContain("Загружаем...");

    await act(async () => release(ok({ ids: ["p2", "p11"] })));
    await settle();
    // Still in all-time mode: nothing from the following view leaked in.
    expect(text()).toContain("1900");
    expect(container.querySelector('[role="group"]')).toBeNull();

    await click("Текущий сезон");
    expect(names()).toEqual(["Bob", "Viewer", "Kate"]);
    expect(idsCalls()).toHaveLength(1);
  });

  it("while ids load, «Все» is immediately usable (the loading state is local to Подписки)", async () => {
    followingIdsResponse = () => new Promise(() => {});
    await renderPage();

    await click("Подписки");
    await click("Все");

    expect(hasPodium()).toBe(true);
    expect(names()).toContain("Kate");
  });
});

describe(">50 follows", () => {
  it("uses the unbounded ids: with 120 followed players, one far beyond the first 50 is still in the view with its official rank", async () => {
    const big = Array.from({ length: 130 }, (_, i) => row(`q${i + 1}`, `Player ${i + 1}`, 5000 - i));
    // The viewer is #1; the viewer follows q10..q129 (120 players).
    big[0] = row("p5", "Viewer", 5000);
    season = { leaderboard: big, outOfCompetition: [] };
    const followed = Array.from({ length: 120 }, (_, i) => `q${i + 10}`);
    followingIdsResponse = async () => ok({ ids: followed });
    await renderPage();

    await click("Подписки");

    const rows = rankedRows();
    expect(rows).toHaveLength(121); // 120 followed + the viewer
    expect(rows.find((r) => r.name === "Player 117")?.rank).toBe("117"); // far past any 50-row page
    expect(rows.find((r) => r.name === "Player 129")?.rank).toBe("129");
    expect(rows.find((r) => r.name === "Player 5")).toBeUndefined(); // q5 is not followed
    // Only the unbounded endpoint was used.
    expect(idsCalls()).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([u]) => /\/following\?/.test(String(u)))).toBe(false);
  });
});

describe("other modes are unchanged", () => {
  it("Q. all-time and statistics behave as before and never trigger the following request", async () => {
    await renderPage();

    await click("Всё время");
    expect(fetchMock).toHaveBeenCalledWith("/api/leaderboard/all-time");
    expect(text()).toContain("1900");
    expect(hasTopNine()).toBe(false);

    await click("Статистика");
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/leaderboard/statistics"))).toBe(true);
    expect(text()).toContain("42");

    expect(idsCalls()).toHaveLength(0);
  });
});
