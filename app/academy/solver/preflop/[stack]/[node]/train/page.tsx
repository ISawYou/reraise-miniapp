import { AcademyPageAccessGate } from "@/components/academy/academy-page-access-gate";
import { academyPreflopSpotTarget } from "@/lib/academy/access-targets";
import { notFound } from "next/navigation";
import { PreflopTrainer } from "@/components/academy/preflop-trainer";
import { resolvePreflopTrainerRouteSpot } from "../params";
import { resolvePreflopTrainerContext } from "./context";

type PreflopTrainerTrainPageProps = {
  params: Promise<{ stack: string; node: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AcademyPreflopTrainerTrainPage({ params, searchParams }: PreflopTrainerTrainPageProps) {
  const { stack, node } = await params;
  const resolved = resolvePreflopTrainerRouteSpot(stack, node);
  if (!resolved) notFound();

  const { datasetId, nodeKey, stackBb } = resolved.spot;
  const context = resolvePreflopTrainerContext(resolved.spot, (await searchParams) ?? {});
  return (
    <AcademyPageAccessGate target={academyPreflopSpotTarget(datasetId, nodeKey)}>
      <PreflopTrainer key={`${datasetId}:${nodeKey}`} selection={{ datasetId, nodeKey, stackBb }} context={context} />
    </AcademyPageAccessGate>
  );
}
