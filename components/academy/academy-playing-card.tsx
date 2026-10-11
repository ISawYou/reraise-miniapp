import type { RenderedPlayingCard } from "@/types/academy";

// Presentation-only: the card face shows "10", not the internal "T" rank.
function displayRank(rank: RenderedPlayingCard["rank"]): string {
  return rank === "T" ? "10" : rank;
}

const SIZE_CLASS = {
  // Default: unchanged card used by the lesson / Solver Lab trainers.
  md: { box: "h-28 w-20 rounded-2xl p-3", rank: "text-2xl", suit: "text-4xl" },
  // Compact card laid on the felt of the TRAINING_SCENE table.
  sm: { box: "h-[78px] w-[56px] rounded-xl p-2", rank: "text-xl", suit: "text-[28px]" },
} as const;

/** Playing card face, visually matching the База MTT trainer's card. */
export function AcademyPlayingCard({ card, size = "md" }: { card: RenderedPlayingCard; size?: keyof typeof SIZE_CLASS }) {
  const look = SIZE_CLASS[size];
  return (
    <div
      className={`flex ${look.box} flex-col justify-between border border-black/10 bg-[#f3f0e8] shadow-[0_14px_30px_rgba(0,0,0,0.3)] ${
        card.color === "red" ? "text-[#b52f32]" : "text-[#171a18]"
      }`}
    >
      <span className={`${look.rank} font-bold leading-none`}>{displayRank(card.rank)}</span>
      <span className={`self-end ${look.suit} leading-none`}>{card.suit}</span>
    </div>
  );
}
