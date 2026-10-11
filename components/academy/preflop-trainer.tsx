"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { solverActionGridColumnsClass } from "@/components/academy/solver-training";
import {
  TRAINER_PRIMARY_BUTTON_CLASS,
  TrainerActionButtons,
  TrainerCompletionScreen,
  type TrainerCompletionLink,
  TrainerDecisionHeader,
  TrainerFeedbackPanel,
  TrainerHandScene,
  type TrainerReviewEntry,
  TrainerSessionTopBar,
  TrainerSpotContext,
} from "@/components/academy/trainer-session-ui";
import {
  ACADEMY_PREFLOP_SETUP_ROUTE,
  ACADEMY_TRAINERS_ROUTE,
} from "@/config/academy/navigation-routes";
import {
  ACADEMY_PREFLOP_QUICK_MIX_MODE,
  ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
  preflopTrainerSpotRoute,
} from "@/config/academy/preflop-trainer";
import { ACADEMY_TRAINING_QUESTION_COUNT } from "@/config/academy/training";
import {
  ACADEMY_NEUTRAL_FEEDBACK_WORDING,
  buildSolverAnswerFeedback,
  solverActionButtonLabel,
} from "@/lib/academy/solver-feedback";
import type {
  AcademyLessonProgress,
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
};

const TRAINERS_LINK: TrainerCompletionLink = { href: ACADEMY_TRAINERS_ROUTE, label: "К тренажёрам", testId: "trainers" };
const SETUP_BACK = { href: ACADEMY_PREFLOP_SETUP_ROUTE, label: "К выбору ситуации" } as const;
const TRAINERS_BACK = { href: ACADEMY_TRAINERS_ROUTE, label: "Тренажёры" } as const;

/**
 * Review entry for a question that did not count as correct (selected ≠
 * resolved), built from the reveal the server already returned — the same
 * feedback copy the player saw after answering.
 */
export function preflopTrainerReviewEntry(reveal: AcademyPreflopTrainerReveal): TrainerReviewEntry | null {
  if (reveal.selectedAction === reveal.resolvedAction) return null;
  const feedback = buildSolverAnswerFeedback(reveal, ACADEMY_NEUTRAL_FEEDBACK_WORDING);
  const label = (code: AcademySolverAction) => {
    const action = reveal.actions.find((candidate) => candidate.code === code);
    return action ? solverActionButtonLabel(action) : code;
  };
  const mixedHand = !reveal.actions.some((action) => (reveal.frequencies[action.code] ?? 0) >= 1);
  return {
    questionNumber: reveal.questionIndex + 1,
    title: reveal.spot.title,
    stackBb: reveal.spot.stackBb,
    hand: reveal.hand,
    tone: feedback.tone === "mixed" ? "mixed" : "incorrect",
    verdict: feedback.title,
    yourAnswer: label(reveal.selectedAction),
    expectedLabel: mixedHand ? "Выпало на рандомайзере" : "Стратегия",
    expectedAnswer: label(reveal.resolvedAction),
    detail: `${feedback.summary} ${feedback.detail}`,
  };
}

/**
 * Configurable preflop trainer session. Questions come from
 * `/api/academy/solver/preflop/session` (no frequencies / resolved action),
 * the reveal only after answering, and the score is recomputed server-side
 * from the selected actions. All attempts record under the one
 * `solver_preflop_trainer` lesson code; the node travels inside each answer.
 */
export function PreflopTrainer({ selection }: { selection: PreflopTrainerSelection }) {
  const { datasetId, nodeKey, stackBb } = selection;
  const source = useMemo<PreflopTrainerSessionSource>(() => ({
    sessionUrl: "/api/academy/solver/preflop/session",
    revealUrl: "/api/academy/solver/preflop/reveal",
    questionBody: (attemptId, questionIndex) => ({ datasetId, nodeKey, attemptId, questionIndex }),
    revealBody: (attemptId, questionIndex, selectedAction) => ({ datasetId, nodeKey, attemptId, questionIndex, selectedAction }),
    toAnswer: (questionIndex, selectedAction) => ({ questionIndex, selectedAction, datasetId, nodeKey }),
    back: SETUP_BACK,
    passedLabel: "Спот пройден",
    resultLinks: [
      { href: ACADEMY_PREFLOP_SETUP_ROUTE, label: "Настроить другую ситуацию", testId: "setup" },
      { href: preflopTrainerSpotRoute(stackBb, nodeKey), label: "Посмотреть диапазон", testId: "range" },
    ],
  }), [datasetId, nodeKey, stackBb]);
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
          trainers={TRAINERS_LINK}
          links={source.resultLinks}
          review={review}
        />
      </main>
    );
  }

  const feedback = reveal ? buildSolverAnswerFeedback(reveal, ACADEMY_NEUTRAL_FEEDBACK_WORDING) : null;
  const isLastQuestion = questionIndex === ACADEMY_TRAINING_QUESTION_COUNT - 1;
  const spot = question?.spot;

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
            <TrainerHandScene scene={spot.scene} stackBb={spot.stackBb} cards={question.renderedCards} hand={question.hand} />
            <TrainerDecisionHeader hand={question.hand}>
              <span className="flex items-center gap-2 text-xs text-white/55">
                <span>Рандомайзер</span>
                <span className="rounded-lg border border-[#d7b55a]/30 bg-[#d7b55a]/10 px-2 py-0.5 text-sm font-semibold tabular-nums text-[#e4c97a]">
                  {question.randomizerPercent}
                </span>
              </span>
            </TrainerDecisionHeader>
            <TrainerActionButtons
              actions={question.actions}
              columnsClass={solverActionGridColumnsClass(question.actions.length)}
              reveal={reveal}
              mixedTone={feedback?.tone === "mixed"}
              disabled={pending}
              onAnswer={(action) => void handleAnswer(action)}
            />
          </>
        ) : (
          <p className="mt-10 text-center text-sm text-white/50">{error ? "" : "Готовим раздачу..."}</p>
        )}

        {feedback ? <TrainerFeedbackPanel {...feedback} /> : null}

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
          <button
            type="button"
            onClick={handleNext}
            disabled={saveState === "saving"}
            className={`mt-5 ${TRAINER_PRIMARY_BUTTON_CLASS}`}
          >
            {saveState === "saving"
              ? "Сохраняем..."
              : isLastQuestion ? "Посмотреть результат" : "Следующая рука"}
          </button>
        ) : null}
      </div>
    </main>
  );
}
