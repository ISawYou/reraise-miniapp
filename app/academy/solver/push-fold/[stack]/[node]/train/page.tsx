import { notFound } from "next/navigation";
import { PushFoldTrainingPaused } from "@/components/academy/push-fold-reference";
import { PushFoldTrainer } from "@/components/academy/push-fold-trainer";
import { pushFoldSpotRoute } from "@/config/academy/push-fold-trainer";
import { isAcademyPushFoldDatasetScored } from "@/lib/academy/push-fold-trainer";
import { resolvePushFoldRouteSpot } from "../params";

type PushFoldTrainPageProps = {
  params: Promise<{ stack: string; node: string }>;
};

/**
 * Scored fixed-node Push/Fold training. Served only for a dataset validated
 * for scored training; otherwise the route shows the "paused" screen linking
 * to this node's (non-scored) reference page.
 */
export default async function AcademyPushFoldTrainPage({ params }: PushFoldTrainPageProps) {
  const { stack, node } = await params;
  const resolved = resolvePushFoldRouteSpot(stack, node);
  if (!resolved) notFound();

  const { datasetId, nodeKey, stackBb } = resolved.spot;
  if (!isAcademyPushFoldDatasetScored(datasetId)) {
    return <PushFoldTrainingPaused rangeHref={pushFoldSpotRoute(stackBb, nodeKey)} />;
  }
  return <PushFoldTrainer key={`${datasetId}:${nodeKey}`} selection={{ datasetId, nodeKey, stackBb }} />;
}
