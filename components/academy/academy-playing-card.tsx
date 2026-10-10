import type { RenderedPlayingCard } from "@/types/academy";

// Presentation-only: the card face shows "10", not the internal "T" rank.
function displayRank(rank: RenderedPlayingCard["rank"]): string {
  return rank === "T" ? "10" : rank;
}

/** Playing card face, visually matching the База MTT trainer's card. */
export function AcademyPlayingCard({ card }: { card: RenderedPlayingCard }) {
  return (
    <div
      className={`flex h-28 w-20 flex-col justify-between rounded-2xl border border-black/10 bg-[#f3f0e8] p-3 shadow-[0_14px_30px_rgba(0,0,0,0.3)] ${
        card.color === "red" ? "text-[#b52f32]" : "text-[#171a18]"
      }`}
    >
      <span className="text-2xl font-bold leading-none">{displayRank(card.rank)}</span>
      <span className="self-end text-4xl leading-none">{card.suit}</span>
    </div>
  );
}
