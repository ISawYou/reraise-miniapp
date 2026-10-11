import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademyProgressPayload, AcademyProgressResponse } from "@/features/academy";

const mocks = vi.hoisted(() => ({
  progress: {
    data: null as AcademyProgressResponse | null,
    error: null as string | null,
    retry: () => {},
  },
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/academy",
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/academy/use-academy-progress", () => ({
  useAcademyProgress: () => mocks.progress,
}));

const { default: AcademyPage } = await import("@/app/academy/page");
const { default: SolverModulePage } = await import("@/app/academy/solver/rfi/100bb/page");
const { default: SolverLessonPage } = await import("@/app/academy/solver/rfi/100bb/[position]/page");
const { default: SolverTrainingPage } = await import("@/app/academy/solver/rfi/100bb/[position]/train/page");
const { ACADEMY_PREFLOP_POSITIONS } = await import("@/lib/academy/preflop");

let container: HTMLDivElement;
let root: Root;

async function render(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
}

function hrefs() {
  return Array.from(container.querySelectorAll("a")).map((link) => link.getAttribute("href"));
}

function coursePayload(courseCode: string, passedCodes: string[], total = 7): AcademyProgressPayload {
  const passedLessons = passedCodes.length;
  return {
    courseCode,
    lessons: passedCodes.map((lessonCode) => ({
      lessonCode,
      attemptsCount: 1,
      lastScorePercent: 90,
      bestScorePercent: 90,
      passed: true,
      firstCompletedAt: "2026-01-01T00:00:00.000Z",
      lastAttemptAt: "2026-01-01T00:00:00.000Z",
    })),
    course: { passedLessons, totalLessons: total, progressPercent: Math.round((passedLessons / total) * 100) },
    modules: [],
  };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.progress = { data: null, error: null, retry: () => {} };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("/academy with two courses", () => {
  // Landing redesigned (product UX v3): each course's progress now shows on
  // the destination that presents it — База MTT on "Новичкам", Solver Lab on
  // "Продолжающим" — still read from that course's OWN payload.
  it("renders each learning destination with its OWN course progress", async () => {
    const base = coursePayload("base_mtt", ["preflop_rfi_9max_100bb_utg", "preflop_rfi_9max_100bb_ep"]);
    const solver = coursePayload("solver_lab", ["solver_rfi_9max_100bb_btn"]);
    mocks.progress = { ...mocks.progress, data: { ...base, courses: [base, solver] } };
    await render(<AcademyPage />);

    const beginner = container.querySelector('[data-destination="beginner"]')!;
    const intermediate = container.querySelector('[data-destination="intermediate"]')!;
    expect(beginner.textContent).toContain("2 из 7 уроков");
    expect(intermediate.textContent).toContain("1 из 7 уроков");
    expect(intermediate.textContent).not.toContain("2 из 7");
    expect(hrefs()).toContain("/academy/intermediate");
  });

  it("never shows База MTT numbers on Продолжающим for a legacy-shaped payload", async () => {
    mocks.progress = { ...mocks.progress, data: coursePayload("base_mtt", ["preflop_rfi_9max_100bb_utg"]) };
    await render(<AcademyPage />);
    const intermediate = container.querySelector('[data-destination="intermediate"]')!;
    expect(intermediate.textContent).not.toContain("1 из 7");
    expect(container.querySelector('[data-destination="beginner"]')!.textContent).toContain("1 из 7");
  });
});

describe("/academy/solver/rfi/100bb", () => {
  it("lists the seven Solver Lab lessons with Solver Lab progress", async () => {
    const base = coursePayload("base_mtt", ["preflop_rfi_9max_100bb_utg", "preflop_rfi_9max_100bb_ep"]);
    const solver = coursePayload("solver_lab", ["solver_rfi_9max_100bb_co"]);
    mocks.progress = { ...mocks.progress, data: { ...base, courses: [base, solver] } };
    await render(<SolverModulePage />);

    expect(hrefs().filter((href) => href?.startsWith("/academy/solver/rfi/100bb/"))).toEqual(
      ACADEMY_PREFLOP_POSITIONS.map((position) => `/academy/solver/rfi/100bb/${position.toLowerCase()}`),
    );
    expect(container.textContent).toContain("1 из 7");
    expect(container.textContent).toContain("Пройдено · 90%");
    expect(container.textContent).not.toContain("2 из 7");
  });
});

describe("/academy/solver/rfi/100bb/[position]", () => {
  it.each(ACADEMY_PREFLOP_POSITIONS.map((p) => [p.toLowerCase(), p] as const))(
    "%s renders the frequency grid and links to its trainer",
    async (param, position) => {
      await render(await SolverLessonPage({ params: Promise.resolve({ position: param }) }));
      expect(container.querySelectorAll('[role="gridcell"]')).toHaveLength(169);
      expect(hrefs()).toContain(`/academy/solver/rfi/100bb/${param}/train`);
      expect(container.textContent).toContain("hrc_scenario_b_rfi_9max_100bb_v1");
      expect(container.textContent).not.toMatch(/\bEV\b|GTO/);

      const training = await SolverTrainingPage({ params: Promise.resolve({ position: param }) });
      expect(training.props).toMatchObject({ position });
    },
  );

  it("returns notFound for an unknown position", async () => {
    await expect(SolverLessonPage({ params: Promise.resolve({ position: "sb" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(SolverTrainingPage({ params: Promise.resolve({ position: "sb" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
