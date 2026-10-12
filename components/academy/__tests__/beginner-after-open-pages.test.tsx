import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademyProgressPayload } from "@/features/academy";

const mocks = vi.hoisted(() => ({
  progress: { data: null as AcademyProgressPayload | null, error: null as string | null, retry: () => {} },
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/academy/beginner",
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest} onClick={(event) => event.preventDefault()}>{children}</a>
  ),
}));

vi.mock("@/components/academy/use-academy-progress", () => ({
  useAcademyProgress: () => mocks.progress,
}));

const { default: BeginnerPage } = await import("@/app/academy/beginner/page");
const { default: LessonPage, generateStaticParams } = await import("@/app/academy/beginner/after-open/[lesson]/page");
const { ACADEMY_BEGINNER_AFTER_OPEN_LESSONS, ACADEMY_BEGINNER_TERMS, beginnerAfterOpenLessonRoute } = await import("@/config/academy/beginner-after-open");
const { getPrimaryAcademyCourse } = await import("@/config/academy/catalog");
const { preflopTrainerTrainRoute } = await import("@/config/academy/preflop-trainer");
const { academyTrainingPresetForLesson } = await import("@/config/academy/training-presets");
const { ACADEMY_PREFLOP_POSITIONS } = await import("@/lib/academy/preflop");
const { formatSizingBb, formatSizingBbLabel } = await import("@/lib/academy/preflop-sizing");
const { getPreflopTrainerSpotHandState, requireAcademyPreflopTrainerSpotByStack } = await import("@/lib/academy/preflop-trainer");

let container: HTMLDivElement;
let root: Root;

async function render(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
}

const $ = (selector: string) => container.querySelector(selector);
const $$ = (selector: string) => Array.from(container.querySelectorAll<HTMLElement>(selector));
const lessonPage = (slug: string) => LessonPage({ params: Promise.resolve({ lesson: slug }) });

/** Navigation-level jargon a beginner should never have to decode. */
const JARGON = /\bRFI\b|Solver|солвер|нод[аы]|\bnode\b|\bHRC\b|\bGTO\b|\bMTT\b|База MTT|mixed|\bIP\b|\bOOP\b|модул/i;

function completedSeven(): AcademyProgressPayload {
  const course = getPrimaryAcademyCourse();
  const codes = course.modules[0].lessons.map((lesson) => lesson.code);
  return {
    lessons: codes.map((lessonCode) => ({
      lessonCode, attemptsCount: 1, lastScorePercent: 100, bestScorePercent: 100, passed: true,
      firstCompletedAt: "2026-03-01T00:00:00.000Z", lastAttemptAt: "2026-03-01T00:00:00.000Z",
    })),
    course: { passedLessons: 7, totalLessons: 7, progressPercent: 100 },
    courseCode: course.code,
    modules: [{ moduleCode: course.modules[0].code, passedLessons: 7, totalLessons: 7, progressPercent: 100 }],
  };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.progress.data = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("/academy/beginner: Шаг 1 / Шаг 2", () => {
  it("shows the existing openings block as Step 1 and the new block as Step 2, in that order", async () => {
    await render(<BeginnerPage />);
    const step1 = $('[data-beginner-step="1"]')!;
    const step2 = $('[data-beginner-step="2"]')!;
    expect(step1.textContent).toContain("Шаг 1");
    expect(step1.textContent).toContain("Научись открываться");
    expect(step2.textContent).toContain("Шаг 2");
    expect(step2.textContent).toContain("Научись играть после чужого действия");
    expect(step1.compareDocumentPosition(step2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Step 1 = exactly the 7 existing lessons at their existing URLs.
    expect(Array.from(step1.querySelectorAll("a")).map((link) => link.getAttribute("href"))).toEqual(
      ACADEMY_PREFLOP_POSITIONS.map((position) => `/academy/preflop/${position.toLowerCase()}`));
    // Step 2 = the 5 new lessons, nowhere under /academy/preflop/.
    expect($$("[data-after-open-lesson]").map((link) => link.getAttribute("href"))).toEqual(
      ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.map((lesson) => beginnerAfterOpenLessonRoute(lesson.slug)));
    expect(step2.querySelectorAll('a[href^="/academy/preflop/"]')).toHaveLength(0);
    expect($$("[data-beginner-step-link]").map((link) => link.getAttribute("href"))).toEqual(["#step-1", "#step-2"]);
    for (const title of ["Малый блайнд", "Защита большого блайнда", "Малый блайнд против рейза", "Когда делать 3-бет", "Что делать против 3-бета"]) {
      expect(step2.textContent).toContain(title);
    }
  });

  it("a player who completed the 7 opening lessons still sees 7 из 7 / 100% on Step 1", async () => {
    mocks.progress.data = completedSeven();
    await render(<BeginnerPage />);
    const step1 = $('[data-beginner-step="1"]')!;
    expect(step1.textContent).toContain("7 из 7");
    expect(step1.textContent).toContain("100%");
    expect(step1.textContent!.match(/Пройдено/g)).toHaveLength(7);
    // v2: Step 2 has its OWN real counter (per-spot practice progress), fed only by
    // `spots` — the 7 opening lessons never leak into it (0 из 5, nothing passed).
    const step2 = $('[data-beginner-step="2"]')!;
    expect(step2.querySelector('[data-testid="step-two-progress"]')!.textContent).toContain("0 из 5");
    expect(step2.textContent).not.toMatch(/7 из|Пройдено/);
  });

  it("no solver / architecture jargon at the selection level", async () => {
    await render(<BeginnerPage />);
    const main = container.textContent!;
    expect(main).not.toMatch(JARGON);
  });
});

describe("Шаг 2 lesson pages", () => {
  it("one static page per lesson; unknown slugs are not found", async () => {
    expect(generateStaticParams()).toEqual(ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.map((lesson) => ({ lesson: lesson.slug })));
    await expect(lessonPage("open-from-bb")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.map((lesson) => [lesson.slug, lesson] as const))(
    "%s: realistic table, trusted facts, Потренироваться → the lesson's own preset on that node's trainer, real range grid, glossary",
    async (_slug, lesson) => {
      await render(await lessonPage(lesson.slug));
      const { spot } = requireAcademyPreflopTrainerSpotByStack(lesson.spot.stackBb, lesson.spot.nodeKey);
      const state = getPreflopTrainerSpotHandState(spot)!;
      // Realistic (ADVANCED) table with the trusted money model.
      const table = $('[data-testid="lesson-table"] [data-table-mode="TRAINING_SCENE"]')!;
      expect(table).not.toBeNull();
      expect(table.querySelector(`[data-table-seat="${spot.heroPosition}"]`)?.getAttribute("aria-label")).toBe(`${spot.heroPosition}, ты`);
      expect(table.querySelector('[data-seat-bet="SB"]')?.getAttribute("data-committed-bb")).toBe(String(state.committedBb.SB));
      expect(table.querySelector('[data-seat-bet="BB"]')?.getAttribute("data-committed-bb")).toBe(String(state.committedBb.BB));
      expect(table.querySelector(`[data-seat-stack="${spot.heroPosition}"]`)).not.toBeNull();
      // Conservative ante: the MTT reference ante is ambiguous → pot without ante + separate ante label.
      expect(table.querySelector("[data-table-pot]")?.getAttribute("data-table-pot")).toBe("WITHOUT_ANTE");
      expect(table.querySelector("[data-ante-note]")).not.toBeNull();
      // v2 CTA = the lesson's OWN ready-made training: the exact node's existing trainer
      // route + `?preset=<id>&from=lesson` (header + "К уроку" back link only), above the grid.
      const practice = $('[data-testid="lesson-practice"]')!;
      expect(practice.textContent).toBe("Потренироваться");
      const preset = academyTrainingPresetForLesson(lesson.slug)!;
      expect(preset.lessonSlug).toBe(lesson.slug);
      expect([preset.stackBb, preset.nodeKey]).toEqual([lesson.spot.stackBb, lesson.spot.nodeKey]);
      expect(practice.getAttribute("data-practice-preset")).toBe(preset.id);
      expect(practice.getAttribute("href")).toBe(
        `${preflopTrainerTrainRoute(lesson.spot.stackBb, lesson.spot.nodeKey)}?preset=${preset.id}&from=lesson`);
      expect(practice.getAttribute("href")).not.toBe("/academy/trainers");
      const grid = $('[data-testid="range-view"]')!;
      expect(practice.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(grid.textContent).toContain("Какие руки так играем");
      expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(169);
      expect($('[data-testid="lesson-study"]')!.textContent).toContain("Посмотреть диапазон");
      // Inline glossary, no jargon in the plain copy.
      const terms = $$("[data-term]");
      expect(terms.length).toBeGreaterThan(0);
      for (const term of terms) expect(term.textContent).toBe(ACADEMY_BEGINNER_TERMS[term.dataset.term as keyof typeof ACADEMY_BEGINNER_TERMS]);
      expect($('[data-testid="lesson-lead"]')!.textContent).not.toMatch(JARGON);
      expect($('[data-testid="lesson-text"]')!.textContent).not.toMatch(JARGON);
      // The practice CTA comes right after the lead paragraph, before the detailed text.
      expect(practice.compareDocumentPosition($('[data-testid="lesson-text"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect($("main")!.getAttribute("data-beginner-lesson")).toBe(lesson.code);
    },
  );

  it("SB first-in: hero stack + open size in facts; LIMP legend appears iff the real node has LIMP", async () => {
    await render(await lessonPage("sb-first-in"));
    const resolved = requireAcademyPreflopTrainerSpotByStack(40, "RFI_SB");
    const state = getPreflopTrainerSpotHandState(resolved.spot)!;
    expect($('[data-fact="HERO_RAISE"]')!.textContent).toContain(formatSizingBbLabel(state.heroRaise!.totalBb));
    expect($('[data-fact="HERO_STACK"]')!.textContent).toContain(formatSizingBbLabel(state.heroRemainingBb));
    expect(Boolean($('[data-legend-action="LIMP"]'))).toBe(resolved.node.actionCodes.includes("LIMP"));
    expect(Boolean($('[data-term="LIMP"]'))).toBe(resolved.node.actionCodes.includes("LIMP"));
  });

  it("BB defence: forced 1 BB and the call amount are visible", async () => {
    await render(await lessonPage("bb-defence"));
    const state = getPreflopTrainerSpotHandState(requireAcademyPreflopTrainerSpotByStack(40, "FACING_OPEN_BB_VS_BTN").spot)!;
    expect($('[data-fact="HERO_IN"]')!.textContent).toContain(formatSizingBbLabel(1));
    expect($('[data-fact="TO_CALL"]')!.textContent).toContain(formatSizingBbLabel(state.toCallBb));
    expect($('[data-seat-bet="BB"]')!.getAttribute("aria-label")).toBe(`BB: ${formatSizingBb(1)} BB`);
    expect($('[data-testid="lesson-compare"]')!.getAttribute("href")).toBe("/academy/solver/preflop/40/facing_open_bb_vs_utg");
  });

  it("facing a 3-bet: both contributions drawn, pot shown as 'X BB + анте' (ante never added)", async () => {
    await render(await lessonPage("facing-three-bet"));
    const state = getPreflopTrainerSpotHandState(requireAcademyPreflopTrainerSpotByStack(40, "FACING_3BET_CO_VS_BTN").spot)!;
    expect($('[data-seat-bet="CO"]')!.getAttribute("data-committed-bb")).toBe(String(state.heroCommittedBb));
    expect($('[data-seat-bet="BTN"]')!.getAttribute("data-committed-bb")).toBe(String(state.villainCommittedBb));
    const pot = $('[data-table-pot]')!;
    expect($('[data-fact="POT"]')!.textContent).toBe(`Банк${formatSizingBbLabel(Number(pot.getAttribute("data-pot-bb")))} + анте`);
    expect(pot.getAttribute("data-table-pot")).toBe("WITHOUT_ANTE");
    expect(pot.textContent).toContain("+ анте");
  });
});
