// Admin tournament edit screen: "Добавить существующего" picker vs a
// merged-away (tombstone) account. The directory itself is canonical-only
// (proven against real Postgres through the real route in
// lib/__tests__/merged-away-operational-guard.postgres.integration.test.ts);
// this covers the UI side: the picker renders exactly what the directory
// returns, and a STALE list (loaded before a merge) that still shows the
// tombstone gets the server's clear rejection, then reloads so the
// tombstone disappears while the canonical account stays selectable.
// Same render harness as no-show-participants-ui.test.tsx.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/types/domain";

const MERGED_MESSAGE = "Этот аккаунт уже объединён с другим. Выберите основной аккаунт.";

const mocks = vi.hoisted(() => ({
  fetchAdminJson: vi.fn(),
  getTournamentById: vi.fn(),
  getAdminTournamentParticipants: vi.fn(),
  addExistingPlayerToTournament: vi.fn(),
  directory: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "t1" }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: () => Promise.resolve(admin),
}));
vi.mock("@/lib/client-request", () => ({ fetchAdminJson: mocks.fetchAdminJson }));
vi.mock("@/features/tournament-roster-actions", () => ({
  markTournamentPlayerNoShow: vi.fn(),
  admitTournamentPlayerFromWaitlist: vi.fn(),
}));
vi.mock("@/features/tournaments", () => ({
  addAdminTournamentParticipant: vi.fn(),
  addExistingPlayerToTournament: mocks.addExistingPlayerToTournament,
  getAdminTournamentParticipants: mocks.getAdminTournamentParticipants,
  getTournamentById: mocks.getTournamentById,
  removeAdminTournamentParticipant: vi.fn(),
  updateTournament: vi.fn(),
}));

const admin = { id: "admin", role: "operator", display_name: "Op" } as Player;

const { default: AdminTournamentEditPage } = await import("@/app/admin/tournaments/[id]/edit/page");

// Production shape: savinska33 (merged-away) -> p_73a (canonical).
function player(id: string, mergedInto: string | null = null): Player {
  return {
    id,
    display_name: id,
    username: null,
    role: "player",
    is_blocked: false,
    merged_into_player_id: mergedInto,
    created_at: "2026-01-01T00:00:00.000Z",
  } as unknown as Player;
}
const P_73A = player("p_73a");
const SAVINSKA33 = player("savinska33", "p_73a");
const OTHER = player("zed");

function tournament(): Tournament {
  return {
    id: "t1",
    title: "Вечерний",
    description: "d",
    location: "l",
    start_at: "2026-10-12T16:00:00.000Z",
    max_players: 40,
    kind: "free",
    tournament_type: "classic",
    season_id: null,
    status: "open",
    created_at: "2026-10-01T00:00:00.000Z",
    rating_formula_version: "v2",
    rating_guarantee: null,
    placement_points_multiplier: 1,
    is_final: false,
  } as Tournament;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.fetchAdminJson.mockImplementation(async (url: string) => {
    if (url === "/api/admin/nicknames/players") return { players: mocks.directory };
    if (url.includes("late-registration")) return { snapshot: null };
    return { season: { title: "Осень" } };
  });
  mocks.getTournamentById.mockResolvedValue(tournament());
  mocks.getAdminTournamentParticipants.mockResolvedValue([]);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function button(text: string, scope: ParentNode = container): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;
}

async function click(target: HTMLElement | undefined) {
  expect(target).toBeDefined();
  await act(async () => target!.click());
  await flush();
}

async function openExistingPicker() {
  await act(async () => root.render(<AdminTournamentEditPage />));
  await flush();
  await click(button("+ Добавить"));
  await click(button("Добавить существующего"));
}

function pickerRow(name: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll("p"))
    .find((p) => p.textContent === name)
    ?.closest("div.flex.items-center.justify-between") as HTMLElement | undefined;
}

describe("tournament 'Добавить существующего' picker", () => {
  it("5 + 6. with the canonical-only directory: savinska33 is absent, p_73a is listed and addable", async () => {
    mocks.directory = [P_73A, OTHER];
    mocks.addExistingPlayerToTournament.mockResolvedValue({ ok: true });

    await openExistingPicker();

    expect(pickerRow("savinska33")).toBeUndefined();
    expect(pickerRow("p_73a")).toBeDefined();

    await click(button("Добавить", pickerRow("p_73a")!));

    expect(mocks.addExistingPlayerToTournament).toHaveBeenCalledWith("t1", "p_73a");
    expect(container.textContent).toContain("Участник добавлен");
  });

  it("stale list: picking the tombstone shows the server's clear error and reloads the directory without it", async () => {
    // Loaded before the merge committed -- the stale list still has the source.
    mocks.directory = [P_73A, SAVINSKA33];
    mocks.addExistingPlayerToTournament.mockImplementation(async () => {
      mocks.directory = [P_73A];
      return { ok: false, error: MERGED_MESSAGE };
    });

    await openExistingPicker();
    expect(pickerRow("savinska33")).toBeDefined();

    await click(button("Добавить", pickerRow("savinska33")!));

    // Never silently redirected: exactly the submitted id was sent once.
    expect(mocks.addExistingPlayerToTournament).toHaveBeenCalledTimes(1);
    expect(mocks.addExistingPlayerToTournament).toHaveBeenCalledWith("t1", "savinska33");
    expect(container.textContent).toContain(MERGED_MESSAGE);
    expect(container.textContent).not.toContain("Участник добавлен");
    expect(pickerRow("savinska33")).toBeUndefined();
    expect(pickerRow("p_73a")).toBeDefined();
  });
});
