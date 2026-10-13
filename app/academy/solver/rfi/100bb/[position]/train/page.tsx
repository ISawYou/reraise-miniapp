import { AcademyPageAccessGate } from "@/components/academy/academy-page-access-gate";
import { academyAreaTarget } from "@/config/academy/access-policy";
import { notFound } from "next/navigation";
import { SolverTraining } from "@/components/academy/solver-training";
import { ACADEMY_PREFLOP_POSITIONS, isPreflopPosition } from "@/lib/academy/preflop";

type SolverTrainingPageProps = {
  params: Promise<{ position: string }>;
};

export function generateStaticParams() {
  return ACADEMY_PREFLOP_POSITIONS.map((position) => ({ position: position.toLowerCase() }));
}

export default async function AcademySolverTrainingPage({ params }: SolverTrainingPageProps) {
  const { position } = await params;
  const canonicalPosition = position.toUpperCase();
  if (!isPreflopPosition(canonicalPosition)) notFound();

  return (
    <AcademyPageAccessGate target={academyAreaTarget("solver-rfi")}>
      <SolverTraining key={canonicalPosition} position={canonicalPosition} />
    </AcademyPageAccessGate>
  );
}
