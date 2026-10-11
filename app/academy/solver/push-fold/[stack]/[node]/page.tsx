import Link from "next/link";
import { notFound } from "next/navigation";
import { PokerPositionTable } from "@/components/academy/poker-position-table";
import { PushFoldAttribution } from "@/components/academy/push-fold-attribution";
import { SolverActionMixGrid } from "@/components/academy/SolverActionMixGrid";
import { BackButton } from "@/components/ui/back-button";
import { ACADEMY_SOLVER_PUSH_FOLD_ROUTE, pushFoldTrainRoute } from "@/config/academy/push-fold-trainer";
import { ACADEMY_PUSH_FOLD_MODEL_NOTE } from "@/lib/academy/push-fold-copy";
import {
  getPushFoldPublicActions,
  getPushFoldSourceCoveragePercent,
  toPublicPushFoldSpot,
} from "@/lib/academy/push-fold-trainer";
import { solverActionButtonLabel } from "@/lib/academy/solver-feedback";
import { resolvePushFoldRouteSpot } from "./params";

type PushFoldSpotPageProps = {
  params: Promise<{ stack: string; node: string }>;
};

/**
 * One Push/Fold node (study mode). Everything is visible on arrival — table
 * scene, stack, situation, the 13x13 pure range with the source's own
 * coverage, "Начать тренировку" and the attribution — no second click.
 */
export default async function AcademyPushFoldSpotPage({ params }: PushFoldSpotPageProps) {
  const { stack, node } = await params;
  const resolved = resolvePushFoldRouteSpot(stack, node);
  if (!resolved) notFound();

  const spot = toPublicPushFoldSpot(resolved.spot);
  const actions = getPushFoldPublicActions(resolved);
  const rangeAction = actions.find((action) => action.code !== "FOLD") ?? actions[0];
  const coverage = getPushFoldSourceCoveragePercent(resolved);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_36%,#070707_100%)] px-3 py-6 pb-40 text-white min-[375px]:px-4">
      <div className="mx-auto max-w-md">
        <BackButton href={ACADEMY_SOLVER_PUSH_FOLD_ROUTE} />

        <header className="mt-7">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b55a]">
            Push/Fold · {spot.stackBb} BB · {spot.situationLabel}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{spot.title}</h1>
          <p className="mt-2 text-sm text-white/55">{spot.history}</p>
        </header>

        <section className="mt-5">
          <PokerPositionTable mode="TRAINING_SCENE" scene={spot.scene} stackBb={spot.stackBb} />
        </section>

        <section className="mt-6" data-testid="range-view">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Диапазон</h2>
            <p className="text-sm font-semibold text-[#e4c97a]" data-testid="range-coverage">
              {solverActionButtonLabel(rangeAction)}: {coverage}% рук
            </p>
          </div>
          <p className="mb-3 mt-1 text-sm text-white/45">
            {spot.title} · {spot.stackBb} BB · каждая рука либо в диапазоне, либо фолд
          </p>
          <SolverActionMixGrid
            hands={resolved.node.hands}
            label={`Push/Fold диапазон: ${spot.title}, ${spot.stackBb} BB`}
            actions={actions}
          />
        </section>

        <Link
          href={pushFoldTrainRoute(spot.stackBb, spot.nodeKey)}
          className="mt-6 flex min-h-14 items-center justify-center rounded-2xl bg-[#d7b55a] px-5 py-4 text-base font-semibold text-[#11120f] active:bg-[#e2c66f]"
        >
          Начать тренировку
        </Link>

        <p className="mt-5 text-xs leading-5 text-white/45" data-testid="push-fold-model-note">{ACADEMY_PUSH_FOLD_MODEL_NOTE}</p>
        <PushFoldAttribution className="mt-4" />
      </div>
    </main>
  );
}
