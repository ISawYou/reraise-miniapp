import Link from "next/link";
import { PushFoldAttribution } from "@/components/academy/push-fold-attribution";
import { BackButton } from "@/components/ui/back-button";
import { ACADEMY_PUSH_FOLD_SETUP_ROUTE, ACADEMY_TRAINERS_ROUTE } from "@/config/academy/navigation-routes";
import { ACADEMY_SOLVER_PUSH_FOLD_ROUTE } from "@/config/academy/push-fold-trainer";
import {
  ACADEMY_PUSH_FOLD_NEXT_STEP_NOTE,
  ACADEMY_PUSH_FOLD_REFERENCE_NOTE,
  ACADEMY_PUSH_FOLD_REFERENCE_TITLE,
  ACADEMY_PUSH_FOLD_TRAINING_PAUSED_NOTE,
} from "@/lib/academy/push-fold-copy";

/**
 * Honest "reference, not scored" banner for every Push/Fold screen while no
 * dataset is validated for scored training (docs/ACADEMY_PUSH_FOLD_AUDIT.md).
 */
export function PushFoldReferenceNotice({ className = "" }: { className?: string }) {
  return (
    <section
      data-testid="push-fold-reference-notice"
      className={`rounded-2xl border border-[#d7b55a]/25 bg-[#d7b55a]/[0.07] px-4 py-3 ${className}`.trim()}
    >
      <p className="text-sm font-semibold text-[#e4c97a]">{ACADEMY_PUSH_FOLD_REFERENCE_TITLE}</p>
      <p className="mt-1 text-[13px] leading-5 text-white/60">{ACADEMY_PUSH_FOLD_REFERENCE_NOTE}</p>
    </section>
  );
}

/**
 * Bottom continuation of a NON-scored reference range page: pick another
 * range (back to the picker) or go to the scored trainers. Links only — it
 * starts no session, makes no request and records nothing.
 */
export function PushFoldReferenceNextStep({ className = "" }: { className?: string }) {
  return (
    <section data-testid="push-fold-next-step" className={`rounded-[22px] border border-white/[0.08] bg-white/[0.035] p-4 ${className}`.trim()}>
      <p className="text-base font-semibold">Что дальше?</p>
      <p className="mt-1 text-[13px] leading-5 text-white/55">{ACADEMY_PUSH_FOLD_NEXT_STEP_NOTE}</p>
      <Link
        href={ACADEMY_PUSH_FOLD_SETUP_ROUTE}
        data-testid="push-fold-choose-other"
        className="mt-4 flex min-h-14 items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f] active:bg-[#e2c66f]"
      >
        Выбрать другой диапазон
      </Link>
      <Link
        href={ACADEMY_TRAINERS_ROUTE}
        data-testid="push-fold-to-trainers"
        className="mt-2 flex min-h-12 items-center justify-center rounded-2xl px-5 py-3 text-sm font-medium text-white/65 active:bg-white/[0.05]"
      >
        К тренажёрам
      </Link>
    </section>
  );
}

/**
 * What the scored Push/Fold routes (`/push-fold/mix`, `/push-fold/<stack>/<node>/train`)
 * render while scored training is paused: no session is started, no request is
 * made, nothing is scored — just a clear way to the reference.
 */
export function PushFoldTrainingPaused({ rangeHref }: { rangeHref?: string }) {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_45%,#070707_100%)] px-4 py-6 pb-40 text-white">
      <div className="mx-auto max-w-md" data-testid="push-fold-training-paused">
        <BackButton href={ACADEMY_TRAINERS_ROUTE} label="Тренажёры" />
        <h1 className="mt-7 text-2xl font-bold tracking-tight">Тренировка Push/Fold на паузе</h1>
        <p className="mt-2 text-sm leading-6 text-white/60">{ACADEMY_PUSH_FOLD_TRAINING_PAUSED_NOTE}</p>
        <Link
          href={rangeHref ?? ACADEMY_SOLVER_PUSH_FOLD_ROUTE}
          data-testid="push-fold-paused-reference"
          className="mt-6 flex min-h-14 items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f] active:bg-[#e2c66f]"
        >
          {rangeHref ? "Посмотреть диапазон" : "Открыть справочник"}
        </Link>
        <PushFoldAttribution className="mt-8" />
      </div>
    </main>
  );
}
