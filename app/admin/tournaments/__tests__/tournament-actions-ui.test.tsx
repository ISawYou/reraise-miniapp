import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/types/domain";

const mocks = vi.hoisted(() => ({
  fetchAdminJson: vi.fn(),
  resolveCurrentPlayer: vi.fn(),
  deleteTournament: vi.fn(),
}));

vi.mock("@/lib/client-request", () => ({ fetchAdminJson: mocks.fetchAdminJson }));
vi.mock("@/lib/current-player", () => ({ resolveCurrentPlayer: mocks.resolveCurrentPlayer }));
vi.mock("@/features/tournaments", () => ({ deleteTournament: mocks.deleteTournament }));
vi.mock("@/lib/roles", () => ({
  isStaff: (role: string | null | undefined) => role === "admin" || role === "operator",
  isSuperAdmin: (role: string | null | undefined) => role === "admin",
}));
vi.mock("@/components/ui/back-button", () => ({
  BackButton: ({ href }: { href: string }) => <a href={href}>Назад</a>,
}));

const { default: AdminTournamentsPage } = await import("@/app/admin/tournaments/page");

const admin = { id: "admin", role: "admin" } as Player;
const tournament = (status: "open" | "completed"): Tournament => ({
  id: status === "open" ? "active-1" : "completed-1",
  title: status === "open" ? "Активный" : "Завершённый",
  description: undefined,
  location: "Клуб",
  start_at: "2026-11-14T16:00:00.000Z",
  max_players: 46,
  kind: "free",
  tournament_type: "classic",
  season_id: null,
  status,
  created_at: "2026-11-01T00:00:00.000Z",
  google_sheet_tab_name: "legacy",
  rating_formula_version: "v2",
  rating_guarantee: null,
  placement_points_multiplier: 1,
  is_final: false,
} as Tournament);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.resolveCurrentPlayer.mockResolvedValue(admin);
  mocks.fetchAdminJson.mockResolvedValue({ tournaments: [tournament("open")] });
  mocks.deleteTournament.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function render() {
  await act(async () => root.render(<AdminTournamentsPage />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe("admin tournament actions", () => {
  it("removes the legacy sheet action and keeps control as the active action", async () => {
    await render();

    expect(container.textContent).toContain("Управление турниром");
    expect(container.textContent).not.toContain("Создать таблицу");
    expect(container.textContent).not.toContain("Внести данные");
    expect(container.querySelector('a[href="/admin/tournaments/active-1/control"]')).not.toBeNull();
    expect(container.querySelector('a[href="/admin/results/active-1"]')).toBeNull();
  });

  it("keeps completed result correction while exposing the same control route", async () => {
    mocks.fetchAdminJson.mockResolvedValue({ tournaments: [tournament("completed")] });
    await render();
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Завершённые"))
        ?.click();
    });

    expect(container.textContent).toContain("Редактировать результаты");
    expect(container.querySelector('a[href="/admin/tournaments/completed-1/control"]')).not.toBeNull();
  });
});
