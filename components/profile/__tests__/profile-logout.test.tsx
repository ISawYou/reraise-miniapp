import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileLogout } from "@/components/profile/profile-logout";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock("@/lib/current-player", () => ({ invalidateCurrentPlayerCache: mocks.invalidate }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.invalidate.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(enabled: boolean) {
  await act(async () => root.render(<ProfileLogout enabled={enabled} />));
}

describe("ProfileLogout", () => {
  it("shows logout only when the parent has established a web own-profile context", async () => {
    await render(false);
    expect(container.querySelector('[data-testid="logout-open"]')).toBeNull();

    await render(true);
    expect(container.querySelector('[data-testid="logout-open"]')).not.toBeNull();
  });

  it("supports cancel, reports failed logout, and navigates after success", async () => {
    const request = vi.mocked(fetch);
    await render(true);

    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="logout-open"]')!.click());
    expect(container.textContent).toContain("Выйти из аккаунта?");
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Отмена")!.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="logout-open"]')!.click());
    request.mockResolvedValueOnce(Response.json({ error: "Сервис недоступен" }, { status: 503 }));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="logout-confirm"]')!.click());
    expect(container.textContent).toContain("Сервис недоступен");
    expect(mocks.replace).not.toHaveBeenCalled();

    request.mockResolvedValueOnce(Response.json({ ok: true }));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="logout-confirm"]')!.click());
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/login");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
