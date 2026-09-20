// Product correction: "Моя смена администратора" is a club-Administrator
// (DB role "operator") concept -- Super Admin (DB role "admin") is not
// automatically a club administrator and should not be prompted to record
// a personal shift. Super Admin management (Смены администраторов) must
// stay reachable regardless. Same render convention as
// app/__tests__/admin-shifts-page.test.tsx (raw react-dom/client, no
// testing-library dependency in this repo).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

let currentRole: "operator" | "admin" = "operator";
vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve({ id: "p1", role: currentRole }),
}));

const fetchAdminJson = vi.fn();
vi.mock("@/lib/client-request", () => ({
  fetchAdminJson: (...args: unknown[]) => fetchAdminJson(...args),
}));

const { default: AdminPage } = await import("@/app/admin/page");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  fetchAdminJson.mockReset();
  fetchAdminJson.mockImplementation(async (url: string) => {
    if (url === "/api/dealer/me") return { dealer: null };
    if (url === "/api/admin-shift/me") return { openShift: null, history: [] };
    throw new Error(`Unexpected fetchAdminJson call: ${url}`);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderPage() {
  await act(async () => {
    root.render(<AdminPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Admin dashboard -- self-service shift widget is operator-only", () => {
  it("operator sees 'Моя смена администратора'", async () => {
    currentRole = "operator";
    await renderPage();
    expect(container.textContent?.toUpperCase()).toContain("МОЯ СМЕНА АДМИНИСТРАТОРА");
  });

  it("Super Admin (admin) does NOT see 'Моя смена администратора'", async () => {
    currentRole = "admin";
    await renderPage();
    expect(container.textContent?.toUpperCase()).not.toContain("МОЯ СМЕНА АДМИНИСТРАТОРА");
  });

  it("Super Admin still sees/can reach admin-shifts management", async () => {
    currentRole = "admin";
    await renderPage();
    const link = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent === "Смены администраторов"
    );
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe("/admin/admin-shifts");
  });

  it("operator's self-service widget never calls the Super Admin management endpoint", async () => {
    currentRole = "operator";
    await renderPage();
    expect(fetchAdminJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/admin-shifts"),
      expect.anything()
    );
  });
});
