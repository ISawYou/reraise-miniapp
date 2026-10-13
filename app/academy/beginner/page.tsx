import { AcademyBeginnerNextSteps } from "@/components/academy/academy-beginner-next-steps";
import { AcademyModuleLessons } from "@/components/academy/academy-module-lessons";
import { AcademyPageHeader } from "@/components/academy/academy-page-header";
import { AcademyStepLessonList } from "@/components/academy/academy-spot-progress";
import {
  ACADEMY_BEGINNER_AFTER_OPEN_LESSONS,
  beginnerAfterOpenLessonRoute,
} from "@/config/academy/beginner-after-open";
import { getAcademyCourse, getAcademyModule } from "@/config/academy/catalog";
import { ACADEMY_HOME_ROUTE, requireAcademyDestination } from "@/config/academy/navigation";
import { academySpotProgressCode } from "@/config/academy/spot-progress";

const destination = requireAcademyDestination("beginner");
const course = getAcademyCourse(destination.courseCode!);
const courseModule = getAcademyModule(destination.moduleCode!);
if (!course || !courseModule) {
  throw new Error(`Academy catalog is missing ${destination.courseCode} / ${destination.moduleCode}`);
}

const STEPS = [
  {
    id: "step-1",
    step: 1,
    title: "Научись открываться",
    description: `Какие руки открывать, если до тебя все сбросили · ${courseModule.lessons.length} уроков`,
  },
  {
    id: "step-2",
    step: 2,
    title: "Научись играть после чужого действия",
    description: `Блайнды, защита и 3-бет · ${ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.length} уроков`,
  },
] as const;

function StepHeading({ step, title, description }: { step: number; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d7b55a] text-sm font-bold text-[#11120f]">{step}</span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">Шаг {step}</span>
        <span className="block text-xl font-semibold leading-6">{title}</span>
        <span className="mt-1 block text-[13px] leading-5 text-white/50">{description}</span>
      </span>
    </div>
  );
}

/**
 * "Новичкам" in two steps:
 * - Шаг 1: the existing База MTT Open Raise lessons — same lesson codes, same
 *   `/academy/preflop/[position]` URLs, same progress ("X из 7");
 * - Шаг 2: the separate "after the open" block (config/academy/beginner-after-open.ts),
 *   which is NOT part of any catalog course, so Шаг 1's totals never change.
 *   Its progress is per-spot practice progress (config/academy/spot-progress.ts):
 *   a lesson counts once its own ready-made training scored ≥ 80%.
 */
export default function AcademyBeginnerPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_45%,#070707_100%)] px-4 py-6 pb-28 text-white">
      <div className="mx-auto max-w-md">
        <AcademyPageHeader backHref={ACADEMY_HOME_ROUTE} backLabel="Академия" eyebrow={destination.title} title="Префлоп с нуля">
          <p>Два шага: сначала — какие руки открывать первым, потом — что делать, когда до тебя уже кто-то сыграл.</p>
        </AcademyPageHeader>

        <nav className="mt-5 space-y-2" aria-label="Шаги">
          {STEPS.map((entry) => (
            <a
              key={entry.id}
              href={`#${entry.id}`}
              data-beginner-step-link={entry.step}
              className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-3 active:bg-white/[0.06]"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#315f48] text-xs font-bold">{entry.step}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium leading-5 text-white/90">{entry.title}</span>
                <span className="block text-xs leading-5 text-white/45">{entry.description}</span>
              </span>
              <span aria-hidden="true" className="text-white/35">↓</span>
            </a>
          ))}
        </nav>

        <section id={STEPS[0].id} className="mt-8 scroll-mt-4" data-beginner-step="1" aria-label={`Шаг 1. ${STEPS[0].title}`}>
          <StepHeading {...STEPS[0]} />
          <AcademyModuleLessons course={course!} courseModule={courseModule!} />
        </section>

        <section id={STEPS[1].id} className="mt-10 scroll-mt-4" data-beginner-step="2" aria-label={`Шаг 2. ${STEPS[1].title}`}>
          <StepHeading {...STEPS[1]} />
          <AcademyStepLessonList
            lessons={ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.map((lesson) => ({
              slug: lesson.slug,
              order: lesson.order,
              title: lesson.title,
              subtitle: lesson.subtitle,
              href: beginnerAfterOpenLessonRoute(lesson.slug),
              progressCode: academySpotProgressCode(lesson.spot),
            }))}
          />
        </section>

        <AcademyBeginnerNextSteps />
      </div>
    </main>
  );
}
