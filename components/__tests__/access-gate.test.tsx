import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessGate } from "@/components/access-gate";

const mocks = vi.hoisted(() => ({
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
