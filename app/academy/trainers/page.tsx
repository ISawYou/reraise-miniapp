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

function PrimaryTrainer({ entry }: { entry: AcademyTrainerEntry }) {
  return (
    <section
      data-trainer-entry={entry.code}
      data-practice-code={entry.practiceLessonCode}
      className="rounded-[28px] border border-[#d7b55a]/35 bg-[radial-gradient(ellipse_90%_70%_at_100%_0%,rgba(215,181,90,0.16),transparent_70%),rgba(255,255,255,0.045)] p-5"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d7b55a]">Без настройки</p>
      <h2 className="mt-2 text-2xl font-bold tracking-tight">{entry.title}</h2>
      <p className="mt-2 text-sm leading-6 text-white/65">{entry.description}</p>
      <Link
        href={entry.route}
        data-trainer-link={entry.code}
        className="mt-5 flex min-h-14 items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f] active:bg-[#e2c66f]"
      >
        {entry.cta}
      </Link>
    </section>
  );
}

function SecondaryTrainer({ entry }: { entry: AcademyTrainerEntry }) {
  return (
    <Link
      href={entry.route}
      data-trainer-entry={entry.code}
      data-trainer-link={entry.code}
      data-practice-code={entry.practiceLessonCode}
      className="mt-3 flex items-center gap-3 rounded-[22px] border border-white/10 bg-white/[0.045] px-4 py-4 active:bg-white/[0.08]"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-semibold leading-6">{entry.title}</span>
        <span className="mt-0.5 block text-sm leading-5 text-white/55">{entry.description}</span>
        <span className="mt-2 block text-xs font-semibold text-[#e4c97a]">{entry.cta}</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-xl text-white/40">→</span>
    </Link>
  );
}

/**
 * "Тренажёры": every way to practise, by goal. Each entry links to the
 * EXISTING trainer route (Quick Mix, the manual picker, Push/Fold) — no
 * trainer is re-implemented here.
 */
export default function AcademyTrainersPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_45%,#070707_100%)] px-4 py-6 pb-40 text-white">
      <div className="mx-auto max-w-md">
        <AcademyPageHeader backHref={ACADEMY_HOME_ROUTE} backLabel="Академия" eyebrow={destination.title} title="Практика за столом">
          <p>Тебе показывают раздачу — ты решаешь, как сыграть, и сразу видишь разбор.</p>
        </AcademyPageHeader>

        <section className="mt-6" aria-label="Префлоп">
          <PrimaryTrainer entry={requireAcademyTrainerEntry("quick-mix")} />
          <SecondaryTrainer entry={requireAcademyTrainerEntry("setup")} />
        </section>

        <section className="mt-8" aria-labelledby="trainers-short-stack">
          <h2 id="trainers-short-stack" className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
            Короткий стек
          </h2>
          <SecondaryTrainer entry={requireAcademyTrainerEntry("push-fold-quick")} />
          <SecondaryTrainer entry={requireAcademyTrainerEntry("push-fold-setup")} />
        </section>

        <PushFoldAttribution className="mt-8" />
      </div>
    </main>
  );
}
