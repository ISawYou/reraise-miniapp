"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AcademyPlayingCard } from "@/components/academy/academy-playing-card";
import { getAcademyPreflopLesson } from "@/config/academy/lessons";
import { getAcademySolverRfiLesson } from "@/config/academy/solver-lessons";
import { ACADEMY_TRAINING_QUESTION_COUNT } from "@/config/academy/training";
import { buildSolverAnswerFeedback, solverActionButtonLabel } from "@/lib/academy/solver-feedback";
import type {
  AcademyLessonProgress,
  AcademySolverAction,
  AcademySolverAnswer,
  AcademySolverPublicQuestion,
  AcademySolverQuestionReveal,
  AcademyTrainingResult,
  PreflopPosition,
} from "@/types/academy";

type SubmitAttemptResponse = {
  result: AcademyTrainingResult;
  progress: AcademyLessonProgress;
  isNewAttempt: boolean;
  firstPass: boolean;
  newBest: boolean;
};

/**
 * Action-button grid columns by action count: 2 → one row of two (the
 * original 100bb layout), 3 → one row of three, 4+ → rows of two.
 */
export function solverActionGridColumnsClass(actionCount: number): string {
  return actionCount === 3 ? "grid-cols-3" : "grid-cols-2";
}

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
 * Solver Lab trainer. Every question comes from the server
 * (`/api/academy/solver/session`); the client never sees frequencies or the
 * resolved action until it has answered (`/api/academy/solver/reveal`), and
 * the final score is recomputed server-side from the selected actions only.
 */
export function SolverTraining({ position }: { position: PreflopPosition }) {
  const copy = getAcademyPreflopLesson(position);
  const solverLesson = getAcademySolverRfiLesson(position);
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const [attemptId, setAttemptId] = useState<string>(makeAttemptId);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [question, setQuestion] = useState<AcademySolverPublicQuestion | null>(null);
  const [reveal, setReveal] = useState<AcademySolverQuestionReveal | null>(null);
  const [answers, setAnswers] = useState<AcademySolverAnswer[]>([]);
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
      setQuestion(await postJson<AcademySolverPublicQuestion>("/api/academy/solver/session", {
        lessonCode: solverLesson.code,
        attemptId: currentAttemptId,
        questionIndex: index,
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить вопрос");
    } finally {
      setPending(false);
    }
  }, [solverLesson.code]);

  useEffect(() => {
    if (hydrated) void loadQuestion(attemptId, questionIndex);
  }, [hydrated, attemptId, questionIndex, loadQuestion]);

  async function handleAnswer(selectedAction: AcademySolverAction) {
    if (!question || reveal || pending) return;
    setPending(true);
    setError(null);
    try {
      const revealed = await postJson<AcademySolverQuestionReveal>("/api/academy/solver/reveal", {
        lessonCode: solverLesson.code,
        attemptId,
        questionIndex,
        selectedAction,
      });
      setReveal(revealed);
      setAnswers((current) => [...current, { questionIndex, selectedAction }]);
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : "Не удалось проверить ответ");
    } finally {
      setPending(false);
    }
  }

  async function submitAttempt(completedAnswers: readonly AcademySolverAnswer[]) {
    setSaveState("saving");
    setError(null);
    try {
      const payload = await postJson<SubmitAttemptResponse>("/api/academy/attempts", {
        attemptId,
        lessonCode: solverLesson.code,
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
      <main className="min-h-screen bg-[radial-gradient(circle_at_50%_12%,rgba(76,116,95,0.22),transparent_36%),linear-gradient(180deg,#09100d,#070707)] px-4 py-6 pb-32 text-white">
        <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center">
          <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${result.passed ? "text-[#90c9a8]" : "text-[#d7b55a]"}`}>
            {result.passed ? "Урок пройден" : "Продолжим тренировку"}
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
              <p className="mt-2 text-xs text-white/40">Попыток: {updatedProgress.attemptsCount}</p>
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
            href={solverLesson.route}
            className="mt-3 flex min-h-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-4 text-base font-medium text-white/70"
          >
            Вернуться к уроку
          </Link>
        </div>
      </main>
    );
  }

  const feedback = reveal ? buildSolverAnswerFeedback(reveal) : null;
  const isLastQuestion = questionIndex === ACADEMY_TRAINING_QUESTION_COUNT - 1;

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_90%_30%_at_50%_-5%,rgba(76,116,95,0.2),transparent_65%),linear-gradient(180deg,#09100d,#070707)] px-4 py-6 pb-32 text-white">
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={solverLesson.route}
            className="inline-flex items-center rounded-full border border-white/[0.08] px-3.5 py-2 text-sm text-white/65"
          >
            ← К уроку
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

        <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b55a]">
          Solver Lab · {copy.displayLabel} · RFI
        </p>

        {question ? (
          <>
            <div className="mt-7 flex justify-center gap-3" aria-label={`Рука ${question.hand}`}>
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

            <div className="mt-6 text-center">
              <h1 className="text-2xl font-semibold tracking-tight">Ты первый входишь в банк</h1>
              <p className="mt-2 text-sm text-white/50">
                Сыграй по частотам: рейз, если рандомайзер ниже частоты рейза.
              </p>
            </div>

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
                    className={`min-h-16 min-w-0 break-words rounded-2xl border px-4 py-4 text-base font-semibold transition-colors disabled:cursor-default ${
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
          }`}>
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
