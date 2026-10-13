"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAcademyBeginnerOnly } from "@/components/academy/academy-access-context";
import { solverActionGridColumnsClass } from "@/components/academy/solver-training";
import {
  TRAINER_NEXT_BUTTON_CLASS,
  TrainerActionButtons,
  TrainerCompletionScreen,
  type TrainerCompletionLink,
  TrainerDecisionHeader,
  TrainerHandScene,
  TrainerNextBar,
  TrainerPracticeVerdict,
  type TrainerReviewEntry,
  TrainerSessionTopBar,
  TrainerSpotContext,
} from "@/components/academy/trainer-session-ui";
import {
  ACADEMY_BEGINNER_ROUTE,
  ACADEMY_BEGINNER_STEP2_ROUTE,
  ACADEMY_PREFLOP_SETUP_ROUTE,
  ACADEMY_TRAINERS_ROUTE,
} from "@/config/academy/navigation-routes";
import {
  ACADEMY_PREFLOP_QUICK_MIX_MODE,
  ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
  preflopTrainerSpotRoute,
} from "@/config/academy/preflop-trainer";
import { ACADEMY_TRAINING_QUESTION_COUNT } from "@/config/academy/training";
import { StrategyRangeReveal } from "@/components/academy/strategy-range-reveal";
import { withHeroAllIn } from "@/lib/academy/preflop-sizing";
import {
  buildPracticeAnswerFeedback,
  formatPracticeFrequencyList,
  solverActionButtonLabel,
} from "@/lib/academy/solver-feedback";
import { strategyAnswerIsMistake } from "@/lib/academy/strategy-answer";
import type {
  AcademyLessonProgress,
  AcademyPreflopTableMoney,
  AcademyPreflopQuickMixAnswer,
  AcademyPreflopTrainerAnswer,
  AcademyPreflopTrainerPublicQuestion,
  AcademyPreflopTrainerReveal,
  AcademySolverAction,
  AcademyTrainingResult,
} from "@/types/academy";

type SubmitAttemptResponse = {
  result: AcademyTrainingResult;
  progress: AcademyLessonProgress;
  isNewAttempt: boolean;
  firstPass: boolean;
  newBest: boolean;
};

/** Which node the session trains (validated again by the server on every call). */
export type PreflopTrainerSelection = {
  readonly datasetId: string;
  readonly nodeKey: string;
  readonly stackBb: number;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Запрос не удался");
  return payload;
}

function makeAttemptId(): string {
  return globalThis.crypto.randomUUID();
}

function subscribeToHydration() {
  return () => undefined;
}

type PreflopTrainerAnyAnswer = AcademyPreflopTrainerAnswer | AcademyPreflopQuickMixAnswer;

/**
 * Where a session's questions come from and how its answers are shaped. The
 * fixed-node trainer names its node in every request; Quick Mix sends only
 * attemptId + questionIndex and echoes the server-derived node in answers.
 */
type PreflopTrainerSessionSource = {
  readonly sessionUrl: string;
  readonly revealUrl: string;
  readonly questionBody: (attemptId: string, questionIndex: number) => Record<string, unknown>;
  readonly revealBody: (attemptId: string, questionIndex: number, selectedAction: AcademySolverAction) => Record<string, unknown>;
  readonly toAnswer: (
    questionIndex: number,
    selectedAction: AcademySolverAction,
    question: AcademyPreflopTrainerPublicQuestion,
  ) => PreflopTrainerAnyAnswer;
  /** In-session and completion "back": where this session was started from. */
  readonly back: { readonly href: string; readonly label: string };
  readonly eyebrow?: string;
  readonly passedLabel: string;
  /** Optional completion links after "Пройти ещё раз" / "К тренажёрам". */
  readonly resultLinks: readonly TrainerCompletionLink[];
  /** The completion screen's secondary link; defaults to "К тренажёрам". */
  readonly trainers?: TrainerCompletionLink;
};

const TRAINERS_LINK: TrainerCompletionLink = { href: ACADEMY_TRAINERS_ROUTE, label: "К тренажёрам", testId: "trainers" };
const SETUP_BACK = { href: ACADEMY_PREFLOP_SETUP_ROUTE, label: "К выбору ситуации" } as const;
const TRAINERS_BACK = { href: ACADEMY_TRAINERS_ROUTE, label: "Тренажёры" } as const;
const BEGINNER_BACK = { href: ACADEMY_BEGINNER_STEP2_ROUTE, label: "Новичкам" } as const;
const BEGINNER_LINK: TrainerCompletionLink = { href: ACADEMY_BEGINNER_STEP2_ROUTE, label: "К урокам для новичков", testId: "beginner" };

/**
 * "Разобрать ошибки" entry, built from the reveal the server already returned.
 * Only a genuine 0-point mistake — an action the strategy never plays here
 * (server outcome `NOT_IN_STRATEGY`) — is listed. A supported alternative
 * (+0.5: the strategy plays it, but it is not the primary action) is never a
 * mistake and is never listed.
 */
export function preflopTrainerReviewEntry(reveal: AcademyPreflopTrainerReveal): TrainerReviewEntry | null {
  if (!strategyAnswerIsMistake(reveal.outcome)) return null;
  const feedback = buildPracticeAnswerFeedback(reveal);
  const label = (code: AcademySolverAction) => {
    const action = reveal.actions.find((candidate) => candidate.code === code);
    return action ? solverActionButtonLabel(action) : code;
  };
  return {
    questionNumber: reveal.questionIndex + 1,
    title: reveal.spot.title,
    stackBb: reveal.spot.stackBb,
    hand: reveal.hand,
    tone: "incorrect",
    verdict: feedback.title,
    yourAnswer: label(reveal.selectedAction),
    expectedLabel: "Стратегия",
    expectedAnswer: formatPracticeFrequencyList(reveal.frequencies, reveal.actions),
    detail: feedback.summary,
  };
}

/**
 * Table money shown for a question: the spot's trusted model, plus — once the
 * hero's answer is revealed and it was an all-in (an ALL_IN action, a raise
 * whose documented size is the whole stack, or a call of an all-in for the
 * whole remaining stack) — the hero's all-in marks.
 */
export function revealedTableMoney(
  table: AcademyPreflopTableMoney | undefined,
  heroSeat: string,
  question: AcademyPreflopTrainerPublicQuestion | null,
  reveal: Pick<AcademyPreflopTrainerReveal, "selectedAction"> | null,
): AcademyPreflopTableMoney | undefined {
  if (!table || !question || !reveal) return table;
  const chosen = question.actions.find((action) => action.code === reveal.selectedAction);
  const allIn = chosen && (chosen.kind === "ALL_IN"
    || chosen.sizing?.kind === "ALL_IN"
    // Calling an all-in with the whole remaining stack is an all-in too.
    || (chosen.sizing?.kind === "CALL" && chosen.sizing.totalBb >= table.startingStackBb));
  return allIn ? withHeroAllIn(table, heroSeat) : table;
}

/**
 * Configurable preflop trainer session. Questions come from
 * `/api/academy/solver/preflop/session` (no frequencies / resolved action),
 * the reveal only after answering, and the score is recomputed server-side
 * from the selected actions. All attempts record under the one
 * `solver_preflop_trainer` lesson code; the node travels inside each answer.
 */
/**
 * Presentation of a fixed-node session opened from a ready-made training
 * ("Готовые тренировки"), a lesson or "Продвинутым": its header label and back
 * link only. Resolved on the server from whitelisted query params; it never
 * affects which node is trained, the session or the scoring.
 */
export type PreflopTrainerContext = {
  readonly eyebrow?: string;
  readonly back?: { readonly href: string; readonly label: string };
};

export function PreflopTrainer({ selection, context }: { selection: PreflopTrainerSelection; context?: PreflopTrainerContext }) {
  const { datasetId, nodeKey, stackBb } = selection;
  // BEGINNER_ONLY (server-resolved tier; presentation only): a beginner-curriculum
  // spot leads back to its lesson or to "Новичкам", never into locked hubs.
  const beginnerOnly = useAcademyBeginnerOnly();
  const contextBack = context?.back && (!beginnerOnly || context.back.href.startsWith(ACADEMY_BEGINNER_ROUTE))
    ? context.back
    : beginnerOnly ? BEGINNER_BACK : undefined;
  const backHref = contextBack?.href;
  const backLabel = contextBack?.label;
  const eyebrow = context?.eyebrow;
  const source = useMemo<PreflopTrainerSessionSource>(() => ({
    sessionUrl: "/api/academy/solver/preflop/session",
    revealUrl: "/api/academy/solver/preflop/reveal",
    questionBody: (attemptId, questionIndex) => ({ datasetId, nodeKey, attemptId, questionIndex }),
    revealBody: (attemptId, questionIndex, selectedAction) => ({ datasetId, nodeKey, attemptId, questionIndex, selectedAction }),
    toAnswer: (questionIndex, selectedAction) => ({ questionIndex, selectedAction, datasetId, nodeKey }),
    back: backHref && backLabel ? { href: backHref, label: backLabel } : SETUP_BACK,
    ...(eyebrow ? { eyebrow } : {}),
    passedLabel: "Спот пройден",
    resultLinks: beginnerOnly
      ? [{ href: preflopTrainerSpotRoute(stackBb, nodeKey), label: "Посмотреть диапазон", testId: "range" }]
      : [
        { href: ACADEMY_PREFLOP_SETUP_ROUTE, label: "Настроить другую ситуацию", testId: "setup" },
        { href: preflopTrainerSpotRoute(stackBb, nodeKey), label: "Посмотреть диапазон", testId: "range" },
      ],
    ...(beginnerOnly ? { trainers: BEGINNER_LINK } : {}),
  }), [datasetId, nodeKey, stackBb, backHref, backLabel, eyebrow, beginnerOnly]);
  return <PreflopTrainerSession source={source} />;
}

/**
 * "Быстрая тренировка": 10 questions, each from a server-chosen node
 * (different stacks / situations / seats). The client never names a node:
 * requests carry only attemptId + questionIndex; answers echo the node the
 * server served (re-checked by the verifier) and are marked QUICK_MIX. Same
 * lesson code as the fixed-node trainer.
 */
export function PreflopQuickMix() {
  const source = useMemo<PreflopTrainerSessionSource>(() => ({
    sessionUrl: "/api/academy/solver/preflop/mix/session",
    revealUrl: "/api/academy/solver/preflop/mix/reveal",
    questionBody: (attemptId, questionIndex) => ({ attemptId, questionIndex }),
    revealBody: (attemptId, questionIndex, selectedAction) => ({ attemptId, questionIndex, selectedAction }),
    toAnswer: (questionIndex, selectedAction, question) => ({
      questionIndex,
      selectedAction,
      datasetId: question.spot.datasetId,
      nodeKey: question.spot.nodeKey,
      mode: ACADEMY_PREFLOP_QUICK_MIX_MODE,
    }),
    back: TRAINERS_BACK,
    eyebrow: "Быстрая тренировка",
    passedLabel: "Тренировка пройдена",
    resultLinks: [{ href: ACADEMY_PREFLOP_SETUP_ROUTE, label: "Настроить ситуацию", testId: "setup" }],
  }), []);
  return <PreflopTrainerSession source={source} />;
}

function PreflopTrainerSession({ source }: { source: PreflopTrainerSessionSource }) {
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const [attemptId, setAttemptId] = useState<string>(makeAttemptId);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [question, setQuestion] = useState<AcademyPreflopTrainerPublicQuestion | null>(null);
  const [reveal, setReveal] = useState<AcademyPreflopTrainerReveal | null>(null);
  const [answers, setAnswers] = useState<PreflopTrainerAnyAnswer[]>([]);
  const [review, setReview] = useState<TrainerReviewEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AcademyTrainingResult | null>(null);
  const [updatedProgress, setUpdatedProgress] = useState<AcademyLessonProgress | null>(null);
  const [newBest, setNewBest] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const feedbackRef = useRef<HTMLElement>(null);
  const loadQuestion = useCallback(async (currentAttemptId: string, index: number) => {
    setPending(true);
    setError(null);
    try {
      setQuestion(await postJson<AcademyPreflopTrainerPublicQuestion>(
        source.sessionUrl,
        source.questionBody(currentAttemptId, index),
      ));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить вопрос");
    } finally {
      setPending(false);
    }
  }, [source]);

  useEffect(() => {
    if (hydrated) void loadQuestion(attemptId, questionIndex);
  }, [hydrated, attemptId, questionIndex, loadQuestion]);

  // A new hand always starts at the top: the whole table (top seats included)
  // is visible below the Telegram top chrome, not left scrolled under it.
  useEffect(() => {
    if (hydrated && typeof window.scrollTo === "function") window.scrollTo({ top: 0 });
  }, [hydrated, attemptId, questionIndex]);

  // After answering, bring the verdict to the upper part of the screen (the
  // bottom of the action buttons stays visible above it via its scroll
  // margin) so the player lands on "verdict + start of the range". It never
  // scrolls on to the end of the (tall) range — inspecting further is the
  // player's own choice.
  useEffect(() => {
    const panel = feedbackRef.current;
    if (reveal && panel && typeof panel.scrollIntoView === "function") {
      panel.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [reveal]);

  async function handleAnswer(selectedAction: AcademySolverAction) {
    if (!question || reveal || pending) return;
    setPending(true);
    setError(null);
    try {
      const revealed = await postJson<AcademyPreflopTrainerReveal>(
        source.revealUrl,
        source.revealBody(attemptId, questionIndex, selectedAction),
      );
      setReveal(revealed);
      setAnswers((current) => [...current, source.toAnswer(questionIndex, selectedAction, question)]);
      const entry = preflopTrainerReviewEntry(revealed);
      if (entry) setReview((current) => [...current, entry]);
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : "Не удалось проверить ответ");
    } finally {
      setPending(false);
    }
  }

  async function submitAttempt(completedAnswers: readonly PreflopTrainerAnyAnswer[]) {
    setSaveState("saving");
    setError(null);
    try {
      const payload = await postJson<SubmitAttemptResponse>("/api/academy/attempts", {
        attemptId,
        lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
        questions: completedAnswers,
      });
      setResult(payload.result);
      setUpdatedProgress(payload.progress);
      setNewBest(payload.newBest);
      setSaveState("idle");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить результат");
      setSaveState("error");
    }
  }

  function handleNext() {
    if (!reveal) return;
    if (questionIndex === ACADEMY_TRAINING_QUESTION_COUNT - 1) {
      void submitAttempt(answers);
      return;
    }
    setReveal(null);
    setQuestion(null);
    setQuestionIndex((index) => index + 1);
  }

  function restart() {
    setAttemptId(makeAttemptId());
    setQuestionIndex(0);
    setQuestion(null);
    setReveal(null);
    setAnswers([]);
    setReview([]);
    setResult(null);
    setUpdatedProgress(null);
    setNewBest(false);
    setSaveState("idle");
    setError(null);
  }

  if (!hydrated) {
    return (
      <main className="min-h-screen bg-[#08100c] px-4 py-6 pb-32 text-white">
        <div className="mx-auto max-w-md text-sm text-white/55">Готовим тренировку...</div>
      </main>
    );
  }

  if (result) {
    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,#09100d,#070707)] px-4 py-6 pb-32 text-white">
        <TrainerCompletionScreen
          result={result}
          passedLabel={source.passedLabel}
          attemptsLabel={updatedProgress ? `Попыток в тренажёре: ${updatedProgress.attemptsCount}` : null}
          newBest={newBest}
          onRestart={restart}
          back={source.back}
          trainers={source.trainers ?? TRAINERS_LINK}
          links={source.resultLinks}
          review={review}
        />
      </main>
    );
  }

  const feedback = reveal ? buildPracticeAnswerFeedback(reveal) : null;
  const isLastQuestion = questionIndex === ACADEMY_TRAINING_QUESTION_COUNT - 1;
  const spot = question?.spot;
  const table = spot ? revealedTableMoney(spot.table, spot.heroPosition, question, reveal) : undefined;

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d,#070707)] px-4 pb-32 pt-4 text-white">
      <div className="mx-auto max-w-md">
        <TrainerSessionTopBar
          backHref={source.back.href}
          backLabel={source.back.label}
          eyebrow={source.eyebrow}
          questionIndex={questionIndex}
          total={ACADEMY_TRAINING_QUESTION_COUNT}
        />

        {question && spot ? (
          <>
            <TrainerSpotContext title={spot.title} history={spot.history} stackBb={spot.stackBb} />
            <TrainerHandScene
              scene={spot.scene}
              stackBb={spot.stackBb}
              cards={question.renderedCards}
              hand={question.hand}
              presentation="ADVANCED"
              table={table}
            />
            <TrainerDecisionHeader hand={question.hand} />
            <TrainerActionButtons
              actions={question.actions}
              columnsClass={solverActionGridColumnsClass(question.actions.length)}
              reveal={reveal}
              disabled={pending}
              onAnswer={(action) => void handleAnswer(action)}
              presentation="ADVANCED"
            />
          </>
        ) : (
          <p className="mt-10 text-center text-sm text-white/50">{error ? "" : "Готовим раздачу..."}</p>
        )}

        {feedback && reveal ? (
          <>
            <TrainerPracticeVerdict
              key={`verdict-${questionIndex}`}
              ref={feedbackRef}
              tone={feedback.tone}
              title={feedback.title}
              hand={feedback.hand}
              frequencyLine={feedback.frequencyLine}
              summary={feedback.summary}
              points={reveal.points}
              randomizerNote={feedback.randomizerNote}
            />
            {/* The range always comes from the reveal (the node the server scored), never from the question. */}
            <StrategyRangeReveal
              key={`range-${attemptId}-${questionIndex}`}
              hands={reveal.rangeHands}
              actions={reveal.actions}
              dealtHand={reveal.hand}
              spotTitle={reveal.spot.title}
              stackBb={reveal.spot.stackBb}
            />
          </>
        ) : null}

        {error ? (
          <div className="mt-5 rounded-2xl border border-[#b95b5f]/30 bg-[#5b292c]/20 p-4">
            <p className="text-sm font-medium text-[#e0a4a6]">{error}</p>
            <button
              type="button"
              onClick={() => {
                if (saveState === "error") void submitAttempt(answers);
                else if (!question) void loadQuestion(attemptId, questionIndex);
                else setError(null);
              }}
              className="mt-3 rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-white/75"
            >
              Повторить
            </button>
          </div>
        ) : null}

        {reveal ? (
          <TrainerNextBar>
            <button
              type="button"
              onClick={handleNext}
              disabled={saveState === "saving"}
              data-testid="trainer-next"
              className={TRAINER_NEXT_BUTTON_CLASS}
            >
              {saveState === "saving"
                ? "Сохраняем..."
                : isLastQuestion ? "Посмотреть результат" : "Следующая рука"}
            </button>
          </TrainerNextBar>
        ) : null}
      </div>
    </main>
  );
}
