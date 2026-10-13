/**
 * Post-answer strategy range in the normal preflop trainer (fixed node +
 * Quick Mix): compact verdict, the REAL 13x13 range of the answered node with
 * the dealt hand gold-ringed, tap-to-inspect, collapsed scoring help.
 * Payloads go through a JSON round-trip, like the real network.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademyStrategyNodeHands, StartingHandClass } from "@/types/academy";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/academy/solver/preflop",
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/academy/use-academy-progress", () => ({
  useAcademyProgress: () => ({ data: null, error: null, retry: () => {} }),
}));

const { PreflopTrainer, PreflopQuickMix } = await import("@/components/academy/preflop-trainer");
const { StrategyRangeReveal } = await import("@/components/academy/strategy-range-reveal");
const {
  SolverActionMixGrid,
  SOLVER_GRID_DEALT_RING_CLASS,
  SOLVER_GRID_INSPECTED_RING_CLASS,
  solverActionMixColor,
} = await import("@/components/academy/SolverActionMixGrid");
const {
  buildAcademyPreflopTrainerSession,
  getPreflopTrainerPublicActions,
  requireAcademyPreflopTrainerSpot,
  toPreflopTrainerReveal,
  toPublicPreflopTrainerQuestion,
} = await import("@/lib/academy/preflop-trainer");
const { buildAcademyPreflopMixSession } = await import("@/lib/academy/preflop-mix");
const { CANONICAL_STARTING_HANDS } = await import("@/lib/academy/preflop");
const { renderStartingHand } = await import("@/lib/academy/training");

const PLAYER_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const UTG_20 = { datasetId: "external_mtt_preflop_9max_20bb_v1", nodeKey: "RFI_UTG", stackBb: 20 };
const BB_VS_BTN_20 = { datasetId: "external_mtt_preflop_9max_20bb_v1", nodeKey: "FACING_OPEN_BB_VS_BTN", stackBb: 20 };

let container: HTMLDivElement;
let root: Root;
let scrollIntoView: ReturnType<typeof vi.fn>;

const $ = (selector: string) => container.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => Array.from(container.querySelectorAll<HTMLElement>(selector));
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function render(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("SESSION_SECRET", "answer-range-ui-secret");
  vi.stubGlobal("scrollTo", vi.fn());
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element["scrollIntoView"];
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

type SessionQuestion = ReturnType<typeof buildAcademyPreflopTrainerSession>[number];

/** A real session question of `selection`, re-dealt to `hand` with that node's real frequencies. */
function questionFor(selection: typeof UTG_20, hand: StartingHandClass): SessionQuestion {
  const [first] = buildAcademyPreflopTrainerSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID, ...selection });
  return { ...first, hand, renderedCards: renderStartingHand(hand, () => 0.42), frequencies: first.rangeHands[hand] };
}

/** Stubs the trainer API: every session / reveal answers from `questions[questionIndex]`. */
function stubApi(questions: readonly SessionQuestion[]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const question = questions[body.questionIndex as number];
    const payload = url.endsWith("/session")
      ? toPublicPreflopTrainerQuestion(question)
      : toPreflopTrainerReveal(question, body.selectedAction as string);
    return { ok: true, json: async () => json(payload) } as Response;
  }));
}

function cell(hand: string) {
  return $(`[data-testid="answer-range"] [data-hand="${hand}"]`)!;
}

function mixOf(hands: AcademyStrategyNodeHands, codes: readonly string[], hand: StartingHandClass) {
  return codes.map((code) => `${code}:${hands[hand]?.[code] ?? 0}`).join(",");
}

describe("before answering: no range anywhere in the DOM", () => {
  it("the question screen renders no grid, no frequencies, no inspector", async () => {
    stubApi([questionFor(UTG_20, "55")]);
    await render(<PreflopTrainer selection={UTG_20} />);
    expect($("button[data-action-code]")).not.toBeNull();
    expect($('[data-testid="answer-range"]')).toBeNull();
    expect($("[data-hand]")).toBeNull();
    expect(container.textContent).not.toMatch(/%|Диапазон этого спота/);
  });
});

describe("QA1 screenshot case: UTG 20 BB, 55 = фолд 83% / рейз 17%, player picks рейз", () => {
  it("compact '+0.5' verdict, then the full exact UTG range with 55 gold-ringed and inspected by default", async () => {
    const question = questionFor(UTG_20, "55");
    expect(question.frequencies).toEqual({ RAISE: 0.17, FOLD: 0.83 });
    stubApi([question]);
    await render(<PreflopTrainer selection={UTG_20} />);
    await click($('button[data-action-code="RAISE"]')!);

    // Verdict copy.
    expect($('[data-testid="feedback-title"]')!.textContent).toBe("Допустимое решение");
    expect($('[data-testid="feedback-points"]')!.textContent).toBe("+0.5");
    expect($('[data-testid="feedback-hand"]')!.textContent).toBe("55");
    expect($('[data-testid="feedback-frequencies"]')!.textContent).toBe("Фолд — 83% · Рейз — 17%");
    expect($('[data-testid="feedback-summary"]')!.textContent).toBe("Основное решение — фолд. Рейз здесь тоже входит в стратегию.");
    // No giant generic paragraph and no randomizer by default.
    const verdict = $("[data-feedback-tone]")!;
    expect(verdict.textContent!.length).toBeLessThan(160);
    expect(container.textContent).not.toMatch(/рандомайзер|Это смешанная рука|0\.5 очка/i);
    expect($('[data-testid="scoring-help"]')).toBeNull();

    // Range header from the existing spot copy — no technical ids.
    const range = $('[data-testid="answer-range"]')!;
    expect(range.querySelector("h2")!.textContent).toBe("Диапазон этого спота");
    expect($('[data-testid="answer-range-spot"]')!.textContent).toBe("UTG · первый вход · 20 BB");
    expect(range.textContent).not.toMatch(/RFI_UTG|external_mtt|_v1/);

    // Exactly 169 canonical cells, real frequencies of THIS node.
    const node = requireAcademyPreflopTrainerSpot(UTG_20.datasetId, UTG_20.nodeKey).node;
    const cells = $$('[data-testid="answer-range"] [data-hand]');
    expect(cells.map((element) => element.dataset.hand)).toEqual([...CANONICAL_STARTING_HANDS]);
    for (const element of cells) {
      expect(element.dataset.mix).toBe(mixOf(node.hands, node.actionCodes, element.dataset.hand as StartingHandClass));
    }

    // Dealt hand: gold ring over the unchanged fill, default inspected hand.
    const dealt = cell("55");
    expect(dealt.dataset.dealt).toBe("true");
    expect(dealt.className).toContain(SOLVER_GRID_DEALT_RING_CLASS);
    expect(dealt.style.backgroundImage).toContain("linear-gradient");
    expect($$("[data-dealt]")).toHaveLength(1);
    expect(dealt.dataset.inspected).toBe("true");
    expect(dealt.className).not.toContain(SOLVER_GRID_INSPECTED_RING_CLASS); // one gold marker suffices
    expect($('[data-testid="range-inspector-hand"]')!.textContent).toBe("55");
    expect($('[data-testid="range-inspector-frequencies"]')!.textContent).toBe("Рейз — 17% · Фолд — 83%");
    expect($('[data-testid="answer-range-dealt-legend"]')!.textContent).toContain("Золотая рамка — твоя рука");

    // Interactive inspection: 66 then 44 with their real values; 55 stays gold.
    await click(cell("66"));
    expect($('[data-testid="range-inspector-hand"]')!.textContent).toBe("66");
    expect($('[data-testid="range-inspector-frequencies"]')!.textContent).toBe("Рейз — 100%"); // 0% fold omitted
    expect(cell("66").dataset.inspected).toBe("true");
    expect(cell("66").className).toContain(SOLVER_GRID_INSPECTED_RING_CLASS);
    expect(cell("66").getAttribute("aria-pressed")).toBe("true");
    expect(cell("55").dataset.dealt).toBe("true");
    expect(cell("55").className).toContain(SOLVER_GRID_DEALT_RING_CLASS);
    expect(cell("55").getAttribute("aria-pressed")).toBe("false");
    await click(cell("44"));
    const expected44 = [["Рейз", node.hands["44"].RAISE], ["Фолд", node.hands["44"].FOLD]]
      .filter(([, frequency]) => (frequency as number) > 0)
      .map(([label, frequency]) => `${label} — ${Math.round((frequency as number) * 100)}%`).join(" · ");
    expect($('[data-testid="range-inspector-frequencies"]')!.textContent).toBe(expected44);
    expect($$("[data-inspected]")).toHaveLength(1);
    // Back to the dealt hand.
    await click($('[data-testid="range-inspector-reset"]')!);
    expect($('[data-testid="range-inspector-hand"]')!.textContent).toBe("55");
    expect($('[data-testid="range-inspector-reset"]')).toBeNull();
  });

  it("QA2: same hand, picking фолд → 'Верно' +1 with the same range data", async () => {
    stubApi([questionFor(UTG_20, "55")]);
    await render(<PreflopTrainer selection={UTG_20} />);
    await click($('button[data-action-code="FOLD"]')!);
    expect($('[data-testid="feedback-title"]')!.textContent).toBe("Верно");
    expect($('[data-testid="feedback-points"]')!.textContent).toBe("+1");
    expect($('[data-testid="feedback-summary"]')!.textContent).toBe("Основное решение — фолд.");
    expect(cell("55").dataset.mix).toBe("RAISE:0.17,FOLD:0.83");
    expect($$('[data-testid="answer-range"] [data-hand]')).toHaveLength(169);
  });

  it("layout order: action buttons → verdict → range (inspector inside) → sticky next; scroll lands on the verdict, not the range end", async () => {
    stubApi([questionFor(UTG_20, "55")]);
    await render(<PreflopTrainer selection={UTG_20} />);
    await click($('button[data-action-code="RAISE"]')!);
    const buttons = $("[data-action-count]")!;
    const verdict = $("[data-feedback-tone]")!;
    const range = $('[data-testid="answer-range"]')!;
    const bar = $('[data-testid="trainer-next-bar"]')!;
    expect(buttons.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(verdict.nextElementSibling).toBe(range);
    expect(range.nextElementSibling).toBe(bar);
    expect(range.contains($('[data-testid="range-inspector"]'))).toBe(true);
    expect(bar.className).toContain("sticky");
    expect(bar.style.bottom).toContain("safe-area-inset-bottom");
    expect($('[data-testid="trainer-next"]')!.textContent).toBe("Следующая рука");
    // Same max-w-md trainer container as the rest of the session.
    expect(range.closest(".max-w-md")).not.toBeNull();
    // Auto-scroll: exactly one call, on the verdict, aligned to the top (never the range's end).
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(verdict);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    expect(verdict.style.scrollMarginTop).not.toBe("");

    // Tapping a cell keeps the updated inspector visible above the sticky bar (minimal "nearest" scroll).
    await click(cell("66"));
    const inspector = $('[data-testid="range-inspector"]')!;
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView.mock.contexts[1]).toBe(inspector);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", behavior: "smooth" });
    expect(inspector.style.scrollMarginBottom).toContain("safe-area-inset-bottom");
  });

  it("scoring help: ONE disclosure, closed by default, concise rules + (mixed hand) the randomizer as a side note", async () => {
    stubApi([questionFor(UTG_20, "55")]);
    await render(<PreflopTrainer selection={UTG_20} />);
    await click($('button[data-action-code="RAISE"]')!);
    const toggles = $$('[data-testid="scoring-help-toggle"]');
    expect(toggles).toHaveLength(1);
    expect(toggles[0].textContent).toBe("Как считается оценка?");
    expect(toggles[0].getAttribute("aria-expanded")).toBe("false");
    await click(toggles[0]);
    const help = $('[data-testid="scoring-help"]')!;
    expect(help.textContent).toContain("Основное действие: +1");
    expect(help.textContent).toContain("Другое действие с частотой больше 0%: +0.5");
    expect(help.textContent).toContain("Действие с частотой 0%: 0");
    expect($('[data-testid="scoring-help-randomizer"]')!.textContent).toMatch(/на очки не влияет\. Рандомайзер \d+ — в этой раздаче выпал (рейз|фолд)\.$/);
    expect(help.textContent!.length).toBeLessThan(260);
  });
});

describe("QA3 pure hand", () => {
  it("AA (рейз 100%): 'Основное решение — рейз.', no mixed-strategy / randomizer wording anywhere, even in the open help", async () => {
    stubApi([questionFor(UTG_20, "AA")]);
    await render(<PreflopTrainer selection={UTG_20} />);
    await click($('button[data-action-code="RAISE"]')!);
    expect($('[data-testid="feedback-title"]')!.textContent).toBe("Верно");
    expect($('[data-testid="feedback-frequencies"]')!.textContent).toBe("Рейз — 100%");
    expect($('[data-testid="feedback-summary"]')!.textContent).toBe("Основное решение — рейз.");
    await click($('[data-testid="scoring-help-toggle"]')!);
    expect(container.textContent).not.toMatch(/рандомайзер|смешанн/i);
  });

  it("a 0% action on a pure hand: 'Не входит в стратегию' +0, stated plainly", async () => {
    stubApi([questionFor(UTG_20, "AA")]);
    await render(<PreflopTrainer selection={UTG_20} />);
    await click($('button[data-action-code="FOLD"]')!);
    expect($('[data-testid="feedback-title"]')!.textContent).toBe("Не входит в стратегию");
    expect($('[data-testid="feedback-points"]')!.textContent).toBe("+0");
    expect($('[data-testid="feedback-summary"]')!.textContent).toBe("Основное решение — рейз. Выбранное действие здесь не используется.");
  });
});

describe("QA4 three-action node (BB vs BTN 20 BB: олл-ин / колл / фолд)", () => {
  const resolved = requireAcademyPreflopTrainerSpot(BB_VS_BTN_20.datasetId, BB_VS_BTN_20.nodeKey);
  const actions = getPreflopTrainerPublicActions(resolved);
  const threeWay = CANONICAL_STARTING_HANDS.find((hand) =>
    resolved.node.actionCodes.every((code) => (resolved.node.hands[hand][code] ?? 0) > 0))!;
  const pct = (value: number) => (value > 0 && value < 0.01 ? "<1%" : value > 0.99 && value < 1 ? ">99%" : `${Math.round(value * 100)}%`);
  const capital = (text: string) => `${text[0].toLocaleUpperCase("ru")}${text.slice(1)}`;
  /** Expected inspector line from the REAL action definitions (no hard-coded labels). */
  const line = (hand: StartingHandClass) => actions
    .filter((action) => (resolved.node.hands[hand][action.code] ?? 0) > 0)
    .map((action) => `${capital(action.ru!.short)} — ${pct(resolved.node.hands[hand][action.code])}`)
    .join(" · ");

  it("cells keep the true 3-way mix and colours; the inspector lists every non-zero action in node order", async () => {
    expect(resolved.node.actionCodes).toHaveLength(3);
    expect(threeWay).toBeDefined();
    stubApi([questionFor(BB_VS_BTN_20, threeWay)]);
    await render(<PreflopTrainer selection={BB_VS_BTN_20} />);
    await click($('button[data-action-code="FOLD"]')!);
    expect($('[data-testid="answer-range-spot"]')!.textContent).toBe("BB против BTN · 20 BB");
    const dealt = cell(threeWay);
    expect(dealt.dataset.mix).toBe(mixOf(resolved.node.hands, resolved.node.actionCodes, threeWay));
    const toRgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
    for (const action of actions) expect(dealt.style.backgroundImage).toContain(toRgb(solverActionMixColor(action)));
    const inspector = $('[data-testid="range-inspector-frequencies"]')!.textContent!;
    expect(inspector).toBe(line(threeWay));
    expect(inspector.split(" · ")).toHaveLength(3);
    // Legend: all three actions (same legend as the standalone page).
    expect($$('[data-testid="answer-range"] [data-legend-action]').map((li) => li.dataset.legendAction)).toEqual([...resolved.node.actionCodes]);
    // A hand where the strategy never plays some action shows only the played ones.
    const withZero = CANONICAL_STARTING_HANDS.find((hand) => hand !== threeWay
      && resolved.node.actionCodes.some((code) => (resolved.node.hands[hand][code] ?? 0) === 0))!;
    await click(cell(withZero));
    expect($('[data-testid="range-inspector-frequencies"]')!.textContent).toBe(line(withZero));
    expect($('[data-testid="range-inspector-frequencies"]')!.textContent!.split(" · ").length).toBeLessThan(3);
    expect(cell(threeWay).dataset.dealt).toBe("true");
  });
});

describe("QA5 Quick Mix: the range always belongs to the question just answered", () => {
  it("question 1's range is question 1's server node — not question 0's", async () => {
    const all = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    const second = all.findIndex((question, index) => index > 0 && question.rangeHands !== all[0].rangeHands);
    expect(second).toBe(1);
    stubApi(all);
    await render(<PreflopQuickMix />);
    for (const index of [0, 1]) {
      const question = all[index];
      await click($(`button[data-action-code="${question.actions[0].code}"]`)!);
      const codes = question.actions.map((action) => action.code);
      for (const element of $$('[data-testid="answer-range"] [data-hand]')) {
        expect(element.dataset.mix).toBe(mixOf(question.rangeHands, codes, element.dataset.hand as StartingHandClass));
      }
      expect(cell(question.hand).dataset.dealt).toBe("true");
      expect($('[data-testid="answer-range-spot"]')!.textContent).toBe(`${question.spot.title} · ${question.spot.stackBb} BB`);
      if (index === 0) await click($('[data-testid="trainer-next"]')!);
      // The next question shows no range until it is answered.
      if (index === 0) expect($('[data-testid="answer-range"]')).toBeNull();
    }
  });
});

describe("SolverActionMixGrid trainer mode (shared model, accessibility)", () => {
  const actions = [
    { code: "RAISE", kind: "RAISE" as const, label: "Raise", ru: { button: "3-бет", inline: "3-бет", short: "3-бет", always: "" } },
    { code: "CALL", kind: "CALL" as const, label: "Call", ru: { button: "Колл", inline: "колл", short: "колл", always: "" } },
    { code: "FOLD", kind: "FOLD" as const, label: "Fold", ru: { button: "Фолд", inline: "фолд", short: "фолд", always: "" } },
  ];
  const hands = Object.fromEntries(CANONICAL_STARTING_HANDS.map((hand) => [hand, { RAISE: 0, CALL: 0, FOLD: 1 }])) as Record<string, Record<string, number>>;
  hands.A5s = { RAISE: 0.12, CALL: 0.41, FOLD: 0.47 };
  hands.KQo = { RAISE: 0.004, CALL: 0.996, FOLD: 0 };

  it("169 real <button>s with full-split aria labels; dealt hand is announced; exact edge percentages are kept", async () => {
    await render(<StrategyRangeReveal hands={hands as AcademyStrategyNodeHands} actions={actions} dealtHand="A5s" spotTitle="BB против BTN" stackBb={40} />);
    const cells = $$("[data-hand]");
    expect(cells).toHaveLength(169);
    expect(cells.every((element) => element.tagName === "BUTTON" && element.getAttribute("type") === "button")).toBe(true);
    expect(cell("A5s").getAttribute("aria-label")).toBe("A5s: 3-бет 12%, колл 41%, фолд 47% — твоя рука");
    expect(cell("KQo").getAttribute("aria-label")).toBe("KQo: 3-бет <1%, колл >99%");
    expect($('[data-testid="range-inspector-frequencies"]')!.textContent).toBe("3-бет — 12% · Колл — 41% · Фолд — 47%");
    await click(cell("KQo"));
    expect($('[data-testid="range-inspector-frequencies"]')!.textContent).toBe("3-бет — <1% · Колл — >99%");
    expect($('[data-testid="range-inspector"]')!.getAttribute("aria-live")).toBe("polite");
    // Keyboard-operable: native buttons, focus ring present.
    expect(cell("KQo").className).toContain("focus-visible:outline-2");
  });

  it("the static grid (standalone range page) stays a read-only role=grid with no rings and no buttons", async () => {
    await render(<SolverActionMixGrid hands={hands as AcademyStrategyNodeHands} label="x" actions={actions} />);
    expect($('[role="grid"]')).not.toBeNull();
    expect($$('[role="gridcell"]')).toHaveLength(169);
    expect($("button")).toBeNull();
    expect($("[data-dealt]")).toBeNull();
    expect(container.innerHTML).not.toContain(SOLVER_GRID_DEALT_RING_CLASS);
  });
});
