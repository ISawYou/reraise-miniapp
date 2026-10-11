import { PushFoldAttribution } from "@/components/academy/push-fold-attribution";
import { PushFoldHome } from "@/components/academy/push-fold-home";
import { PushFoldReferenceNotice } from "@/components/academy/push-fold-reference";
import { BackButton } from "@/components/ui/back-button";
import { ACADEMY_TRAINERS_ROUTE } from "@/config/academy/navigation";
import { ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS } from "@/config/academy/push-fold-trainer";
import { listAcademyPushFoldSpots } from "@/lib/academy/push-fold-trainer";

/**
 * "Короткий стек · Push/Fold" (reached from "Тренажёры"). While no dataset is
 * validated for SCORED training (docs/ACADEMY_PUSH_FOLD_AUDIT.md) this is a
 * clearly-labelled REFERENCE: family → stack → seat picker leading to the
 * node's range page — no Quick session, no "start training". Options are
 * derived on the server from the whitelisted datasets' real nodes.
 */
export default function AcademySolverPushFoldPage() {
  const spots = listAcademyPushFoldSpots();
  const scoredDatasetIds = ACADEMY_PUSH_FOLD_SCORED_DATASET_IDS.filter((id) => spots.some((spot) => spot.datasetId === id));

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#09100d_0%,#080a09_45%,#070707_100%)] px-4 py-6 pb-40 text-white">
      <div className="mx-auto max-w-md">
        <BackButton href={ACADEMY_TRAINERS_ROUTE} label="Тренажёры" />

        <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b55a]">
          Короткий стек
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Push/Fold</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">
          Стек 4–15 BB: когда идти олл-ин первым и когда коллировать чужой пуш.
        </p>
        {scoredDatasetIds.length > 0 ? null : <PushFoldReferenceNotice className="mt-4" />}

        <PushFoldHome spots={spots} scoredDatasetIds={scoredDatasetIds} />

        <PushFoldAttribution className="mt-8" />
      </div>
    </main>
  );
}
