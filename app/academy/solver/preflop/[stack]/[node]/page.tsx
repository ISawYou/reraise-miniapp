import Link from "next/link";
import { notFound } from "next/navigation";
import { SolverActionMixGrid } from "@/components/academy/SolverActionMixGrid";
import { BackButton } from "@/components/ui/back-button";
import { ACADEMY_SOLVER_PREFLOP_TRAINER_ROUTE, preflopTrainerTrainRoute } from "@/config/academy/preflop-trainer";
import { getPreflopTrainerPublicActions, toPublicPreflopTrainerSpot } from "@/lib/academy/preflop-trainer";
import { resolvePreflopTrainerRouteSpot } from "./params";

type PreflopTrainerSpotPageProps = {
  params: Promise<{ stack: string; node: string }>;
};

/** One trainer spot: description, optional range view, start button. */
export default async function AcademyPreflopTrainerSpotPage({ params }: PreflopTrainerSpotPageProps) {
  const { stack, node } = await params;
  const resolved = resolvePreflopTrainerRouteSpot(stack, node);
  if (!resolved) notFound();

  const spot = toPublicPreflopTrainerSpot(resolved.spot);
  const actions = getPreflopTrainerPublicActions(resolved);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_36%,#070707_100%)] px-3 py-6 pb-28 text-white min-[375px]:px-4">
      <div className="mx-auto max-w-md">
        <BackButton href={ACADEMY_SOLVER_PREFLOP_TRAINER_ROUTE} />

        <header className="mt-7">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b55a]">
            Префлоп-тренажёр · {spot.stackBb} BB · {spot.situationLabel}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{spot.title}</h1>
          <p className="mt-2 text-sm text-white/55">{spot.history}</p>
        </header>

        <section className="mt-5 rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-4">
          <p className="text-[15px] leading-6 text-white/75">
            Доступные действия: {actions.map((action) => action.ru?.button ?? action.label).join(", ")}.
          </p>
          <p className="mt-3 text-[15px] leading-6 text-white/75">
            У каждой раздачи есть рандомайзер от 0 до 99: он выбирает, какая часть смешанной
            стратегии выпала. В зачёт идёт выпавшее действие.
          </p>
        </section>

        <details className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3" data-testid="range-view">
          <summary className="cursor-pointer list-none text-sm font-medium text-white/75">
            Посмотреть диапазон
          </summary>
          <div className="mt-4">
            <p className="mb-3 text-sm text-white/45">Частоты стратегии · {spot.title} · {spot.stackBb} BB</p>
            <SolverActionMixGrid
              hands={resolved.node.hands}
              label={`Частоты стратегии: ${spot.title}`}
              actions={actions}
            />
          </div>
        </details>

        <Link
          href={preflopTrainerTrainRoute(spot.stackBb, spot.nodeKey)}
          className="mt-6 flex min-h-14 items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f] active:bg-[#e2c66f]"
        >
          Начать тренировку
        </Link>
      </div>
    </main>
  );
}
