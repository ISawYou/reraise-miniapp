import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Server page access gate: this suite renders the pages as a FULL-access player
// (the gate itself is covered by components/academy/__tests__/academy-access-pages.test.tsx).
vi.mock("@/components/academy/academy-page-access-gate", () => ({
  AcademyPageAccessGate: ({ children }: { children: unknown }) => children,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/academy",
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest} onClick={(event) => event.preventDefault()}>{children}</a>
  ),
}));

vi.mock("@/components/academy/use-academy-progress", () => ({
  useAcademyProgress: () => ({ data: null, error: null, retry: () => {} }),
}));

const { default: TrainersPage } = await import("@/app/academy/trainers/page");
const { default: PreflopMixPage } = await import("@/app/academy/solver/preflop/mix/page");
const { PreflopQuickMix, preflopTrainerReviewEntry } = await import("@/components/academy/preflop-trainer");
const {
  TRAINING_SCENE_BOTTOM_NAV_CLEARANCE_PX,
  TRAINING_SCENE_CHROME_ABOVE_PX,
  TRAINING_SCENE_CHROME_BELOW_PX,
  TRAINING_SCENE_FIT_MAX_HEIGHT,
  TRAINING_SCENE_MIN_HEIGHT_PX,
  TRAINING_SCENE_RESERVED_PX,
  TRAINING_SCENE_TOP_SEAT_MARGIN_UNITS,
  trainingSceneFitLayout,
  trainingSceneTopSeatEdgeUnits,
} = await import("@/components/academy/poker-position-table");
const { ACADEMY_PREFLOP_QUICK_MIX_ROUTE } = await import("@/config/academy/preflop-trainer");
const { buildAcademyPreflopMixSession, } = await import("@/lib/academy/preflop-mix");
const { toPreflopTrainerReveal, toPublicPreflopTrainerQuestion } = await import("@/lib/academy/preflop-trainer");

const PLAYER_ID = "55555555-5555-4555-8555-555555555555";
const ATTEMPT_ID = "66666666-6666-4666-8666-666666666666";

let container: HTMLDivElement;
let root: Root;

async function render(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("element not found");
  await act(async () => {
    (element as HTMLElement).click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const $ = (selector: string) => container.querySelector<HTMLElement>(selector);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("SESSION_SECRET", "trainer-trust-ux-secret");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const session = () => buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
type Q = ReturnType<typeof session>[number];
const playedOther = (q: Q) => q.actions.map((a) => a.code).find((code) => code !== q.resolvedAction && (q.frequencies[code] ?? 0) > 0);
const zeroAction = (q: Q) => q.actions.map((a) => a.code).find((code) => (q.frequencies[code] ?? 0) === 0);

function stubMixApi(all: readonly Q[]) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({ url, body });
    const question = all[body.questionIndex as number];
    const payload = url.endsWith("/session")
      ? toPublicPreflopTrainerQuestion(question)
      : toPreflopTrainerReveal(question, body.selectedAction as string);
    return { ok: true, json: async () => payload } as Response;
  }));
  return requests;
}

describe("(7) 'Разобрать ошибки' holds only genuine mistakes", () => {
  it("a valid mixed answer (> 0%, ≠ randomizer) is excluded; a 0% answer is included", () => {
    const all = session();
    const mixedQuestion = all.find((q) => playedOther(q) !== undefined)!;
    const zeroQuestion = all.find((q) => zeroAction(q) !== undefined)!;
    expect(preflopTrainerReviewEntry(toPreflopTrainerReveal(mixedQuestion, playedOther(mixedQuestion)!))).toBeNull();
    expect(preflopTrainerReviewEntry(toPreflopTrainerReveal(mixedQuestion, mixedQuestion.resolvedAction))).toBeNull();
    const entry = preflopTrainerReviewEntry(toPreflopTrainerReveal(zeroQuestion, zeroAction(zeroQuestion)!))!;
    expect(entry).toMatchObject({ tone: "incorrect", verdict: "Не входит в стратегию", expectedLabel: "Стратегия" });
    expect(entry.expectedAnswer).toMatch(/— \d+%|— <1%|— >99%/);
  });

  it("the review trusts the SERVER outcome, not a client-side comparison", () => {
    const q = session().find((candidate) => playedOther(candidate) !== undefined)!;
    const reveal = toPreflopTrainerReveal(q, playedOther(q)!);
    expect(preflopTrainerReviewEntry({ ...reveal, outcome: "NOT_IN_STRATEGY", countsAsCorrect: false })).not.toBeNull();
  });
});

describe("(11)(12) compact feedback + always-reachable next step", () => {
  it("after answering, the CTA is rendered, enabled and sticky above the bottom nav; the scoring rules sit behind 'Как считается оценка?'", async () => {
    const all = session();
    stubMixApi(all);
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    await render(<PreflopQuickMix />);
    const first = all[0];
    // Before answering: no randomizer, no frequencies, no next step.
    expect(container.textContent).not.toMatch(/Рандомайзер|рандомайзер|%/);
    expect($('[data-testid="trainer-next"]')).toBeNull();

    await click($(`button[data-action-code="${playedOther(first) ?? first.resolvedAction}"]`));
    const next = $('[data-testid="trainer-next"]')!;
    expect(next).not.toBeNull();
    expect(next.tagName).toBe("BUTTON");
    expect(next.hasAttribute("disabled")).toBe(false);
    expect(next.hidden).toBe(false);
    expect(next.textContent).toBe("Следующая рука");
    const bar = $('[data-testid="trainer-next-bar"]')!;
    expect(bar.contains(next)).toBe(true);
    expect(bar.className).toContain("sticky");
    expect(bar.style.bottom).toContain("safe-area-inset-bottom");
    // The CTA follows the feedback in the DOM (never covered by it) and the feedback is scrolled into view.
    const feedback = $("[data-feedback-tone]")!;
    expect(feedback.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalled();

    // Compact verdict: short summary; the scoring rules sit behind ONE collapsed disclosure.
    expect($('[data-testid="feedback-summary"]')!.textContent!.length).toBeLessThan(140);
    const more = $('[data-testid="scoring-help-toggle"]')!;
    expect(more.textContent).toBe("Как считается оценка?");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect($('[data-testid="scoring-help"]')).toBeNull();
    await click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const help = $('[data-testid="scoring-help"]')!;
    expect(help.id).toBe(more.getAttribute("aria-controls"));
    expect(help.textContent).toContain("+0.5");
    // Expanding the help never removes the CTA.
    expect($('[data-testid="trainer-next"]')).not.toBeNull();

    // Frequencies are the primary feedback: every button shows its share after the answer.
    for (const button of Array.from(container.querySelectorAll<HTMLElement>("button[data-action-code]"))) {
      expect(button.querySelector('[data-testid="action-frequency"]')?.textContent).toMatch(/%$/);
    }

    // (Part 4) Next hand starts at the top of the page.
    scrollTo.mockClear();
    await click(next);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  it("a 0% answer is the only red state; a valid mixed answer is styled as accepted", async () => {
    const all = session();
    const index = all.findIndex((q) => zeroAction(q) !== undefined);
    stubMixApi(all.map((q, i) => (i === 0 ? all[index] : q)));
    await render(<PreflopQuickMix />);
    const q = all[index];
    await click($(`button[data-action-code="${zeroAction(q)}"]`));
    expect($("[data-feedback-tone]")!.getAttribute("data-feedback-tone")).toBe("incorrect");
    expect($('[data-testid="feedback-title"]')!.textContent).toBe("Не входит в стратегию");
    expect($(`button[data-action-code="${zeroAction(q)}"]`)!.getAttribute("data-action-selected")).toBe("incorrect");
    expect($('[data-testid="trainer-next"]')).not.toBeNull();
  });
});

describe("(13) TRAINING_SCENE respects the visible safe area", () => {
  const CONTENT_WIDTH_390 = 390 - 2 * 16 + 2 * 4; // px-4 gutters, -mx-1 scene bleed

  it("geometry: every seat plate keeps a margin from the scene's top edge", () => {
    expect(trainingSceneTopSeatEdgeUnits()).toBeGreaterThanOrEqual(TRAINING_SCENE_TOP_SEAT_MARGIN_UNITS);
  });

  it("the CSS max-height literal matches the layout model's constants exactly (no drift)", () => {
    expect(TRAINING_SCENE_RESERVED_PX).toBe(TRAINING_SCENE_CHROME_ABOVE_PX + TRAINING_SCENE_CHROME_BELOW_PX + TRAINING_SCENE_BOTTOM_NAV_CLEARANCE_PX);
    expect(TRAINING_SCENE_FIT_MAX_HEIGHT).toBe(
      `max(${TRAINING_SCENE_MIN_HEIGHT_PX}px, calc(var(--tg-viewport-stable-height, 100dvh) - var(--app-top-offset, 0px) - env(safe-area-inset-bottom, 0px) - ${TRAINING_SCENE_RESERVED_PX}px))`,
    );
  });

  it.each([
    ["390×844, browser", 844, 0, 0],
    ["390×844, Telegram fullscreen (status bar + close bar ≈ 91px, home bar 34px)", 844, 91, 34],
    ["390×700, browser", 700, 0, 0],
    ["390×700, Telegram fullscreen", 700, 91, 34],
  ] as const)("%s: top seats sit below the Telegram top chrome and the trainer top bar", (_name, viewportHeight, topInset, bottomInset) => {
    const layout = trainingSceneFitLayout({ viewportHeight, topInset, bottomInset, contentWidth: CONTENT_WIDTH_390 });
    expect(layout.topSeatTop).toBeGreaterThanOrEqual(topInset + TRAINING_SCENE_CHROME_ABOVE_PX);
    expect(layout.height).toBeGreaterThanOrEqual(TRAINING_SCENE_MIN_HEIGHT_PX);
  });

  it("stays large: unconstrained at 390×844 in a browser; the whole decision fits above the bottom nav at 844 (fullscreen) and 700 (browser)", () => {
    const natural = (CONTENT_WIDTH_390 * 384) / 360;
    expect(trainingSceneFitLayout({ viewportHeight: 844, topInset: 0, contentWidth: CONTENT_WIDTH_390 }).height).toBeCloseTo(natural, 5);
    for (const [viewportHeight, topInset, bottomInset] of [[844, 0, 0], [844, 91, 34], [700, 0, 0]] as const) {
      const layout = trainingSceneFitLayout({ viewportHeight, topInset, bottomInset, contentWidth: CONTENT_WIDTH_390 });
      expect(layout.buttonsBottom, `${viewportHeight}/${topInset}`).toBeLessThanOrEqual(layout.bottomNavTop);
      expect(layout.height / natural, `${viewportHeight}/${topInset}`).toBeGreaterThan(0.9);
    }
  });

  it("the session scene is rendered with the viewport-fit max-height (Telegram top offset + safe area aware)", async () => {
    stubMixApi(session());
    await render(<PreflopQuickMix />);
    expect($('[data-scene-fit="viewport"]')).not.toBeNull();
    const svg = $('[data-table-mode="TRAINING_SCENE"] svg')!;
    expect(svg.getAttribute("style")).toContain("--app-top-offset");
    expect(svg.getAttribute("style")).toContain("safe-area-inset-bottom");
    expect(svg.getAttribute("style")).toContain(`${TRAINING_SCENE_MIN_HEIGHT_PX}px`);
  });
});

describe("(14)(15) Тренажёры → Quick Mix starts directly", () => {
  it("the Quick Mix card is one link straight to the running session route; whole cards are tappable", async () => {
    await render(TrainersPage());
    const quick = $('[data-trainer-entry="quick-mix"]')!;
    expect(quick.tagName).toBe("A");
    expect(quick.getAttribute("href")).toBe(ACADEMY_PREFLOP_QUICK_MIX_ROUTE);
    expect(quick.textContent).toContain("10 раздач из разных ситуаций");
    expect(quick.textContent).toContain("Начать");
    for (const card of Array.from(container.querySelectorAll("[data-trainer-entry],[data-training-preset]"))) expect(card.tagName).toBe("A");
    expect(container.querySelectorAll("[data-trainer-entry]")).toHaveLength(3);
    expect($('[data-testid="push-fold-attribution"]')?.textContent).toContain("Данные Push/Fold: HoldemMath · CC BY 4.0");
    // v2: three tiers, each short. Quick start stays a one-glance card; every
    // ready-made card is one line of copy + fact chips; the manual tier is brief.
    expect((container.querySelector('[data-trainers-tier="quick"]')?.textContent ?? "").length).toBeLessThan(80);
    for (const card of Array.from(container.querySelectorAll("[data-training-preset]"))) {
      expect((card.textContent ?? "").length, card.getAttribute("data-training-preset")!).toBeLessThan(110);
    }
    expect((container.querySelector('[data-trainers-tier="manual"]')?.textContent ?? "").length).toBeLessThan(200);
  });

  it("that route IS the session: the first question is requested on arrival, with no intermediate start step", async () => {
    const requests = stubMixApi(session());
    await render(<PreflopMixPage />);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/academy/solver/preflop/mix/session");
    expect(container.querySelectorAll("button[data-action-code]").length).toBeGreaterThanOrEqual(2);
    expect(Array.from(container.querySelectorAll("a,button")).map((element) => element.textContent)).not.toContain("Начать");
  });
});
