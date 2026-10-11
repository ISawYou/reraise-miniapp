import { AcademyDestinations } from "@/components/academy/academy-destinations";
import { BackButton } from "@/components/ui/back-button";

export default function AcademyPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(ellipse_80%_34%_at_50%_-5%,rgba(76,116,95,0.2),transparent_60%),linear-gradient(180deg,#09100d_0%,#090b0a_42%,#070707_100%)] px-4 py-6 pb-28 text-white">
      <div className="relative mx-auto max-w-md">
        <BackButton historyAware fallbackHref="/" className="mb-3" />
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#d7b55a]">
          RERAISE
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Академия</h1>
        <p className="mt-2 max-w-sm text-[15px] leading-6 text-white/60">
          Учись по шагам или сразу тренируйся за столом.
        </p>

        <AcademyDestinations />
      </div>
    </main>
  );
}
