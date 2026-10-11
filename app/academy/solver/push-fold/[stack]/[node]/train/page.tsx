import { notFound } from "next/navigation";
import { PushFoldTrainer } from "@/components/academy/push-fold-trainer";
import { resolvePushFoldRouteSpot } from "../params";

type PushFoldTrainPageProps = {
  params: Promise<{ stack: string; node: string }>;
};

export default async function AcademyPushFoldTrainPage({ params }: PushFoldTrainPageProps) {
  const { stack, node } = await params;
  const resolved = resolvePushFoldRouteSpot(stack, node);
  if (!resolved) notFound();

  const { datasetId, nodeKey, stackBb } = resolved.spot;
  return <PushFoldTrainer key={`${datasetId}:${nodeKey}`} selection={{ datasetId, nodeKey, stackBb }} />;
}
