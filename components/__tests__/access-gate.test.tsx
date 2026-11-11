import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessGate } from "@/components/access-gate";

vi.mock("next/navigation",()=>({usePathname:()=>mocks.pathname}));
const mocks = vi.hoisted(() => ({
  pathname:"/",
  resolveCurrentPlayer: vi.fn(),
}));

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: mocks.resolveCurrentPlayer,
}));

vi.mock("@/lib/support", () => ({
  openSupportChat: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;

async function renderGate(
  children: ReactNode = <div data-testid="app">App content</div>,
) {
  await act(async () => {
    root.render(<AccessGate>{children}</AccessGate>);
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
  mocks.resolveCurrentPlayer.mockReset();
  mocks.pathname="/";
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("AccessGate", () => {
  it("shows the app for an active player", async () => {
    mocks.resolveCurrentPlayer.mockResolvedValue({ id: "p1", is_blocked: false });

    await renderGate();

    expect(container.querySelector('[data-testid="app"]')?.textContent).toBe(
      "App content",
    );
    expect(container.textContent).not.toContain("Доступ заблокирован");
  });

  it("replaces the whole app with the blocked screen for a blocked player", async () => {
    mocks.resolveCurrentPlayer.mockResolvedValue({ id: "p1", is_blocked: true });

    await renderGate();

    expect(container.querySelector('[data-testid="app"]')).toBeNull();
    expect(container.textContent).toContain("Доступ заблокирован");
    expect(container.textContent).toContain("Написать в поддержку");
  });

  it("shows the app for an anonymous visitor instead of erroring", async () => {
    mocks.resolveCurrentPlayer.mockRejectedValue(
      new Error("Необходимо войти в систему"),
    );

    await renderGate();

    expect(container.querySelector('[data-testid="app"]')?.textContent).toBe(
      "App content",
    );
  });
});

it("blocked accounts can reach only the exact support page",async()=>{mocks.pathname="/support";mocks.resolveCurrentPlayer.mockResolvedValue({id:"p1",is_blocked:true});await renderGate();expect(container.querySelector('[data-testid="app"]')).not.toBeNull();mocks.pathname="/support/other";await renderGate();expect(container.querySelector('[data-testid="app"]')).toBeNull();});
