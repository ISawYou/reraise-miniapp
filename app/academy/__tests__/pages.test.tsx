import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademyProgressPayload } from "@/features/academy";

const mocks = vi.hoisted(() => ({
  progress: {
    data: null as AcademyProgressPayload | null,
    error: null as string | null,
    retry: () => {},
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  usePathname: () => "/academy",
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/academy/use-academy-progress", () => ({
  useAcademyProgress: () => mocks.progress,
}));

const { default: AcademyPage } = await import("@/app/academy/page");
const { default: AcademyPreflopPage } = await import("@/app/academy/preflop/page");
const { default: AcademyLessonPage } = await import("@/app/academy/preflop/[position]/page");
const { default: AcademyTrainingPage } = await import("@/app/academy/preflop/[position]/train/page");
const { ACADEMY_CATALOG, getPrimaryAcademyCourse } = await import("@/config/academy/catalog");
const { ACADEMY_PREFLOP_POSITIONS } = await import("@/lib/academy/preflop");

let container: HTMLDivElement;
let root: Root;

async function render(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
}

function hrefs() {
  return Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
}

function progressPayload(passedCodes: string[]): AcademyProgressPayload {
  const course = getPrimaryAcademyCourse();
  const lessons = passedCodes.map((lessonCode) => ({
    lessonCode,
    attemptsCount: 2,
    lastScorePercent: 90,
    bestScorePercent: 90,
    passed: true,
    firstCompletedAt: "2026-03-01T00:00:00.000Z",
    lastAttemptAt: "2026-03-01T00:00:00.000Z",
  }));
  const progressPercent = Math.round((passedCodes.length / 7) * 100);
  return {
    lessons,
    course: { passedLessons: passedCodes.length, totalLessons: 7, progressPercent },
    courseCode: course.code,
    modules: [{ moduleCode: course.modules[0].code, passedLessons: passedCodes.length, totalLessons: 7, progressPercent }],
  };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.progress = { data: null, error: null, retry: () => {} };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("/academy", () => {
  // Landing redesigned (product UX v3): four plain destinations instead of the
  // catalog course cards; База MTT progress is shown on "Новичкам".
  it("renders the four destinations with База MTT progress on Новичкам", async () => {
    mocks.progress = {
      ...mocks.progress,
      data: progressPayload(["preflop_rfi_9max_100bb_utg", "preflop_rfi_9max_100bb_ep"]),
    };
    await render(<AcademyPage />);
    const course = getPrimaryAcademyCourse();

    const destinations = Array.from(container.querySelectorAll("[data-destination]"));
    expect(destinations.map((node) => node.getAttribute("data-destination"))).toEqual(["beginner", "intermediate", "advanced", "trainers"]);
    const beginner = container.querySelector('[data-destination="beginner"]')!;
    expect(beginner.getAttribute("href")).toBe("/academy/beginner");
    expect(beginner.textContent).toContain("2 из 7 уроков");
    expect(course.code).toBe("base_mtt");
    expect(ACADEMY_CATALOG.length).toBe(2);
    expect(container.textContent).not.toContain("Позиции");
  });

  it("shows a loading state instead of a fake 0 before progress arrives", async () => {
    await render(<AcademyPage />);
    expect(container.textContent).toContain("Загрузка...");
    expect(container.textContent).not.toContain("0 из 7");
  });
});

describe("/academy/preflop", () => {
  it("still renders all seven lessons with their existing URLs and progress", async () => {
    mocks.progress = { ...mocks.progress, data: progressPayload(["preflop_rfi_9max_100bb_co"]) };
    await render(<AcademyPreflopPage />);

    const lessonHrefs = hrefs().filter((href) => href?.startsWith("/academy/preflop/"));
    expect(lessonHrefs).toEqual(
      ACADEMY_PREFLOP_POSITIONS.map((position) => `/academy/preflop/${position.toLowerCase()}`),
    );
    for (const label of ["UTG", "UTG+1", "MP", "LJ", "HJ", "CO", "BTN"]) {
      expect(container.textContent).toContain(label);
    }
    expect(container.textContent).toContain("EP · Early Position");
    expect(container.textContent).toContain("Пройдено · 90%");
    expect(container.textContent).toContain("1 из 7");
  });
});

describe("existing lesson URLs", () => {
  it.each(ACADEMY_PREFLOP_POSITIONS.map((p) => [p.toLowerCase(), p] as const))(
    "/academy/preflop/%s renders the lesson and links to its trainer",
    async (param, position) => {
      const element = await AcademyLessonPage({ params: Promise.resolve({ position: param }) });
      await render(element);
      expect(hrefs()).toContain(`/academy/preflop/${param}/train`);
      expect(container.textContent).toContain("Проверить себя");

      const training = await AcademyTrainingPage({ params: Promise.resolve({ position: param }) });
      expect(training.props).toMatchObject({ position });
    },
  );

  it("still accepts an upper-case position param", async () => {
    const element = await AcademyLessonPage({ params: Promise.resolve({ position: "UTG" }) });
    await render(element);
    expect(hrefs()).toContain("/academy/preflop/utg/train");
  });

  it("returns notFound for an unknown position", async () => {
    await expect(AcademyLessonPage({ params: Promise.resolve({ position: "sb" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND");
    await expect(AcademyTrainingPage({ params: Promise.resolve({ position: "sb" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND");
  });
});
