/**
 * Push/Fold SCORED session UI (manual + Quick), re-homed from
 * product-ux-v3.test.tsx. Scored Push/Fold is paused in production (Part 1A,
 * docs/ACADEMY_PUSH_FOLD_AUDIT.md: ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS is
 * empty), so these tests simulate a FUTURE validated whitelist to keep the
 * client trainer — completion screen, review, attribution, sticky CTA —
 * correct for when scoring resumes. The real paused state is pinned in
 * features/__tests__/academy-push-fold-policy.test.ts and the page tests.
 */
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/academy/push-fold-trainer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/academy/push-fold-trainer")>();
  return { ...actual, ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS: actual.ACADEMY_PUSH_FOLD_TRAINER_DATASET_IDS };
});

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

const { PushFoldTrainer, PushFoldQuickMix } = await import("@/components/academy/push-fold-trainer");
const { buildAcademyPushFoldSession, toPublicPushFoldQuestion, toPushFoldReveal } = await import("@/lib/academy/push-fold-trainer");
const { buildAcademyPushFoldMixSession } = await import("@/lib/academy/push-fold-mix");

const PLAYER_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";

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
const $$ = (selector: string) => Array.from(container.querySelectorAll<HTMLElement>(selector));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("SESSION_SECRET", "push-fold-scored-ui-secret");
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

type Session = ReturnType<typeof buildAcademyPushFoldSession>;

async function playPushFold(element: ReactElement, session: Session, wrong: ReadonlySet<number>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    let payload: unknown;
    if (url.endsWith("/session")) payload = toPublicPushFoldQuestion(session[body.questionIndex as number]);
    else if (url.endsWith("/reveal")) payload = toPushFoldReveal(session[body.questionIndex as number], body.selectedAction as string);
    else {
      const answers = body.questions as Array<{ questionIndex: number; selectedAction: string }>;
      const correct = answers.filter((answer) => answer.selectedAction === session[answer.questionIndex].resolvedAction).length;
      payload = {
        result: { correctAnswers: correct, totalQuestions: 10, percentage: correct * 10, passed: correct >= 8, feedback: "Готово" },
        progress: { lessonCode: body.lessonCode, attemptsCount: 3 }, isNewAttempt: true, firstPass: false, newBest: false,
      };
    }
    return { ok: true, json: async () => payload } as Response;
  }));
  await render(element);
  for (const question of session) {
    const choice = wrong.has(question.questionIndex)
      ? question.actions.find((action) => action.code !== question.resolvedAction)!.code
      : question.resolvedAction;
    await click($(`button[data-action-code="${choice}"]`));
    expect($('[data-testid="trainer-next-bar"] [data-testid="trainer-next"]')).not.toBeNull();
    await click($('[data-testid="trainer-next"]'));
  }
}

async function expectReview(expectedWrong: readonly number[]) {
  const toggle = $('[data-completion-action="review"]')!;
  expect(toggle.textContent).toContain(`Разобрать ошибки · ${expectedWrong.length}`);
  await click(toggle);
  expect($$("[data-review-question]").map((entry) => Number(entry.dataset.reviewQuestion))).toEqual(expectedWrong.map((index) => index + 1));
  for (const entry of $$("[data-review-question]")) expect(entry.textContent).toMatch(/Правильно: (Олл-ин|Фолд|Колл)/);
}

describe("Push/Fold scored UI (simulated validated dataset)", () => {
  it("manual trainer: completion, review of pure-range misses, attribution", async () => {
    const selection = { datasetId: "holdemmath_pushfold_9max_10bb_ante10_v1", nodeKey: "FIRST_IN_SHOVE_BTN", stackBb: 10 };
    const session = buildAcademyPushFoldSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID, datasetId: selection.datasetId, nodeKey: selection.nodeKey });
    await playPushFold(<PushFoldTrainer selection={selection} />, session, new Set([1, 4, 7]));
    expect($('[data-testid="trainer-completion"]')!.textContent).toContain("Тренировка завершена");
    expect($('[data-completion-action="setup"]')?.getAttribute("href")).toBe("/academy/solver/push-fold#setup");
    expect($('[data-testid="push-fold-attribution"]')?.textContent).toContain("Данные Push/Fold: HoldemMath · CC BY 4.0");
    await expectReview([1, 4, 7]);
  });

  it("Quick mode", async () => {
    const session = buildAcademyPushFoldMixSession({ playerId: PLAYER_ID, attemptId: ATTEMPT_ID });
    await playPushFold(<PushFoldQuickMix />, session, new Set([0, 9]));
    expect($('[data-completion-action="setup"]')?.getAttribute("href")).toBe("/academy/solver/push-fold#setup");
    expect($('[data-testid="push-fold-attribution"]')).not.toBeNull();
    await expectReview([0, 9]);
  });
});
