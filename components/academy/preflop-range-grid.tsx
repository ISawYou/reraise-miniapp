import type { PreflopMatrixCell } from "@/types/academy";

type PreflopRangeGridProps = {
  matrix: readonly (readonly PreflopMatrixCell[])[];
  label: string;
};

export function PreflopRangeGrid({ matrix, label }: PreflopRangeGridProps) {
  return (
    <div
      role="grid"
      aria-label={label}
      className="grid w-full grid-cols-[repeat(13,minmax(0,1fr))] gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.28)]"
    >
      {matrix.flat().map((cell) => {
        const isOpen = cell.teachingAction === "OPEN";

        return (
          <div
            key={cell.hand}
            role="gridcell"
            aria-label={`${cell.hand}: ${isOpen ? "открываем" : "фолд"}`}
            className={`flex aspect-square min-w-0 items-center justify-center font-semibold leading-none tracking-[-0.04em] text-[clamp(7px,2.45vw,11px)] ${
              isOpen
                ? "bg-[#315f48] text-[#f7fbf8]"
                : "bg-[#101312] text-white/30"
            }`}
          >
            {cell.hand}
          </div>
        );
      })}
    </div>
  );
}
