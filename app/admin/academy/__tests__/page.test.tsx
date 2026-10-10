import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademyAdminProgressPayload } from "@/types/academy";

const mocks = vi.hoisted(() => ({ payload: null as unknown }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/academy",
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/current-player", () => ({
  resolveCurrentPlayer: async () => ({ role: "admin" }),
}));
vi.mock("@/lib/client-request", () => ({
  fetchAdminJson: async () => mocks.payload,
}));

const { default: AdminAcademyPage } = await import("@/app/admin/academy/page");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function lesson(code: string, title: string, passed: boolean | null) {
  return {
    lessonCode: code,
    title,
    progress: passed === null ? null : {
      lessonCode: code, attemptsCount: 2, lastScorePercent: 90, bestScorePercent: 90, passed,
      firstCompletedAt: passed ? "2026-01-01T00:00:00.000Z" : null, lastAttemptAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

const payload: AcademyAdminProgressPayload = {
  summary: { startedPlayers: 1, passedPlayers: 1 },
  players: [{
    player: { id: "p1", displayName: "Kirill", username: null, avatarUrl: null },
    passedLessons: 2,
    totalLessons: 14,
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    lessons: [],
    courses: [
      {
        courseCode: "base_mtt", title: "База MTT", passedLessons: 1, totalLessons: 7,
        modules: [{
          moduleCode: "preflop_open_raise_100bb", title: "Open Raise · 100 BB", passedLessons: 1, totalLessons: 7,
          lessons: [lesson("preflop_rfi_9max_100bb_utg", "UTG · Under the Gun", true), lesson("preflop_rfi_9max_100bb_ep", "UTG+1 · EP · Early Position", null)],
        }],
      },
      {
        courseCode: "solver_lab", title: "Solver Lab", passedLessons: 1, totalLessons: 7,
        modules: [{
          moduleCode: "preflop_rfi_9max_100bb", title: "RFI · 9-max · 100 BB", passedLessons: 1, totalLessons: 7,
          lessons: [lesson("solver_rfi_9max_100bb_co", "CO · Cutoff", true)],
        }],
      },
    ],
  }],
};

describe("/admin/academy", () => {
  it("(41) does not hardcode any course code", () => {
    const source = readFileSync(path.resolve(__dirname, "../page.tsx"), "utf8");
    expect(source).not.toContain("base_mtt");
    expect(source).not.toContain("solver_lab");
    expect(source).toContain("entry.courses.map");
  });

  it("(40)(42) renders База MTT unchanged and Solver Lab as its own grouped section", async () => {
    mocks.payload = payload;
    await act(async () => {
      root.render(<AdminAcademyPage />);
    });
    await act(async () => {});
    expect(container.textContent).toContain("2 из 14");
    const toggle = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Подробнее"))!;
    await act(async () => {
      toggle.click();
    });

    const sections = Array.from(container.querySelectorAll("section > div.border-t > div"));
    expect(sections).toHaveLength(2);
    const [base, solver] = sections;
    expect(base.textContent).toBe(
      "База MTT1 из 7Open Raise · 100 BB1 из 7✓ UTG · Under the Gun90% · 2 попытокUTG+1 · EP · Early PositionНе начат",
    );
    expect(solver.textContent).toBe("Solver Lab1 из 7RFI · 9-max · 100 BB1 из 7✓ CO · Cutoff90% · 2 попыток");
  });
});
