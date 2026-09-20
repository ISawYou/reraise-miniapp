// Fix for two UX/operations issues on /admin/admin-shifts: (1) the bottom
// sheet had no reliable dismiss control, (2) Super Admin could not close
// another admin's forgotten-open shift. Same render convention as
// app/__tests__/leaderboard-page-statistics.test.tsx (raw react-dom/client,
// no testing-library dependency in this repo).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve({ id: "superadmin-1", role: "admin" }),
}));

// BackButton calls useRouter() -- no app router is mounted under raw
// react-dom/client rendering, same stub every other page test in this repo uses.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const fetchAdminJson = vi.fn();
vi.mock("@/lib/client-request", () => ({
  fetchAdminJson: (...args: unknown[]) => fetchAdminJson(...args),
}));

const { default: AdminAdminShiftsPage } = await import("@/app/admin/admin-shifts/page");

let container: HTMLDivElement;
let root: Root;

const OPEN_SHIFT = {
  id: "s-open",
  adminPlayerId: "p2",
  adminDisplayName: "Открытый Админ",
  startedAt: "2026-01-01T18:00:00.000Z",
  endedAt: null,
  amountRub: 4000,
  tournamentId: null,
  tournamentTitle: null,
  tournamentDate: null,
  updatedByPlayerId: null,
};

const COMPLETED_SHIFT = {
  id: "s-done",
  adminPlayerId: "p3",
  adminDisplayName: "Завершённый Админ",
  startedAt: "2026-01-01T10:00:00.000Z",
  endedAt: "2026-01-01T14:00:00.000Z",
  amountRub: 3000,
  tournamentId: "t1",
  tournamentTitle: "Weekly",
  tournamentDate: "2026-01-01T10:00:00.000Z",
  updatedByPlayerId: null,
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  fetchAdminJson.mockReset();
  fetchAdminJson.mockImplementation(async (url: string) => {
    if (url === "/api/admin/admin-shifts") {
      return { shifts: [OPEN_SHIFT, COMPLETED_SHIFT] };
    }
    if (url === "/api/admin/nicknames/players") {
      return { players: [] };
    }
    if (typeof url === "string" && url.startsWith("/api/admin/tournaments")) {
      return { tournaments: [] };
    }
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
    root.render(<AdminAdminShiftsPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findButtonWithText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text);
}

function clickButtonWithText(text: string) {
  const btn = findButtonWithText(text);
  if (!btn) throw new Error(`Button "${text}" not found`);
  btn.click();
}

// The row action and the sheet's submit button can share the same label
// ("Завершить смену") -- this scopes the click to the dialog only, so it
// unambiguously hits the submit button, not the row behind it.
function clickButtonInDialog(text: string) {
  const dialog = container.querySelector('[role="dialog"]');
  const btn = Array.from(dialog?.querySelectorAll("button") ?? []).find((b) => b.textContent === text);
  if (!btn) throw new Error(`Button "${text}" not found in dialog`);
  btn.click();
}

function findRow(adminName: string): HTMLElement | null {
  const nameEl = Array.from(container.querySelectorAll("p")).find((p) => p.textContent === adminName);
  return nameEl?.closest('div[class*="rounded-xl"]') ?? null;
}

describe("Admin Shifts management UI fixes", () => {
  it("an open shift exposes 'Завершить смену', not 'Изменить'", async () => {
    await renderPage();
    const openRow = findRow("Открытый Админ");
    expect(openRow?.textContent).toContain("Завершить смену");
    expect(openRow?.textContent).not.toContain("Изменить");
  });

  it("a completed shift exposes 'Изменить', not 'Завершить смену'", async () => {
    await renderPage();
    const doneRow = findRow("Завершённый Админ");
    expect(doneRow?.textContent).toContain("Изменить");
    expect(doneRow?.textContent).not.toContain("Завершить смену");
  });

  it("clicking 'Завершить смену' on an open shift opens the dedicated close sheet, not the completed-correction sheet", async () => {
    await renderPage();
    await act(async () => {
      clickButtonWithText("Завершить смену");
      await Promise.resolve();
    });

    // The close sheet shows read-only Администратор/Начало plus a
    // "[ Завершить смену ]" submit button -- never routes into the
    // completed-shift correction flow (which would show an editable
    // Администратор select and reject an open shift server-side).
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe("Завершить смену");
    expect(dialog?.textContent).toContain("Открытый Админ");
    expect(dialog?.textContent).toContain("Администратор");

    // No PATCH correction call was made just by opening the sheet.
    expect(fetchAdminJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/admin-shifts/s-open"),
      expect.anything()
    );
  });

  it("the bottom sheet has an explicit dismiss control (× button), independent of the decorative handle", async () => {
    await renderPage();
    await act(async () => {
      clickButtonWithText("Завершить смену");
    });

    const dialog = container.querySelector('[role="dialog"]');
    const closeButton = dialog?.querySelector('button[aria-label="Закрыть"]');
    expect(closeButton).toBeTruthy();
  });

  it("dismissing the sheet (× button) does not call the close/correction endpoint -- no mutation", async () => {
    await renderPage();
    await act(async () => {
      clickButtonWithText("Завершить смену");
    });
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    const closeButton = container.querySelector('button[aria-label="Закрыть"]') as HTMLButtonElement;
    await act(async () => {
      closeButton.click();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchAdminJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/close"),
      expect.anything()
    );
    expect(fetchAdminJson).not.toHaveBeenCalledWith(
      "/api/admin/admin-shifts/s-open",
      expect.anything()
    );
  });

  it("dismissing via Escape closes the sheet without mutating anything", async () => {
    await renderPage();
    await act(async () => {
      clickButtonWithText("Завершить смену");
    });
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchAdminJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/close"),
      expect.anything()
    );
  });

  it("submitting the close sheet calls the dedicated close endpoint with the shift's stored amount and current tournament by default", async () => {
    fetchAdminJson.mockImplementation(async (url: string) => {
      if (url === "/api/admin/admin-shifts") return { shifts: [OPEN_SHIFT] };
      if (url === "/api/admin/nicknames/players") return { players: [] };
      if (typeof url === "string" && url.startsWith("/api/admin/tournaments")) return { tournaments: [] };
      if (url === "/api/admin/admin-shifts/s-open/close") return { shift: { ...OPEN_SHIFT, endedAt: "2026-01-02T00:00:00.000Z" } };
      throw new Error(`Unexpected call: ${url}`);
    });

    await renderPage();
    await act(async () => {
      clickButtonWithText("Завершить смену");
      await Promise.resolve();
    });

    await act(async () => {
      clickButtonInDialog("Завершить смену");
      await Promise.resolve();
    });

    const closeCall = fetchAdminJson.mock.calls.find(
      (call) => call[0] === "/api/admin/admin-shifts/s-open/close"
    );
    expect(closeCall).toBeTruthy();
    const body = JSON.parse((closeCall?.[1] as RequestInit).body as string);
    expect(body.amountRub).toBe(4000);
    expect(body.tournamentId).toBeNull();
  });
});
