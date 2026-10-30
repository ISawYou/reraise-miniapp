import Link from "next/link";
import type { ProfileV2HistoryItem } from "@/features/profile-v2";
import type { TournamentVisualConfig } from "@/config/tournament-visuals";
import { CompactListRow, TournamentArtworkIcon } from "./profile-primitives";

export function ProfileResultRow({ item, configs }: { item: ProfileV2HistoryItem; configs: Record<string, TournamentVisualConfig> }) {
  const { tournament, result } = item;
  return (
    <Link href={`/tournaments/${tournament.id}`} className="block transition active:scale-[0.99]">
      <CompactListRow>
        <TournamentArtworkIcon tournamentType={tournament.tournament_type} configs={configs} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{tournament.title}</p>
          <p className="mt-1 text-xs text-white/60">
            {new Date(tournament.start_at).toLocaleString("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · {result.field_size ?? 0} игроков
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-white">#{result.place}</p>
          <p className="mt-1 text-xs text-[#f0d38a]">+{result.rating_points}</p>
          {tournament.tournament_type === "bounty" ? <p className="mt-1 text-[10px] text-white/60">KO {result.knockouts}</p> : null}
          {tournament.tournament_type === "boss_bounty" ? <p className="mt-1 text-[10px] text-white/60">KO {result.knockouts} · Boss {result.boss_knockouts ?? 0}</p> : null}
          {tournament.tournament_type === "mystery_bounty" ? <p className="mt-1 text-[10px] text-white/60">Mystery {result.mystery_bounty_points ?? 0}</p> : null}
        </div>
      </CompactListRow>
    </Link>
  );
}
