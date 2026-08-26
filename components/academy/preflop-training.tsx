"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { getAcademyPreflopLesson } from "@/config/academy/lessons";
import { getAcademyPreflopRange } from "@/config/academy/preflop-ranges";
import { ACADEMY_TRAINING_QUESTION_COUNT } from "@/config/academy/training";
import {
  createTrainingSession,
  evaluateTrainingAnswer,
  scoreTrainingSession,
} from "@/lib/academy/training";
import type {
  AcademyLessonProgress,
  AcademyTrainingAnswer,
  AcademyTrainingResult,
  AcademyTrainingSession,
  PreflopAction,
  PreflopPosition,
  RenderedPlayingCard,
} from "@/types/academy";

type SubmitAttemptResponse = {
  result: AcademyTrainingResult;
  progress: AcademyLessonProgress;
  isNewAttempt: boolean;
  firstPass: boolean;
  newBest: boolean;
};

type PreflopTrainingProps = {
  position: PreflopPosition;
};

function makeSession(position: PreflopPosition): AcademyTrainingSession {
  return createTrainingSession({
    position,
    referenceStrategy: getAcademyPreflopRange(position).referenceStrategy,
  });
}

function makeAttemptId(): string {
  return globalThis.crypto.randomUUID();
}

function subscribeToHydration() {
  return () => undefined;
}

// Presentation-only: the card face shows "10", not the internal "T" rank
// notation. Every other use of HandRank (hand strings, range keys, the
// sampler, scoring) is untouched -- only what's printed on this glyph changes.
function displayRank(rank: RenderedPlayingCard["rank"]): string {
  return rank === "T" ? "10" : rank;
}

function PlayingCard({ card }: { card: RenderedPlayingCard }) {
  return (
    <div
      className={`flex h-28 w-20 flex-col justify-between rounded-2xl border border-black/10 bg-[#f3f0e8] p-3 shadow-[0_14px_30px_rgba(0,0,0,0.3)] ${
        card.color === "red" ? "text-[#b52f32]" : "text-[#171a18]"
      }`}
    >
      <span className="text-2xl font-bold leading-none">{displayRank(card.rank)}</span>
      <span className="self-end text-4xl leading-none">{card.suit}</span>
    </div>
  );
}

export function PreflopTraining({ position }: PreflopTrainingProps) {
  const lesson = getAcademyPreflopLesson(position);
  const lessonHref = `/academy/preflop/${position.toLowerCase()}`;
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const [session, setSession] = useState<AcademyTrainingSession>(() => makeSession(position));
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedAction, setSelectedAction] = useState<PreflopAction | null>(null);
  const [correctAnswers, setCorrectAnswers] = useState(0);
  const [result, setResult] = useState<AcademyTrainingResult | null>(null);
  const [answers, setAnswers] = useState<AcademyTrainingAnswer[]>([]);
  const [attemptId, setAttemptId] = useState(makeAttemptId);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [localCompletedResult, setLocalCompletedResult] = useState<AcademyTrainingResult | null>(null);
  const [updatedProgress, setUpdatedProgress] = useState<AcademyLessonProgress | null>(null);
  const [newBest, setNewBest] = useState(false);

  function restartTraining() {
    setSession(makeSession(position));
    setQuestionIndex(0);
    setSelectedAction(null);
    setCorrectAnswers(0);
    setResult(null);
    setAnswers([]);
    setAttemptId(makeAttemptId());
    setSaveState("idle");
    setSaveError(null);
    setLocalCompletedResult(null);
    setUpdatedProgress(null);
    setNewBest(false);
  }

  async function saveCompletedAttempt(completedAnswers: readonly AcademyTrainingAnswer[]) {
    setSaveState("saving");
    setSaveError(null);

    try {
      const response = await fetch("/api/academy/attempts", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attemptId,
          lessonCode: lesson.code,
          questions: completedAnswers,
        }),
      });
      const payload = await response.json() as SubmitAttemptResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить результат");

      setResult(payload.result);
      setUpdatedProgress(payload.progress);
      setNewBest(payload.newBest);
      setSaveState("saved");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить результат");
      setSaveState("error");
    }
  }

  if (!hydrated) {
    return (
      <main className="min-h-screen bg-[#08100c] px-4 py-6 pb-32 text-white">
        <div className="mx-auto max-w-md text-sm text-white/55">Готовим тренировку...</div>
      </main>
    );
  }

  const displayedResult = result ?? localCompletedResult;
  if (displayedResult) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_50%_12%,rgba(76,116,95,0.22),transparent_36%),linear-gradient(180deg,#09100d,#070707)] px-4 py-6 pb-32 text-white">
        <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center">
          <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${displayedResult.passed ? "text-[#90c9a8]" : "text-[#d7b55a]"}`}>
            {displayedResult.passed ? "Урок пройден" : "Продолжим тренировку"}
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Тренировка завершена</h1>
          <p className="mt-3 text-lg text-white/60">{displayedResult.feedback}</p>

          <div className="mt-8 rounded-[28px] border border-white/10 bg-white/[0.055] p-6 text-center">
            <p className="text-5xl font-bold tracking-tight">
              {displayedResult.correctAnswers} <span className="text-white/25">/</span> {displayedResult.totalQuestions}
            </p>
            <p className={`mt-3 text-xl font-semibold ${displayedResult.passed ? "text-[#90c9a8]" : "text-[#e0c477]"}`}>
              {displayedResult.percentage}%
            </p>
            {newBest ? <p className="mt-2 text-sm text-[#d7b55a]">Новый лучший результат</p> : null}
            {updatedProgress ? (
              <p className="mt-2 text-xs text-white/40">Попыток: {updatedProgress.attemptsCount}</p>
            ) : null}
          </div>

          {saveState === "saving" ? (
            <p className="mt-4 text-center text-sm text-white/45">Сохраняем результат...</p>
          ) : null}

          {saveState === "error" ? (
            <div className="mt-5 rounded-2xl border border-[#b95b5f]/30 bg-[#5b292c]/20 p-4">
              <p className="text-sm font-medium text-[#e0a4a6]">
                Тренировка завершена, но результат не удалось сохранить.
              </p>
              <p className="mt-1 text-xs text-white/45">{saveError}</p>
              <button
                type="button"
                onClick={() => void saveCompletedAttempt(answers)}
                className="mt-3 rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-white/75"
              >
                Повторить сохранение
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={restartTraining}
            className="mt-7 min-h-14 rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f]"
          >
            Пройти ещё раз
          </button>
          <Link
            href={lessonHref}
            className="mt-3 flex min-h-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-4 text-base font-medium text-white/70"
          >
            Вернуться к уроку
          </Link>
        </div>
      </main>
    );
  }

  const question = session.questions[questionIndex];
  const isAnswered = selectedAction !== null;
  const isCorrect = selectedAction !== null
    ? evaluateTrainingAnswer(question, selectedAction)
    : false;
  const isLastQuestion = questionIndex === session.questions.length - 1;
  const isBorderline = question.bucket === "OPEN_BOUNDARY" || question.bucket === "FOLD_BOUNDARY";

  function handleAnswer(action: PreflopAction) {
    if (isAnswered) return;
    setSelectedAction(action);
    setAnswers((currentAnswers) => [
      ...currentAnswers,
      { hand: question.hand, selectedAction: action },
    ]);
    if (evaluateTrainingAnswer(question, action)) {
      setCorrectAnswers((count) => count + 1);
    }
  }

  function handleNext() {
    if (!isAnswered) return;
    if (isLastQuestion) {
      setLocalCompletedResult(scoreTrainingSession(correctAnswers, session.questions.length));
      void saveCompletedAttempt(answers);
      return;
    }
    setQuestionIndex((index) => index + 1);
    setSelectedAction(null);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_90%_30%_at_50%_-5%,rgba(76,116,95,0.2),transparent_65%),linear-gradient(180deg,#09100d,#070707)] px-4 py-6 pb-32 text-white">
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={lessonHref}
            className="inline-flex items-center rounded-full border border-white/[0.08] px-3.5 py-2 text-sm text-white/65"
          >
            ← К уроку
          </Link>
          <p className="text-sm text-white/50">
            {questionIndex + 1} из {session.questions.length}
          </p>
        </div>

        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full bg-[#568b70] transition-[width] duration-300"
            style={{ width: `${((questionIndex + 1) / ACADEMY_TRAINING_QUESTION_COUNT) * 100}%` }}
          />
        </div>

        <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b55a]">
          {lesson.displayLabel} · Open Raise
        </p>

        <div className="mt-7 flex justify-center gap-3" aria-label={`Рука ${question.hand}`}>
          <PlayingCard card={question.cards[0]} />
          <PlayingCard card={question.cards[1]} />
        </div>
        <p className="mt-3 text-center text-sm font-medium text-white/45">{question.hand}</p>

        <div className="mt-7 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Ты первый входишь в банк</h1>
          <p className="mt-2 text-sm text-white/50">Что делаешь?</p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          {(["OPEN", "FOLD"] as const).map((action) => {
            const isSelected = selectedAction === action;
            return (
              <button
                key={action}
                type="button"
                disabled={isAnswered}
                onClick={() => handleAnswer(action)}
                className={`min-h-16 rounded-2xl border px-4 py-4 text-base font-semibold transition-colors disabled:cursor-default ${
                  isSelected
                    ? action === question.correctAction
                      ? "border-[#72b28e] bg-[#315f48] text-white"
                      : "border-[#b95b5f] bg-[#5b292c] text-white"
                    : isAnswered && action === question.correctAction
                      ? "border-[#72b28e]/60 bg-[#315f48]/55 text-white"
                      : "border-white/10 bg-white/[0.045] text-white/75"
                }`}
              >
                {action === "OPEN" ? "Открыть" : "Фолд"}
              </button>
            );
          })}
        </div>

        {isAnswered ? (
          <section className={`mt-5 rounded-[22px] border p-4 ${
            isCorrect
              ? "border-[#5f9a77]/35 bg-[#315f48]/20"
              : "border-[#b95b5f]/30 bg-[#5b292c]/20"
          }`}>
            <p className={`text-lg font-semibold ${isCorrect ? "text-[#9dd2b3]" : "text-[#e0a4a6]"}`}>
              {isCorrect ? "Верно" : "Не совсем"}
            </p>
            <p className="mt-2 text-sm font-medium text-white/80">
              Базовое действие: {question.correctAction === "OPEN" ? "Открыть" : "Фолд"}
            </p>
            <p className="mt-2 text-sm leading-5 text-white/55">
              {question.correctAction === "OPEN"
                ? "Эта рука входит в базовый учебный диапазон открытия с этой позиции."
                : "Эта рука не входит в базовый учебный диапазон открытия с этой позиции."}
            </p>
            {isBorderline ? (
              <p className="mt-3 border-t border-white/[0.07] pt-3 text-xs leading-5 text-white/42">
                Это пограничная рука. Solver-backed стратегия может использовать смешанное
                решение, а в Academy мы упрощаем его до одного базового действия.
              </p>
            ) : null}
          </section>
        ) : null}

        {isAnswered ? (
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
