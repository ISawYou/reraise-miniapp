// Teams v1 explicitly does NOT add a fifth bottom-navigation item (reached
// via a link from Home/profile/the Teams page itself instead). This pins
// the bottom nav at exactly its pre-existing 4 items.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const player: Player = {
  id: "p1",
  telegram_id: 1,
  username: "p1",
  display_name: "Player",
  role: "player",
  is_blocked: false,
} as Player;

vi.mock("@/lib/current-player", () => ({ resolveCurrentPlayer: () => Promise.resolve(player) }));

const { BottomNav } = await import("@/components/bottom-nav");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("BottomNav", () => {
  it("renders exactly 4 items -- Главная/Турниры/Академия/Профиль, no Команды item", async () => {
    await act(async () => {
      root.render(<BottomNav />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const links = container.querySelectorAll("nav a");
    expect(links).toHaveLength(4);
    expect(container.textContent).toContain("Главная");
    expect(container.textContent).toContain("Турниры");
    expect(container.textContent).toContain("Академия");
    expect(container.textContent).toContain("Профиль");
    expect(container.textContent).not.toContain("Команды");
  });
});
