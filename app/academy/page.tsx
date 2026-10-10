import { AcademyCourseCard } from "@/components/academy/academy-course-card";
import { BackButton } from "@/components/ui/back-button";
import { listAcademyCourses } from "@/config/academy/catalog";

export default function AcademyPage() {
  const courses = listAcademyCourses();

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(ellipse_80%_34%_at_50%_-5%,rgba(76,116,95,0.2),transparent_60%),linear-gradient(180deg,#09100d_0%,#090b0a_42%,#070707_100%)] px-4 py-6 pb-28 text-white">
      <div className="relative mx-auto max-w-md">
        <BackButton historyAware fallbackHref="/" className="mb-4" />
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#d7b55a]">
          RERAISE
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Академия</h1>
        <p className="mt-3 max-w-sm text-[15px] leading-6 text-white/60">
          Изучай стратегию турнирного покера и проверяй свои знания.
        </p>

        <section className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
            Курсы
          </p>

          {courses.map((course) => (
            <AcademyCourseCard key={course.code} course={course} />
          ))}
        </section>
      </div>
    </main>
  );
}
