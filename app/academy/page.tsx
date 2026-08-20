import Link from "next/link";

function PositionIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="12" rx="8.5" ry="5.5" />
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="5" cy="10" r="1.5" />
      <circle cx="19" cy="10" r="1.5" />
      <circle cx="8" cy="18" r="1.5" />
      <circle cx="16" cy="18" r="1.5" />
    </svg>
  );
}

export default function AcademyPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(ellipse_80%_34%_at_50%_-5%,rgba(76,116,95,0.2),transparent_60%),linear-gradient(180deg,#09100d_0%,#090b0a_42%,#070707_100%)] px-4 py-6 pb-28 text-white">
      <div className="relative mx-auto max-w-md">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#d7b55a]">
          RERAISE
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Академия</h1>
        <p className="mt-3 max-w-sm text-[15px] leading-6 text-white/60">
          Изучай стратегию турнирного покера и проверяй свои знания.
        </p>

        <section className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
            Префлоп
          </p>

          <Link
            href="/academy/preflop"
            className="mt-3 flex items-center gap-4 rounded-[26px] border border-white/10 bg-white/[0.055] p-5 transition-colors active:bg-white/[0.09]"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#315f48] text-white">
              <PositionIcon />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block text-xl font-semibold">Позиции</span>
              <span className="mt-1 block text-sm leading-5 text-white/50">
                Основы игры с разных позиций за столом
              </span>
            </span>

            <span aria-hidden="true" className="text-xl text-white/35">
              →
            </span>
          </Link>
        </section>
      </div>
    </main>
  );
}
