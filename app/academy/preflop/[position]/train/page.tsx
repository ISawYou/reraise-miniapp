import { notFound } from "next/navigation";
import { PreflopTraining } from "@/components/academy/preflop-training";
import {
  ACADEMY_PREFLOP_POSITIONS,
  isPreflopPosition,
} from "@/lib/academy/preflop";

type AcademyTrainingPageProps = {
  params: Promise<{ position: string }>;
};

export function generateStaticParams() {
  return ACADEMY_PREFLOP_POSITIONS.map((position) => ({
    position: position.toLowerCase(),
  }));
}

export default async function AcademyTrainingPage({ params }: AcademyTrainingPageProps) {
  const { position } = await params;
  const canonicalPosition = position.toUpperCase();
  if (!isPreflopPosition(canonicalPosition)) notFound();

  return <PreflopTraining key={canonicalPosition} position={canonicalPosition} />;
}
