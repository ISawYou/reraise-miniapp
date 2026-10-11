import { notFound } from "next/navigation";
import { PreflopTrainer } from "@/components/academy/preflop-trainer";
import { resolvePreflopTrainerRouteSpot } from "../params";

type PreflopTrainerTrainPageProps = {
  params: Promise<{ stack: string; node: string }>;
};

export default async function AcademyPreflopTrainerTrainPage({ params }: PreflopTrainerTrainPageProps) {
  const { stack, node } = await params;
  const resolved = resolvePreflopTrainerRouteSpot(stack, node);
  if (!resolved) notFound();

  const { datasetId, nodeKey, stackBb } = resolved.spot;
  return <PreflopTrainer key={`${datasetId}:${nodeKey}`} selection={{ datasetId, nodeKey, stackBb }} />;
}
