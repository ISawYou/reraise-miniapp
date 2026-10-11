"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PushFoldAttribution } from "@/components/academy/push-fold-attribution";
import {
  TRAINER_PRIMARY_BUTTON_CLASS,
  TrainerActionButtons,
  TrainerCompletionScreen,
  type TrainerCompletionLink,
  TrainerDecisionHeader,
  TrainerFeedbackPanel,
  TrainerHandScene,
  TrainerNextBar,
  type TrainerReviewEntry,
  TrainerSessionTopBar,
  TrainerSpotContext,
} from "@/components/academy/trainer-session-ui";
import { ACADEMY_PUSH_FOLD_SETUP_ROUTE, ACADEMY_TRAINERS_ROUTE } from "@/config/academy/navigation-routes";
import {
  ACADEMY_PUSH_FOLD_QUICK_MODE,
  ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE,
  pushFoldSpotRoute,
} from "@/config/academy/push-fold-trainer";
import { ACADEMY_TRAINING_QUESTION_COUNT } from "@/config/academy/training";
import { buildPushFoldFeedback } from "@/lib/academy/push-fold-copy";
import { solverActionButtonLabel } from "@/lib/academy/solver-feedback";
import type {
  AcademyLessonProgress,
  AcademyPushFoldAnswer,
  AcademyPushFoldPublicQuestion,
  AcademyPushFoldReveal,
  AcademySolverAction,
  AcademyTrainingResult,
} from "@/types/academy";

type SubmitAttemptResponse = {
  result: AcademyTrainingResult;
  progress: AcademyLessonProgress;
  newBest: boolean;
};

export type PushFoldTrainerSelection = {
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

type SessionSource = {
  readonly sessionUrl: string;
  readonly revealUrl: string;
  readonly questionBody: (attemptId: string, questionIndex: number) => Record<string, unknown>;
  readonly revealBody: (attemptId: string, questionIndex: number, selectedAction: AcademySolverAction) => Record<string, unknown>;
  readonly toAnswer: (questionIndex: number, selectedAction: AcademySolverAction, question: AcademyPushFoldPublicQuestion) => AcademyPushFoldAnswer;
  /** In-session and completion "back": where this session was started from. */
  readonly back: { readonly href: string; readonly label: string };
  readonly eyebrow?: string;
  readonly passedLabel: string;
  /** Optional completion links after "Пройти ещё раз" / "К тренажёрам". */
  readonly resultLinks: readonly TrainerCompletionLink[];
};

const TRAINERS_LINK: TrainerCompletionLink = { href: ACADEMY_TRAINERS_ROUTE, label: "К тренажёрам", testId: "trainers" };

/**
 * Review entry, built from the server's reveal: only answers the strategy
 * never plays (server outcome `NOT_IN_STRATEGY`) are listed — the same rule as
 * the preflop trainer.
 */
export function pushFoldReviewEntry(reveal: AcademyPushFoldReveal): TrainerReviewEntry | null {
  if (reveal.outcome !== "NOT_IN_STRATEGY") return null;
  const feedback = buildPushFoldFeedback(reveal);
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
    expectedLabel: "Правильно",
    expectedAnswer: label(reveal.resolvedAction),
    detail: feedback.detail,
  };
}

/** Fixed-node Push/Fold session: the node travels in every request and answer. */
export function PushFoldTrainer({ selection }: { selection: PushFoldTrainerSelection }) {
  const { datasetId, nodeKey, stackBb } = selection;
  const source = useMemo<SessionSource>(() => ({
    sessionUrl: "/api/academy/solver/push-fold/session",
    revealUrl: "/api/academy/solver/push-fold/reveal",
    questionBody: (attemptId, questionIndex) => ({ datasetId, nodeKey, attemptId, questionIndex }),
    revealBody: (attemptId, questionIndex, selectedAction) => ({ datasetId, nodeKey, attemptId, questionIndex, selectedAction }),
    toAnswer: (questionIndex, selectedAction) => ({ questionIndex, selectedAction, datasetId, nodeKey }),
    back: { href: ACADEMY_PUSH_FOLD_SETUP_ROUTE, label: "К выбору ситуации" },
    passedLabel: "Спот пройден",
    resultLinks: [
      { href: ACADEMY_PUSH_FOLD_SETUP_ROUTE, label: "Выбрать другую ситуацию", testId: "setup" },
      { href: pushFoldSpotRoute(stackBb, nodeKey), label: "Посмотреть диапазон", testId: "range" },
    ],
  }), [datasetId, nodeKey, stackBb]);
  return <PushFoldSession source={source} />;
}

/**
 * "Быстрая Push/Fold тренировка": the client never names a node — requests
 * carry only attemptId + questionIndex; answers echo the server-served node
 * (re-checked by the verifier) and are marked PUSH_FOLD_QUICK.
 */
export function PushFoldQuickMix() {
  const source = useMemo<SessionSource>(() => ({
    sessionUrl: "/api/academy/solver/push-fold/mix/session",
    revealUrl: "/api/academy/solver/push-fold/mix/reveal",
    questionBody: (attemptId, questionIndex) => ({ attemptId, questionIndex }),
    revealBody: (attemptId, questionIndex, selectedAction) => ({ attemptId, questionIndex, selectedAction }),
    toAnswer: (questionIndex, selectedAction, question) => ({
      questionIndex,
      selectedAction,
      datasetId: question.spot.datasetId,
      nodeKey: question.spot.nodeKey,
      mode: ACADEMY_PUSH_FOLD_QUICK_MODE,
    }),
    back: { href: ACADEMY_TRAINERS_ROUTE, label: "Тренажёры" },
    eyebrow: "Push/Fold",
    passedLabel: "Тренировка пройдена",
    resultLinks: [{ href: ACADEMY_PUSH_FOLD_SETUP_ROUTE, label: "Настроить ситуацию", testId: "setup" }],
  }), []);
  return <PushFoldSession source={source} />;
}

function PushFoldSession({ source }: { source: SessionSource }) {
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const [attemptId, setAttemptId] = useState<string>(makeAttemptId);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [question, setQuestion] = useState<AcademyPushFoldPublicQuestion | null>(null);
  const [reveal, setReveal] = useState<AcademyPushFoldReveal | null>(null);
  const [answers, setAnswers] = useState<AcademyPushFoldAnswer[]>([]);
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
      setQuestion(await postJson<AcademyPushFoldPublicQuestion>(source.sessionUrl, source.questionBody(currentAttemptId, index)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить вопрос");
    } finally {
      setPending(false);
    }
  }, [source]);

  useEffect(() => {
    if (hydrated) void loadQuestion(attemptId, questionIndex);
  }, [hydrated, attemptId, questionIndex, loadQuestion]);

  // New hand → back to the top (table fully below the Telegram top chrome).
  useEffect(() => {
    if (hydrated && typeof window.scrollTo === "function") window.scrollTo({ top: 0 });
  }, [hydrated, attemptId, questionIndex]);

  // After answering, show the compact feedback above the sticky next-step bar.
  useEffect(() => {
    const panel = feedbackRef.current;
    if (reveal && panel && typeof panel.scrollIntoView === "function") {
      panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [reveal]);

  async function handleAnswer(selectedAction: AcademySolverAction) {
    if (!question || reveal || pending) return;
    setPending(true);
    setError(null);
    try {
      const revealed = await postJson<AcademyPushFoldReveal>(source.revealUrl, source.revealBody(attemptId, questionIndex, selectedAction));
      setReveal(revealed);
      setAnswers((current) => [...current, source.toAnswer(questionIndex, selectedAction, question)]);
      const entry = pushFoldReviewEntry(revealed);
      if (entry) setReview((current) => [...current, entry]);
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : "Не удалось проверить ответ");
    } finally {
      setPending(false);
    }
  }

  async function submitAttempt(completedAnswers: readonly AcademyPushFoldAnswer[]) {
    setSaveState("saving");
    setError(null);
    try {
      const payload = await postJson<SubmitAttemptResponse>("/api/academy/attempts", {
        attemptId,
        lessonCode: ACADEMY_SOLVER_PUSH_FOLD_TRAINER_LESSON_CODE,
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
      <main className="min-h-screen bg-[#08100c] px-4 py-6 pb-40 text-white">
        <div className="mx-auto max-w-md text-sm text-white/55">Готовим тренировку...</div>
      </main>
    );
  }

  if (result) {
    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,#09100d,#070707)] px-4 py-6 pb-40 text-white">
        <TrainerCompletionScreen
          result={result}
          passedLabel={source.passedLabel}
          attemptsLabel={updatedProgress ? `Попыток в Push/Fold: ${updatedProgress.attemptsCount}` : null}
          newBest={newBest}
          onRestart={restart}
          back={source.back}
          trainers={TRAINERS_LINK}
          links={source.resultLinks}
          review={review}
          footer={<PushFoldAttribution className="mt-6" />}
        />
      </main>
    );
  }

  const spot = question?.spot;
  const feedback = reveal ? buildPushFoldFeedback(reveal) : null;
  const isLastQuestion = questionIndex === ACADEMY_TRAINING_QUESTION_COUNT - 1;

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d,#070707)] px-4 pb-40 pt-4 text-white">
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
            <TrainerSpotContext title={spot.title} history={spot.history} stackBb={spot.stackBb} tag={spot.situationLabel} />
            <TrainerHandScene scene={spot.scene} stackBb={spot.stackBb} cards={question.renderedCards} hand={question.hand} />
            <TrainerDecisionHeader hand={question.hand} />
            <TrainerActionButtons
              actions={question.actions}
              columnsClass="grid-cols-2"
              reveal={reveal}
              disabled={pending}
              onAnswer={(action) => void handleAnswer(action)}
            />
          </>
        ) : (
          <p className="mt-10 text-center text-sm text-white/50">{error ? "" : "Готовим раздачу..."}</p>
        )}

        {feedback ? (
          <TrainerFeedbackPanel
            key={questionIndex}
            ref={feedbackRef}
            tone={feedback.tone}
            title={feedback.title}
            summary={`${feedback.summary} ${feedback.detail}`}
          />
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
              className={TRAINER_PRIMARY_BUTTON_CLASS}
            >
              {saveState === "saving" ? "Сохраняем..." : isLastQuestion ? "Посмотреть результат" : "Следующая рука"}
            </button>
          </TrainerNextBar>
        ) : null}

        <PushFoldAttribution className="mt-8" />
      </div>
    </main>
  );
}
