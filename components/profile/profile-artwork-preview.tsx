import { ProfileResultRow } from "./profile-result-row";
import { ProfileUpcomingRow } from "./profile-upcoming-row";
import type { TournamentVisualConfig } from "@/config/tournament-visuals";
import { getTournamentTypeLabel } from "@/lib/tournament-helpers";
import type { Tournament } from "@/types/domain";

export function ProfileArtworkPreview({ config }: { config: TournamentVisualConfig }) {
  const configs = { [config.tournamentType]: config };
  const tournament: Tournament = {
    id: "preview", title: getTournamentTypeLabel(config.tournamentType), tournament_type: config.tournamentType,
    start_at: "2026-10-30T16:00:00Z", created_at: "2026-10-01T00:00:00Z", max_players: 30,
    kind: "free", season_id: null, status: "completed", rating_formula_version: "v2",
    rating_guarantee: null, placement_points_multiplier: 1, is_final: false,
  };
  // 390px phone minus the same 16px page gutters. Narrower admin screens
  // shrink naturally; both contexts use the actual production row components.
  return <div data-profile-artwork-preview="" onClick={(event) => event.preventDefault()} className="w-full max-w-[358px] space-y-4 rounded-2xl bg-[#09100d] p-0 text-white">
    <div>
      <p className="mb-2 text-xs text-white/65">Последняя форма</p>
      <ProfileResultRow configs={configs} item={{ tournament, result: { player_id: "preview", place: 3, field_size: 30, rating_points: 240, knockouts: 4, boss_knockouts: 1, mystery_bounty_points: 80, reentries: 0, username: null, display_name: "Превью" } }} />
    </div>
    <div>
      <p className="mb-2 text-xs text-white/65">Ближайшие турниры</p>
      <ProfileUpcomingRow configs={configs} tournament={{ ...tournament, status: "open" }} status="waitlist" count={30} />
    </div>
  </div>;
}
