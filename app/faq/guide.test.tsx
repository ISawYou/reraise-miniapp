import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { FAQ_CONTENT } from "@/config/faq-content";
import FaqPage from "./page";
vi.mock("@/components/ui/back-button", () => ({
  BackButton: () => <span>Назад</span>,
}));
let cleanup = () => {};
afterEach(() => cleanup());
it("search opens the full answer and popstate restores the overview", async () => {
  window.history.replaceState(null, "", "/faq");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  cleanup = () => {
    act(() => root.unmount());
    el.remove();
    vi.restoreAllMocks();
  };
  await act(async () => root.render(<FaqPage />));
  const input = el.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "Phoenix");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(el.querySelector('[aria-label="Результаты поиска"]')).not.toBeNull();
  const answer = Array.from(
    el.querySelectorAll<HTMLAnchorElement>(".guide-result"),
  ).find((a) => a.querySelector("h3")?.textContent === "Phoenix")!;
  await act(async () => answer.click());
  expect(el.querySelector("h1")?.textContent).toBe("Phoenix");
  expect(el.querySelector("article")?.textContent).toContain("1 500 ₽");
  expect(el.querySelector("article details")).toBeNull();
  await act(async () => {
    window.history.replaceState(null, "", "/faq");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(el.querySelector("h1")?.textContent).toBe("Гид по РЕРЕЙЗ");
});
it.each(["general", "common-rules", "tournament-rules", "rating-rules"])(
  "opens deep link %s and supports navigation",
  async (tab) => {
    window.history.replaceState(null, "", `/faq?tab=${tab}`);
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    cleanup = () => {
      act(() => root.unmount());
      el.remove();
    };
    await act(async () => root.render(<FaqPage />));
    expect(el.querySelector("h1")?.textContent).toBeTruthy();
    window.history.pushState(null, "", "/faq?tab=rating-rules");
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(window.location.search).toBe("?tab=rating-rules");
    expect(el.querySelectorAll("table")).toHaveLength(2);
  },
);
it("preserves detailed formulas and approved formats without editorial notes", () => {
  const text = FAQ_CONTENT.join("\n");
  expect(FAQ_CONTENT).toHaveLength(4);
  expect(text).toContain("50 000");
  expect(text).toContain("1 500 ₽");
  expect(text).toContain("Progressive Knockout");
  expect(text).toContain("1,25");
  expect(text).not.toMatch(
    /Перед публикацией|ПРЕДПУБЛИКАЦИОННЫЕ|до её утверждения|### Финал отбора/,
  );
});
it("documents the PKO placement policy separately from progressive KO points", () => {
  const text = FAQ_CONTENT.join("\n");
  expect(text).toContain("Для Bounty Hunters, Boss Bounty и Progressive Knockout");
  expect(text).toContain("повторные входы сами по себе коэффициент не увеличивают");
  expect(text).toContain("Стандартные +5 очков за нокаут в этом формате **не действуют**");
  expect(text).not.toContain("Progressive Knockout, RERAISE Main Event и естественного расчёта Phoenix");
});
it("keeps Phoenix and monthly final in ordinary create options, excluding qualification final", () => {
  const source = readFileSync("app/admin/tournaments/create/page.tsx", "utf8");
  const options = source.split("TOURNAMENT_TYPE_OPTIONS:")[1].split("];")[0];
  expect(options).toContain('"phoenix"');
  expect(options).toContain("FINAL_MONTH_PRESET");
  expect(options).not.toContain('"qualification_final"');
});
