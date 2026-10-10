import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAcademySolverDataset } from "@/config/academy/solver-datasets";
import { createDeterministicRandom, deriveDeterministicUnit } from "@/lib/academy/solver-session";
import {
  buildAcademySolverSession,
  deriveSolverRandomizerPercent,
  toPublicSolverQuestion,
} from "@/lib/academy/solver-training";
import { resolveActionFromFrequencies } from "@/lib/academy/solver";

const SECRET = "test-solver-secret-Zx9-do-not-leak";
const KEY = {
  playerId: "11111111-1111-4111-8111-111111111111",
  lessonCode: "solver_rfi_9max_100bb_utg",
  attemptId: "22222222-2222-4222-8222-222222222222",
  position: "UTG" as const,
};

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("HMAC-derived Solver Lab session", () => {
  it("derives a unit value in [0, 1) deterministically", () => {
    const a = deriveDeterministicUnit(["a", "b"]);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(deriveDeterministicUnit(["a", "b"])).toBe(a);
    expect(deriveDeterministicUnit(["a", "c"])).not.toBe(a);
  });

  it("depends on the secret", () => {
    const withSecret = deriveDeterministicUnit(["x"]);
    vi.stubEnv("SESSION_SECRET", "another-secret");
    expect(deriveDeterministicUnit(["x"])).not.toBe(withSecret);
  });

  it("(18) same (player, lesson, attempt, question) always yields the same randomizer", () => {
    for (let index = 0; index < 10; index += 1) {
      const value = deriveSolverRandomizerPercent(KEY, index);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(100);
      expect(deriveSolverRandomizerPercent(KEY, index)).toBe(value);
    }
  });

  it("(19) different question indexes derive different underlying values", () => {
    const units = Array.from({ length: 10 }, (_, index) =>
      deriveDeterministicUnit([KEY.playerId, KEY.lessonCode, KEY.attemptId, String(index), "resolve"]));
    expect(new Set(units).size).toBe(10);
    const percents = Array.from({ length: 10 }, (_, index) => deriveSolverRandomizerPercent(KEY, index));
    expect(new Set(percents).size).toBeGreaterThan(1);
  });

  it("(12) rebuilds the identical session for the same key", () => {
    expect(buildAcademySolverSession(KEY)).toEqual(buildAcademySolverSession(KEY));
  });

  it("(20) a different attemptId changes the session entirely", () => {
    const base = buildAcademySolverSession(KEY);
    const other = buildAcademySolverSession({ ...KEY, attemptId: "33333333-3333-4333-8333-333333333333" });
    expect(other.map((q) => q.hand)).not.toEqual(base.map((q) => q.hand));
    expect(other.map((q) => q.randomizerPercent)).not.toEqual(base.map((q) => q.randomizerPercent));
  });

  it("(13) different attempts generally sample different hand sets", () => {
    const sets = new Set(Array.from({ length: 8 }, (_, index) =>
      buildAcademySolverSession({ ...KEY, attemptId: `44444444-4444-4444-8444-44444444444${index}` })
        .map((q) => q.hand).sort().join(",")));
    expect(sets.size).toBeGreaterThan(1);
  });

  it("builds a balanced 10-hand session whose resolved actions follow the resolver", () => {
    const session = buildAcademySolverSession(KEY);
    expect(session).toHaveLength(10);
    expect(new Set(session.map((q) => q.hand)).size).toBe(10);
    const counts = session.reduce<Record<string, number>>((acc, q) => {
      acc[q.bucket] = (acc[q.bucket] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ MIXED: 4, PURE_RAISE: 3, PURE_FOLD: 3 });
    session.forEach((question, index) => {
      expect(question.questionIndex).toBe(index);
      expect(question.frequencies).toBe(getAcademySolverDataset().positions.UTG[question.hand]);
      expect(question.randomizerPercent).toBe(deriveSolverRandomizerPercent(KEY, index));
      expect(question.resolvedAction).toBe(resolveActionFromFrequencies(
        question.frequencies,
        ["RAISE_2_25BB", "FOLD"],
        question.randomizerPercent,
      ));
      const suited = question.hand.endsWith("s");
      expect(question.renderedCards[0].suit === question.renderedCards[1].suit).toBe(suited);
    });
  });

  it("(21) fails closed when SESSION_SECRET is missing", () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => deriveDeterministicUnit(["x"])).toThrow("SESSION_SECRET is not set");
    expect(() => createDeterministicRandom(["x"])).toThrow("SESSION_SECRET is not set");
    expect(() => buildAcademySolverSession(KEY)).toThrow("SESSION_SECRET is not set");
  });

  it("(22) never exposes the secret in errors or payloads", () => {
    const session = buildAcademySolverSession(KEY);
    expect(JSON.stringify(session)).not.toContain(SECRET);
    expect(JSON.stringify(session.map(toPublicSolverQuestion))).not.toContain(SECRET);

    for (const run of [
      () => deriveDeterministicUnit([]),
      () => buildAcademySolverSession({ ...KEY, position: "XX" as never }),
    ]) {
      try {
        run();
        throw new Error("expected throw");
      } catch (error) {
        expect(String((error as Error).message)).not.toContain(SECRET);
        expect(String((error as Error).stack)).not.toContain(SECRET);
      }
    }
  });

  it("public question carries only hand, renderedCards and randomizerPercent", () => {
    const publicQuestion = toPublicSolverQuestion(buildAcademySolverSession(KEY)[0]);
    expect(Object.keys(publicQuestion).sort()).toEqual(["hand", "randomizerPercent", "renderedCards"]);
  });
});
