import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolverTraining } from "@/components/academy/solver-training";
import { buildAcademySolverSessionForLesson, buildAcademySolverSession, toPublicSolverQuestion } from "@/lib/academy/solver-training";
import {
  TEST_ONLY_MULTI_ACTION_NODE_KEY,
  buildTestOnlyMultiActionDataset,
} from "@/lib/academy/__tests__/fixtures/test-only-multi-action-dataset";
import type { AcademySolverPublicQuestion, AcademySolverQuestionReveal } from "@/types/academy";

let container: HTMLDivElement;
let root: Root;
let sessionPayload: AcademySolverPublicQuestion;
let revealPayload: AcademySolverQuestionReveal;
const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

/** Original (pre-refactor) action button classes, idle state. */
const ORIGINAL_IDLE_BUTTON_CLASSES =
  "min-h-16 rounded-2xl border px-4 py-4 text-base font-semibold transition-colors disabled:cursor-default border-white/10 bg-white/[0.045] text-white/75"
    .split(" ");

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("SESSION_SECRET", "ui-test-secret");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({ url, body });
    const payload = url.endsWith("/solver/session") ? sessionPayload : revealPayload;
    return { ok: true, json: async () => payload } as Response;
  }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function renderTrainer() {
  await act(async () => {
    root.render(<SolverTraining position="UTG" />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function actionButtons() {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button[data-action-code]"));
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function revealFor(question: ReturnType<typeof buildAcademySolverSession>[number], selectedAction: string): AcademySolverQuestionReveal {
  return {
    ...toPublicSolverQuestion(question),
    questionIndex: question.questionIndex,
    frequencies: question.frequencies,
    resolvedAction: question.resolvedAction,
    selectedAction,
    bucket: question.bucket,
    matchesResolvedAction: selectedAction === question.resolvedAction,
  };
}

describe("(21) real 100bb dataset: unchanged two-button trainer", () => {
  it("renders exactly the two original buttons, generated from the action definitions", async () => {
    const session = buildAcademySolverSessionForLesson({
      playerId: "11111111-1111-4111-8111-111111111111",
      lessonCode: "solver_rfi_9max_100bb_utg",
      attemptId: "22222222-2222-4222-8222-222222222222",
    });
    sessionPayload = toPublicSolverQuestion(session[0]);
    await renderTrainer();

    const buttons = actionButtons();
    expect(buttons).toHaveLength(2);
    // Player-visible text is exactly what the trainer showed before the refactor.
    expect(buttons.map((button) => button.textContent)).toEqual(["Рейз 2.25 BB", "Фолд"]);
    expect(buttons.map((button) => button.dataset.actionCode)).toEqual(["RAISE_2_25BB", "FOLD"]);
    // Canonical labels behind them.
    expect(sessionPayload.actions.map((action) => action.label)).toEqual(["Raise 2.25 BB", "Fold"]);
    for (const button of buttons) {
      for (const cls of ORIGINAL_IDLE_BUTTON_CLASSES) expect(button.classList).toContain(cls);
      expect(button.hasAttribute("aria-label")).toBe(false);
    }
    const grid = buttons[0].parentElement!;
    expect(grid.className).toBe("mt-6 grid grid-cols-2 gap-3");
    expect(container.querySelector(`[aria-label="Рука ${session[0].hand}"]`)).not.toBeNull();
    expect(container.textContent).not.toMatch(/Raise 2\.25 BB|\bFold\b/);
  });

  it("submits the action CODE and shows the original Russian feedback after reveal", async () => {
    const session = buildAcademySolverSessionForLesson({
      playerId: "11111111-1111-4111-8111-111111111111",
      lessonCode: "solver_rfi_9max_100bb_utg",
      attemptId: "22222222-2222-4222-8222-222222222222",
    });
    const mixed = session.find((question) => question.bucket === "MIXED")!;
    sessionPayload = toPublicSolverQuestion(mixed);
    const wrong = mixed.resolvedAction === "FOLD" ? "RAISE_2_25BB" : "FOLD";
    revealPayload = revealFor(mixed, wrong);
    await renderTrainer();

    await click(actionButtons().find((button) => button.dataset.actionCode === wrong)!);
    expect(requests.at(-1)).toMatchObject({ url: "/api/academy/solver/reveal", body: { selectedAction: wrong } });
    const raise = Math.round(mixed.frequencies.RAISE_2_25BB * 100);
    expect(container.textContent).toContain(`Солверная частота для ${mixed.hand} смешанная: рейз ${raise}% / фолд ${100 - raise}%.`);
    expect(container.textContent).toContain(`выпал ${mixed.resolvedAction === "FOLD" ? "фолд" : "рейз"}.`);
  });
});

describe("TEST ONLY multi-action fixture in the trainer UI", () => {
  const dataset = buildTestOnlyMultiActionDataset();
  const session = () => buildAcademySolverSession({
    playerId: "11111111-1111-4111-8111-111111111111",
    lessonCode: "test_only_lesson",
    attemptId: "22222222-2222-4222-8222-222222222222",
    nodeKey: TEST_ONLY_MULTI_ACTION_NODE_KEY,
  }, { dataset, primaryActionCode: "RAISE_7BB" });

  it("(22) renders 4 buttons in a clean 2×2 grid from the action definitions", async () => {
    sessionPayload = toPublicSolverQuestion(session()[0]);
    await renderTrainer();
    const buttons = actionButtons();
    expect(buttons.map((button) => button.textContent)).toEqual(["Fold", "Call", "Raise 7 BB", "All-in"]);
    expect(buttons.map((button) => button.dataset.actionCode)).toEqual(["FOLD", "CALL", "RAISE_7BB", "ALL_IN"]);
    const grid = buttons[0].parentElement!;
    expect(grid.getAttribute("data-action-count")).toBe("4");
    expect(grid.classList).toContain("grid-cols-2");
    for (const button of buttons) {
      expect(button.parentElement).toBe(grid);
      expect(button.classList).toContain("min-w-0");
      expect(button.classList).toContain("break-words");
    }
  });

  it("lays 3 actions out in one row of three", async () => {
    const question = toPublicSolverQuestion(session()[0]);
    sessionPayload = { ...question, actions: question.actions.slice(0, 3) };
    await renderTrainer();
    expect(actionButtons()).toHaveLength(3);
    expect(actionButtons()[0].parentElement!.classList).toContain("grid-cols-3");
  });

  it("(23) reveal renders all 4 frequencies and maps codes through action labels", async () => {
    const mixed = session().find((question) => question.hand === "AKo")
      ?? session().find((question) => question.bucket === "MIXED")!;
    sessionPayload = toPublicSolverQuestion(mixed);
    const selected = mixed.resolvedAction === "CALL" ? "FOLD" : "CALL";
    revealPayload = revealFor(mixed, selected);
    await renderTrainer();

    await click(actionButtons().find((button) => button.dataset.actionCode === selected)!);
    expect(container.textContent).toContain("Fold 10% / Call 40% / Raise 7 BB 30% / All-in 20%");
    const resolvedLabel = mixed.actions.find((action) => action.code === mixed.resolvedAction)!.label;
    expect(container.textContent).toContain(`выпал ${resolvedLabel}.`);
    const resolvedButton = actionButtons().find((button) => button.dataset.actionCode === mixed.resolvedAction)!;
    expect(resolvedButton.classList).toContain("border-[#72b28e]");
    expect(actionButtons().every((button) => button.disabled)).toBe(true);
  });
});
