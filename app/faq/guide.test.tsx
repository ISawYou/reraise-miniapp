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
    expect(el.querySelector("button[aria-pressed=true]")).not.toBeNull();
    expect(el.querySelectorAll("nav button")).toHaveLength(4);
    expect(el.querySelectorAll("details").length).toBeGreaterThan(0);
    await act(async () => {
      el.querySelectorAll<HTMLButtonElement>("nav button")[3].click();
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
it("keeps Phoenix and monthly final in ordinary create options, excluding qualification final", () => {
  const source = readFileSync("app/admin/tournaments/create/page.tsx", "utf8");
  const options = source.split("TOURNAMENT_TYPE_OPTIONS:")[1].split("];")[0];
  expect(options).toContain('"phoenix"');
  expect(options).toContain("FINAL_MONTH_PRESET");
  expect(options).not.toContain('"qualification_final"');
});
