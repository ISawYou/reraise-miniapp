import Link from "next/link";
import { AcademyPageHeader } from "@/components/academy/academy-page-header";
import { PushFoldAttribution } from "@/components/academy/push-fold-attribution";
import {
  ACADEMY_HOME_ROUTE,
  requireAcademyDestination,
  requireAcademyTrainerEntry,
  type AcademyTrainerEntry,
} from "@/config/academy/navigation";

const destination = requireAcademyDestination("trainers");

/** The whole card is the link; the CTA is a visual label inside it (one tap, no extra page). */
function TrainerCard({ entry, primary = false }: { entry: AcademyTrainerEntry; primary?: boolean }) {
  return (
    <Link
      href={entry.route}
      data-trainer-entry={entry.code}
      data-trainer-link={entry.code}
      data-trainer-kind={entry.kind}
      data-practice-code={entry.practiceLessonCode}
      className={primary
        ? "block rounded-[28px] border border-[#d7b55a]/35 bg-[radial-gradient(ellipse_90%_70%_at_100%_0%,rgba(215,181,90,0.16),transparent_70%),rgba(255,255,255,0.045)] p-5 active:bg-white/[0.07]"
        : "mt-3 flex items-center gap-3 rounded-[22px] border border-white/10 bg-white/[0.045] px-4 py-4 active:bg-white/[0.08]"}
    >
      {primary ? (
        <>
          <span className="block text-2xl font-bold tracking-tight">{entry.title}</span>
          <span className="mt-1 block text-sm leading-5 text-white/65">{entry.description}</span>
          <span className="mt-4 flex min-h-14 items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f]">
            {entry.cta}
          </span>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold leading-6">{entry.title}</span>
            <span className="mt-0.5 block text-sm leading-5 text-white/55">{entry.description}</span>
          </span>
          <span className="shrink-0 text-right text-xs font-semibold text-[#e4c97a]">
            {entry.cta} <span aria-hidden="true" className="text-white/40">→</span>
          </span>
        </>
      )}
    </Link>
  );
}

/**
 * "Тренажёры": three choices, readable at a glance. "Быстрая тренировка"
 * starts the Preflop Quick Mix session directly (its route IS the running
 * session). "Выбрать ситуацию" opens the manual picker. "Короткий стек" is the
 * non-scored Push/Fold reference (docs/ACADEMY_PUSH_FOLD_AUDIT.md). Every card
 * links to an EXISTING route — no trainer is re-implemented here.
 */
export default function AcademyTrainersPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_45%,#070707_100%)] px-4 py-6 pb-40 text-white">
      <div className="mx-auto max-w-md">
        <AcademyPageHeader backHref={ACADEMY_HOME_ROUTE} backLabel="Академия" eyebrow={destination.title} title="Практика за столом" />

        <section className="mt-6" aria-label="Префлоп">
          <TrainerCard entry={requireAcademyTrainerEntry("quick-mix")} primary />
          <TrainerCard entry={requireAcademyTrainerEntry("setup")} />
        </section>

        <section className="mt-3" aria-label="Короткий стек">
          <TrainerCard entry={requireAcademyTrainerEntry("push-fold-reference")} />
        </section>

        <PushFoldAttribution className="mt-8" />
      </div>
    </main>
  );
}
