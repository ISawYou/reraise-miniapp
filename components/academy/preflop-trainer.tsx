"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AcademyPlayingCard } from "@/components/academy/academy-playing-card";
import { solverActionGridColumnsClass } from "@/components/academy/solver-training";
import {
  ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
  ACADEMY_SOLVER_PREFLOP_TRAINER_ROUTE,
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

/**
 * Configurable preflop trainer session. Questions come from
 * `/api/academy/solver/preflop/session` (no frequencies / resolved action),
 * the reveal only after answering, and the score is recomputed server-side
 * from the selected actions. All attempts record under the one
 * `solver_preflop_trainer` lesson code; the node travels inside each answer.
 */
export function PreflopTrainer({ selection }: { selection: PreflopTrainerSelection }) {
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const [attemptId, setAttemptId] = useState<string>(makeAttemptId);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [question, setQuestion] = useState<AcademyPreflopTrainerPublicQuestion | null>(null);
  const [reveal, setReveal] = useState<AcademyPreflopTrainerReveal | null>(null);
  const [answers, setAnswers] = useState<AcademyPreflopTrainerAnswer[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AcademyTrainingResult | null>(null);
  const [updatedProgress, setUpdatedProgress] = useState<AcademyLessonProgress | null>(null);
  const [newBest, setNewBest] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const { datasetId, nodeKey, stackBb } = selection;
  const spotRoute = preflopTrainerSpotRoute(stackBb, nodeKey);

  const loadQuestion = useCallback(async (currentAttemptId: string, index: number) => {
    setPending(true);
    setError(null);
    try {
      setQuestion(await postJson<AcademyPreflopTrainerPublicQuestion>("/api/academy/solver/preflop/session", {
        datasetId,
        nodeKey,
        attemptId: currentAttemptId,
        questionIndex: index,
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить вопрос");
    } finally {
      setPending(false);
    }
  }, [datasetId, nodeKey]);

  useEffect(() => {
    if (hydrated) void loadQuestion(attemptId, questionIndex);
  }, [hydrated, attemptId, questionIndex, loadQuestion]);

  async function handleAnswer(selectedAction: AcademySolverAction) {
    if (!question || reveal || pending) return;
    setPending(true);
    setError(null);
    try {
      const revealed = await postJson<AcademyPreflopTrainerReveal>("/api/academy/solver/preflop/reveal", {
        datasetId,
        nodeKey,
        attemptId,
        questionIndex,
        selectedAction,
      });
      setReveal(revealed);
      setAnswers((current) => [...current, { questionIndex, selectedAction, datasetId, nodeKey }]);
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : "Не удалось проверить ответ");
    } finally {
      setPending(false);
    }
  }

  async function submitAttempt(completedAnswers: readonly AcademyPreflopTrainerAnswer[]) {
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
        <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center">
          <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${result.passed ? "text-[#90c9a8]" : "text-[#d7b55a]"}`}>
            {result.passed ? "Спот пройден" : "Продолжим тренировку"}
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Тренировка завершена</h1>
          <p className="mt-3 text-lg text-white/60">{result.feedback}</p>

          <div className="mt-8 rounded-[28px] border border-white/10 bg-white/[0.055] p-6 text-center">
            <p className="text-5xl font-bold tracking-tight">
              {result.correctAnswers} <span className="text-white/25">/</span> {result.totalQuestions}
            </p>
            <p className={`mt-3 text-xl font-semibold ${result.passed ? "text-[#90c9a8]" : "text-[#e0c477]"}`}>
              {result.percentage}%
            </p>
            {newBest ? <p className="mt-2 text-sm text-[#d7b55a]">Новый лучший результат</p> : null}
            {updatedProgress ? (
              <p className="mt-2 text-xs text-white/40">Попыток в тренажёре: {updatedProgress.attemptsCount}</p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={restart}
            className="mt-7 min-h-14 rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f]"
          >
            Пройти ещё раз
          </button>
          <Link
            href={spotRoute}
            className="mt-3 flex min-h-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-4 text-base font-medium text-white/70"
          >
            Посмотреть диапазон
          </Link>
          <Link
            href={ACADEMY_SOLVER_PREFLOP_TRAINER_ROUTE}
            className="mt-3 flex min-h-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-4 text-base font-medium text-white/70"
          >
            Выбрать другой спот
          </Link>
        </div>
      </main>
    );
  }

  const feedback = reveal ? buildSolverAnswerFeedback(reveal, ACADEMY_NEUTRAL_FEEDBACK_WORDING) : null;
  const isLastQuestion = questionIndex === ACADEMY_TRAINING_QUESTION_COUNT - 1;
  const spot = question?.spot;

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d,#070707)] px-4 py-6 pb-32 text-white">
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={ACADEMY_SOLVER_PREFLOP_TRAINER_ROUTE}
            className="inline-flex items-center rounded-full border border-white/[0.08] px-3.5 py-2 text-sm text-white/65"
          >
            ← К выбору спота
          </Link>
          <p className="text-sm text-white/50">
            {questionIndex + 1} из {ACADEMY_TRAINING_QUESTION_COUNT}
          </p>
        </div>

        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full bg-[#568b70] transition-[width] duration-300"
            style={{ width: `${((questionIndex + 1) / ACADEMY_TRAINING_QUESTION_COUNT) * 100}%` }}
          />
        </div>

        {question && spot ? (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-2 text-xs" data-testid="spot-facts">
              <span className="rounded-full border border-[#d7b55a]/30 bg-[#d7b55a]/10 px-2.5 py-1 font-semibold text-[#e4c97a]">
                Стек {spot.stackBb} BB
              </span>
              <span className="rounded-full border border-white/10 px-2.5 py-1 text-white/70">Ты: {spot.heroPosition}</span>
              {spot.villainPosition ? (
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-white/70">Соперник: {spot.villainPosition}</span>
              ) : null}
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">{spot.title}</h1>
            <p className="mt-1 text-sm text-white/55">{spot.history}</p>

            <div className="mt-6 flex justify-center gap-3" aria-label={`Рука ${question.hand}`}>
              <AcademyPlayingCard card={question.renderedCards[0]} />
              <AcademyPlayingCard card={question.renderedCards[1]} />
            </div>
            <p className="mt-3 text-center text-sm font-medium text-white/45">{question.hand}</p>

            <div className="mt-5 flex items-center justify-center gap-2 text-sm text-white/60">
              <span>Рандомайзер</span>
              <span className="rounded-lg border border-[#d7b55a]/30 bg-[#d7b55a]/10 px-2.5 py-1 font-semibold tabular-nums text-[#e4c97a]">
                {question.randomizerPercent}
              </span>
            </div>
            <p className="mt-2 text-center text-xs text-white/40">
              Сыграй по частотам стратегии: рандомайзер выбирает, какая часть смешанной стратегии выпала.
            </p>

            <div
              className={`mt-6 grid ${solverActionGridColumnsClass(question.actions.length)} gap-3`}
              data-action-count={question.actions.length}
            >
              {question.actions.map((action) => {
                const isSelected = reveal?.selectedAction === action.code;
                const isResolved = reveal?.resolvedAction === action.code;
                return (
                  <button
                    key={action.code}
                    type="button"
                    data-action-code={action.code}
                    disabled={Boolean(reveal) || pending}
                    onClick={() => void handleAnswer(action.code)}
                    className={`min-h-16 min-w-0 break-words rounded-2xl border px-3 py-4 text-base font-semibold transition-colors disabled:cursor-default ${
                      reveal
                        ? isResolved
                          ? "border-[#72b28e] bg-[#315f48] text-white"
                          : isSelected
                            ? feedback?.tone === "mixed"
                              ? "border-[#d7b55a]/60 bg-[#d7b55a]/15 text-white"
                              : "border-[#b95b5f] bg-[#5b292c] text-white"
                            : "border-white/10 bg-white/[0.045] text-white/45"
                        : "border-white/10 bg-white/[0.045] text-white/75"
                    }`}
                  >
                    {solverActionButtonLabel(action)}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <p className="mt-10 text-center text-sm text-white/50">{error ? "" : "Готовим раздачу..."}</p>
        )}

        {feedback ? (
          <section className={`mt-5 rounded-[22px] border p-4 ${
            feedback.tone === "correct"
              ? "border-[#5f9a77]/35 bg-[#315f48]/20"
              : feedback.tone === "mixed"
                ? "border-[#d7b55a]/30 bg-[#d7b55a]/10"
                : "border-[#b95b5f]/30 bg-[#5b292c]/20"
          }`} data-feedback-tone={feedback.tone}>
            <p className={`text-lg font-semibold ${
              feedback.tone === "correct"
                ? "text-[#9dd2b3]"
                : feedback.tone === "mixed" ? "text-[#e4c97a]" : "text-[#e0a4a6]"
            }`}>
              {feedback.title}
            </p>
            <p className="mt-2 text-sm font-medium text-white/80">{feedback.summary}</p>
            <p className="mt-2 text-sm leading-5 text-white/55">{feedback.detail}</p>
          </section>
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
          <button
            type="button"
            onClick={handleNext}
            disabled={saveState === "saving"}
            className="mt-5 min-h-14 w-full rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f]"
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
