import type { TournamentType } from "@/types/domain";
import type { TournamentInsert } from "@/lib/repositories/tournament/TournamentRepository";
import { normalizePlacementPointsMultiplier } from "@/config/tournament-presets";
// Shared canonical create defaults; callable inside an existing DB transaction.
export type TournamentCreationInput = {
  title: string;
  description: string;
  location: string;
  start_at: string;
  max_players: number;
  tournament_type: TournamentType;
  starting_stack?: number | null;
  late_registration_ends_at?: string | null;
  rating_guarantee?: number | null;
  // Only kept for boost_rating; every other type is normalized to 1.
  placement_points_multiplier?: number | null;
  // Absent/undefined is treated exactly like false -- every pre-existing
  // caller that doesn't know about "Финал месяца" keeps creating normal,
  // publicly self-registerable tournaments unchanged.
  is_final?: boolean;
};
export function assertTournamentCreationShape(input:TournamentCreationInput) { if (input.tournament_type === "qualification_final" && (input.max_players !== 18 || input.is_final)) throw new Error("Финал отбора: ровно 18 мест, отдельный от Финала месяца тип"); }
export function prepareTournamentCreation(input:TournamentCreationInput,seasonId:string):TournamentInsert {
  assertTournamentCreationShape(input);
  return {
    title: input.title,
    description: input.description,
    location: input.location,
    start_at: input.start_at,
    max_players: input.max_players,
    kind: "free",
    tournament_type: input.tournament_type,
    status: "open",
    season_id: seasonId,
    starting_stack: input.tournament_type === "qualification_final" || input.tournament_type === "phoenix" ? 50000 : input.starting_stack ?? null,
    late_registration_ends_at: input.tournament_type === "qualification_final" ? null : input.late_registration_ends_at ?? null,
    rating_guarantee: input.rating_guarantee ?? null,
    placement_points_multiplier: normalizePlacementPointsMultiplier(
      input.tournament_type,
      input.placement_points_multiplier
    ),
    is_final: input.is_final ?? false,
  };
}
