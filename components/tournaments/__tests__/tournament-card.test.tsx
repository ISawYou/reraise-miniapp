import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TournamentCard } from "@/components/tournaments/tournament-card";
import type { Tournament } from "@/types/domain";

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

function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: "t1",
    title: "Test Tournament",
    // Far in the future so countdown formatting never flips to "Уже начался"
    // and destabilizes assertions.
    start_at: "2099-01-01T00:00:00.000Z",
    max_players: 20,
    kind: "free",
    tournament_type: "classic",
    season_id: null,
    status: "open",
    created_at: "2026-01-01T00:00:00.000Z",
    rating_formula_version: "v2",
    rating_guarantee: null,
    is_final: false,
    ...overrides,
  };
}

async function renderCard(props: Partial<Parameters<typeof TournamentCard>[0]> = {}) {
  await act(async () => {
    root.render(
      <TournamentCard
        tournament={tournament()}
        registeredCount={5}
        configs={{}}
        registrationStatus={null}
        {...props}
      />,
    );
  });
}

describe("TournamentCard -- normal (is_final=false) registration presentation", () => {
  it("not registered, no onAction (Home): renders a non-interactive status pill reading 'Записаться'", async () => {
    await renderCard({ registrationStatus: null });
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("Записаться");
  });

  it("registered: shows 'Вы записаны'", async () => {
    await renderCard({ registrationStatus: "registered" });
    expect(container.textContent).toContain("Вы записаны");
  });

  it("waitlist: shows 'Вы в листе ожидания'", async () => {
    await renderCard({ registrationStatus: "waitlist" });
    expect(container.textContent).toContain("Вы в листе ожидания");
  });

  it("with onAction provided (detail page): renders a real, clickable <button>", async () => {
    const onAction = vi.fn();
    await renderCard({ registrationStatus: null, onAction });

    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("actionLoading: shows 'Сохраняем...' and disables the button", async () => {
    await renderCard({ registrationStatus: null, onAction: vi.fn(), actionLoading: true });
    const button = container.querySelector("button");
    expect(container.textContent).toContain("Сохраняем...");
    expect(button?.disabled).toBe(true);
  });

  it("a completed tournament renders no action area at all", async () => {
    await renderCard({ tournament: tournament({ status: "completed" }), onAction: vi.fn() });
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toContain("Записаться");
  });
});

describe("TournamentCard -- Final Month (is_final=true), driven only by tournament.is_final", () => {
  it("not in the roster: shows 'Только по приглашению', never a button even with onAction", async () => {
    const onAction = vi.fn();
    await renderCard({
      tournament: tournament({ is_final: true }),
      registrationStatus: null,
      onAction,
    });

    expect(container.textContent).toContain("Только по приглашению");
    expect(container.querySelector("button")).toBeNull();
  });

  it("manually added to the roster: shows 'Вы в составе финала'", async () => {
    await renderCard({
      tournament: tournament({ is_final: true }),
      registrationStatus: "registered",
    });
    expect(container.textContent).toContain("Вы в составе финала");
  });

  it("shows the ФИНАЛ badge only when is_final", async () => {
    await renderCard({ tournament: tournament({ is_final: true }) });
    expect(container.textContent).toContain("ФИНАЛ");
  });

  it("does not show the ФИНАЛ badge for a normal tournament", async () => {
    await renderCard({ tournament: tournament({ is_final: false }) });
    expect(container.textContent).not.toContain("ФИНАЛ");
  });

  it("applies the burgundy/red card treatment only when is_final", async () => {
    await renderCard({ tournament: tournament({ is_final: true }) });
    expect(container.querySelector(".border-red-500\\/25")).not.toBeNull();
  });

  it("a title containing the literal final wording is NOT enough by itself -- only tournament.is_final matters", async () => {
    await renderCard({
      tournament: tournament({ is_final: false, title: "ФИНАЛ МЕСЯЦА" }),
    });
    expect(container.querySelector(".border-red-500\\/25")).toBeNull();
    expect(container.textContent).not.toContain("Только по приглашению");
    expect(container.textContent).not.toContain("Вы в составе финала");
  });
});
