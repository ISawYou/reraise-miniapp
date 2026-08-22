import type { ReactNode } from "react";
import { AcademyAuthGate } from "@/components/academy/academy-auth-gate";

export default function AcademyLayout({ children }: { children: ReactNode }) {
  return <AcademyAuthGate>{children}</AcademyAuthGate>;
}
