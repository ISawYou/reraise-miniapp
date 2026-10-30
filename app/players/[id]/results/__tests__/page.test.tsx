import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ id: "player-1", fail: false }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: mocks.id }), useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/tournament-visuals-client", () => ({ fetchTournamentVisualConfigs: vi.fn().mockResolvedValue({}) }));
const { default: ResultsPage } = await import("../page");
let el: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  el = document.createElement("div"); document.body.append(el); root = createRoot(el);
  mocks.id = "player-1"; mocks.fail = false;
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const offset = Number(new URL(url, "http://local").searchParams.get("offset"));
    return { ok: !mocks.fail, json: async () => ({
      player: { id: mocks.id, display_name: "Player" }, next_offset: offset < 60 ? offset + 20 : null,
      items: Array.from({ length: offset < 60 ? 20 : 5 }, (_, i) => ({
        tournament: { id: `t-${offset+i}`, title: `Result ${offset+i}`, tournament_type: "classic", start_at: "2026-10-01T19:00:00Z" },
        result: { place: 1, field_size: 50, rating_points: 12, knockouts: 0 },
      })),
    }) };
  }));
});
afterEach(async () => { await act(async () => root.unmount()); el.remove(); vi.unstubAllGlobals(); });
async function click(text: string) {
  const button = [...el.querySelectorAll("button")].find(b => b.textContent === text)!;
  await act(async () => button.click());
}
it("navigates 65 results with bounded pages and a canonical profile backlink", async () => {
  await act(async () => root.render(<ResultsPage />));
  expect(el.querySelectorAll('a[href^="/tournaments/"]')).toHaveLength(20);
  expect(el.querySelector('a[href="/players/player-1"]')).not.toBeNull();
  expect([...el.querySelectorAll("button")].find(b => b.textContent === "← Назад")?.disabled).toBe(true);
  for (let i = 0; i < 3; i++) await click("Далее →");
  expect(el.querySelectorAll('a[href^="/tournaments/"]')).toHaveLength(5);
  expect(el.textContent).toContain("Страница 4");
  expect([...el.querySelectorAll("button")].find(b => b.textContent === "Далее →")?.disabled).toBe(true);
  expect(fetch).toHaveBeenLastCalledWith("/api/players/player-1/results?offset=60");
  await click("← Назад");
  expect(el.querySelectorAll('a[href^="/tournaments/"]')).toHaveLength(20);
  expect(el.textContent).not.toContain("Result 60");
});
it("offers retry after a failed page request", async () => {
  mocks.fail = true;
  await act(async () => root.render(<ResultsPage />));
  expect(el.querySelector('[role="alert"]')).not.toBeNull();
  mocks.fail = false;
  await click("Повторить");
  expect(el.querySelectorAll('a[href^="/tournaments/"]')).toHaveLength(20);
});
