import Link from "next/link";
import { notFound } from "next/navigation";
import { PokerPositionTable } from "@/components/academy/poker-position-table";
import { SolverActionMixGrid } from "@/components/academy/SolverActionMixGrid";
import { BackButton } from "@/components/ui/back-button";
import {
  ACADEMY_BEGINNER_AFTER_OPEN_LESSONS,
  ACADEMY_BEGINNER_TERMS,
  beginnerAfterOpenLessonRoute,
} from "@/config/academy/beginner-after-open";
import { ACADEMY_BEGINNER_ROUTE } from "@/config/academy/navigation-routes";
import { academyTrainingPresetForLesson, academyTrainingPresetRoute } from "@/config/academy/training-presets";
import { getBeginnerAfterOpenLessonView } from "@/lib/academy/beginner-after-open";

type BeginnerAfterOpenLessonPageProps = {
  params: Promise<{ lesson: string }>;
};

export function generateStaticParams() {
  return ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.map((lesson) => ({ lesson: lesson.slug }));
}

/**
 * "Новичкам · Шаг 2" lesson: short plain-language explanation of ONE real
 * node, the realistic table (stacks / chips / pot), a "Потренироваться"
 * deep link into the lesson's OWN ready-made training (config/academy/training-presets.ts:
 * the existing trainer route of that exact node, opened with the preset's
 * header and a "К уроку" back link), and the node's real range grid.
 */
export default async function BeginnerAfterOpenLessonPage({ params }: BeginnerAfterOpenLessonPageProps) {
  const { lesson: slug } = await params;
  const view = getBeginnerAfterOpenLessonView(slug);
  if (!view) notFound();

  const { lesson, main, compare, paragraphs, facts, terms, next } = view;
  const preset = academyTrainingPresetForLesson(lesson.slug);
  // The preset names this lesson's own node (pinned by a test); fall back to the plain node route.
  const practiceHref = preset ? academyTrainingPresetRoute(preset, "lesson") : main.practiceHref;
  const [lead, ...rest] = paragraphs;

  return (
    <main
      data-beginner-lesson={lesson.code}
      className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_36%,#070707_100%)] px-3 py-6 pb-28 text-white min-[375px]:px-4"
    >
      <div className="mx-auto max-w-md">
        <BackButton href={`${ACADEMY_BEGINNER_ROUTE}#step-2`} label="Новичкам" />

        <header className="mt-7">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b55a]">
            Шаг 2 · Урок {lesson.order} из {ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.length}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{lesson.title}</h1>
          <p className="mt-2 text-sm text-white/55" data-testid="lesson-history">
            {main.spot.history} · стек {main.spot.stackBb} BB
          </p>
        </header>

        <section className="mt-5" data-testid="lesson-table">
          <PokerPositionTable
            mode="TRAINING_SCENE"
            scene={main.spot.scene}
            stackBb={main.spot.stackBb}
            presentation="ADVANCED"
            table={main.spot.table}
          />
        </section>

        {facts.length > 0 ? (
          <dl className="mt-4 grid grid-cols-2 gap-2" data-testid="lesson-facts">
            {facts.map((fact) => (
              <div key={fact.code} data-fact={fact.code} className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
                <dt className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/40">{fact.label}</dt>
                <dd className="mt-0.5 text-[15px] font-semibold text-white/90">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <p className="mt-4 text-[15px] leading-6 text-white/80" data-testid="lesson-lead">{lead}</p>

        <Link
          href={practiceHref}
          data-testid="lesson-practice"
          data-practice-preset={preset?.id}
          className="mt-5 flex min-h-14 items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f] active:bg-[#e2c66f]"
        >
          Потренироваться
        </Link>
        <p className="mt-2 text-center text-xs text-white/40">
          {preset ? `Готовая тренировка «${preset.title}» · 10 раздач` : "10 раздач в этой же ситуации"}
        </p>

        {rest.length > 0 ? (
          <section className="mt-5 rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-4" data-testid="lesson-text">
            <h2 className="text-[15px] font-semibold text-white/85">Разберёмся подробнее</h2>
            {rest.map((paragraph) => (
              <p key={paragraph} className="mt-3 text-[15px] leading-6 text-white/70">{paragraph}</p>
            ))}
          </section>
        ) : null}

        <ul className="mt-5 space-y-1.5 text-[13px] leading-5 text-white/50" aria-label="Словарик" data-testid="lesson-terms">
          {terms.map((term) => (
            <li key={term} data-term={term}>{ACADEMY_BEGINNER_TERMS[term]}</li>
          ))}
        </ul>

        <section className="mt-7" data-testid="range-view">
          <h2 className="text-lg font-semibold">Какие руки так играем</h2>
          <p className="mb-3 mt-1 text-sm leading-5 text-white/45">
            Каждая клетка — рука. Цвет показывает, как часто её играют каждым действием. Разноцветная клетка —
            рука играется по-разному; на тренировке засчитывается любое из этих действий.
          </p>
          <SolverActionMixGrid hands={main.hands} label={`Какие руки так играем: ${main.spot.title}`} actions={main.actions} />
        </section>

        <div className="mt-5 space-y-2.5">
          <Link
            href={main.studyHref}
            data-testid="lesson-study"
            className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-3.5 active:bg-white/[0.06]"
          >
            <span className="min-w-0 flex-1 text-[15px] font-medium text-white/85">Посмотреть диапазон отдельно</span>
            <span aria-hidden="true" className="text-lg text-white/35">→</span>
          </Link>
          {compare ? (
            <Link
              href={compare.studyHref}
              data-testid="lesson-compare"
              className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-3.5 active:bg-white/[0.06]"
            >
              <span className="min-w-0 flex-1 text-[15px] font-medium text-white/85">{compare.linkLabel}</span>
              <span aria-hidden="true" className="text-lg text-white/35">→</span>
            </Link>
          ) : null}
          {next ? (
            <Link
              href={beginnerAfterOpenLessonRoute(next.slug)}
              data-testid="lesson-next"
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3.5 active:bg-white/[0.09]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">Следующий урок</span>
                <span className="mt-0.5 block text-[15px] font-medium text-white/85">{next.title}</span>
              </span>
              <span aria-hidden="true" className="text-lg text-white/35">→</span>
            </Link>
          ) : (
            <Link
              href={ACADEMY_BEGINNER_ROUTE}
              data-testid="lesson-next"
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3.5 active:bg-white/[0.09]"
            >
              <span className="min-w-0 flex-1 text-[15px] font-medium text-white/85">Вернуться к урокам для новичков</span>
              <span aria-hidden="true" className="text-lg text-white/35">→</span>
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
