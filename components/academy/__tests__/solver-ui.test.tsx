import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SolverFrequencyGrid } from "@/components/academy/SolverFrequencyGrid";
import { getAcademySolverDataset } from "@/config/academy/solver-datasets";
import { ACADEMY_PREFLOP_POSITIONS, CANONICAL_STARTING_HANDS } from "@/lib/academy/preflop";
import { buildSolverAnswerFeedback } from "@/lib/academy/solver-feedback";
import { classifySolverHandBucket } from "@/lib/academy/solver";
import type { AcademySolverAction } from "@/types/academy";

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

const dataset = getAcademySolverDataset();

describe("SolverFrequencyGrid", () => {
  it("(37) renders 169 cells with hand + action + percentage aria-labels", async () => {
    await act(async () => {
      root.render(<SolverFrequencyGrid hands={dataset.nodes.UTG.hands} label="UTG" actions={dataset.actions} />);
    });
    const cells = container.querySelectorAll('[role="gridcell"]');
    expect(cells).toHaveLength(169);
    expect(Array.from(cells).map((cell) => cell.getAttribute("aria-label")?.split(":")[0]))
      .toEqual([...CANONICAL_STARTING_HANDS]);

    const label = (hand: string) =>
      container.querySelector(`[role="gridcell"][aria-label^="${hand}:"]`)?.getAttribute("aria-label");
    expect(label("AKo")).toBe("AKo: рейз 100%");
    expect(label("AJo")).toBe("AJo: рейз 41%, фолд 59%");
    expect(label("72o")).toBe("72o: фолд 100%");
    expect(container.querySelector('[aria-label^="AJo:"]')?.getAttribute("data-cell-kind")).toBe("MIXED");
    expect(container.querySelector('[aria-label^="AJo:"]')?.textContent).toBe("AJo41%");
    expect(container.querySelector('[aria-label^="AA:"]')?.getAttribute("data-cell-kind")).toBe("PURE_RAISE");
    expect(container.querySelector('[aria-label^="72o:"]')?.getAttribute("data-cell-kind")).toBe("PURE_FOLD");
  });

  it("(38) never displays EV", async () => {
    for (const position of ACADEMY_PREFLOP_POSITIONS) {
      await act(async () => {
        root.render(<SolverFrequencyGrid hands={dataset.nodes[position].hands} label={position} actions={dataset.actions} />);
      });
      expect(container.innerHTML).not.toMatch(/\bEV\b/i);
    }
  });
});

describe("Solver Lab feedback copy", () => {
  const forbidden = /неправильн|неверн|ошибк|wrong/i;

  it("(39) never calls a mixed-hand disagreement wrong, but states the outcome and split", () => {
    let checked = 0;
    for (const position of ACADEMY_PREFLOP_POSITIONS) {
      for (const hand of CANONICAL_STARTING_HANDS) {
        const frequencies = dataset.nodes[position].hands[hand];
        if (classifySolverHandBucket(frequencies, "RAISE_2_25BB") !== "MIXED") continue;
        for (const resolvedAction of ["RAISE_2_25BB", "FOLD"] as AcademySolverAction[]) {
          const selectedAction: AcademySolverAction = resolvedAction === "FOLD" ? "RAISE_2_25BB" : "FOLD";
          const feedback = buildSolverAnswerFeedback({
            hand, frequencies, randomizerPercent: 50, resolvedAction, selectedAction, actions: dataset.actions,
          });
          const text = `${feedback.title} ${feedback.summary} ${feedback.detail}`;
          expect(feedback.tone).toBe("mixed");
          expect(text).not.toMatch(forbidden);
          expect(text).toContain(`выпал ${resolvedAction === "FOLD" ? "фолд" : "рейз"}`);
          expect(text).toContain(`рейз ${Math.round(frequencies.RAISE_2_25BB * 100)}%`);
          expect(text).toContain(`фолд ${Math.round(frequencies.FOLD * 100)}%`);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("formats the UTG AJo mixed example exactly", () => {
    const feedback = buildSolverAnswerFeedback({
      hand: "AJo",
      frequencies: dataset.nodes.UTG.hands.AJo,
      randomizerPercent: 63,
      resolvedAction: "FOLD",
      selectedAction: "RAISE_2_25BB",
      actions: dataset.actions,
    });
    expect(feedback.summary).toBe("Солверная частота для AJo смешанная: рейз 41% / фолд 59%.");
    expect(feedback.detail).toContain("Рандомайзер 63 → в этой раздаче выпал фолд.");
    expect(feedback.detail).toContain("рейз здесь тоже часть стратегии");
  });

  it("uses normal correct/incorrect feedback for pure hands", () => {
    const pureRaise = {
      hand: "AA" as const, frequencies: dataset.nodes.UTG.hands.AA, randomizerPercent: 99, actions: dataset.actions,
    };
    expect(buildSolverAnswerFeedback({ ...pureRaise, resolvedAction: "RAISE_2_25BB", selectedAction: "RAISE_2_25BB" }))
      .toMatchObject({ tone: "correct", title: "Верно" });
    expect(buildSolverAnswerFeedback({ ...pureRaise, resolvedAction: "RAISE_2_25BB", selectedAction: "FOLD" }))
      .toMatchObject({ tone: "incorrect", title: "Не совсем", summary: "Действие: рейз 2.25 BB." });
  });

  it("never mentions EV or exact GTO", () => {
    const feedback = buildSolverAnswerFeedback({
      hand: "AJo", frequencies: dataset.nodes.UTG.hands.AJo, randomizerPercent: 3,
      resolvedAction: "RAISE_2_25BB", selectedAction: "RAISE_2_25BB", actions: dataset.actions,
    });
    expect(JSON.stringify(feedback)).not.toMatch(/\bEV\b|GTO/);
  });
});
