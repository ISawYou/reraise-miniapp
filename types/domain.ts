export type RegistrationStatus =
  | "registered"
  | "waitlist"
  | "cancelled"
  | "attended";

export type TournamentStatus =
  | "draft"
  | "open"
  | "closed"
  | "completed";

export type PlayerRole = "player" | "admin";
export type TournamentKind = "free" | "paid" | "cash";
export type TournamentType =
  | "classic"
  | "phoenix"
  | "deep_stack"
  | "bounty"
  | "boss_bounty"
  | "win_the_button"
  | "mystery_bounty";

export type Player = {
  id: string;
  telegram_id: number | null;
  email?: string | null;
  username: string | null;
  display_name: string;
  admin_display_name?: string;
  telegram_avatar_url?: string;
  custom_avatar_url?: string;
  avatar_updated_at?: string;
  role: "player" | "admin";
  accepted_terms_at?: string;
  accepted_terms_version?: string;
  profile_completed_at?: string;
  nickname_status?: "approved" | "pending";
  pending_display_name?: string;
  can_access_free?: boolean;
  can_access_paid?: boolean;
  can_access_cash?: boolean;
  referral_count?: number;
  free_reentries_balance?: number;
  yandex_review_bonus_claimed?: boolean;
  created_at: string;
};

export type RatingFormulaVersion = "legacy" | "v2";

export type RatingPlace = {
  place: number;
  points: number;
};

export type Tournament = {
  id: string;
  title: string;
  start_at: string;
  max_players: number;
  kind: TournamentKind;
  tournament_type: TournamentType;
  season_id: string | null;
  status: TournamentStatus;
  created_at: string;
  description?: string
  location?: string
  google_sheet_tab_name?: string | null;
  // Rating Engine v2: which formula this tournament's results were/will be
  // computed with -- frozen at completion time. "legacy" for every
  // tournament that existed before the v2 migration; "v2" for everything
  // created afterwards. See features/rating.ts vs features/rating-v2.ts.
  rating_formula_version: RatingFormulaVersion;
  // Phoenix Rating Guarantee (spec §15) -- admin-set target TOTAL rating
  // pool (participation + placement). null = no guarantee. Only meaningful
  // for tournament_type = "phoenix".
  rating_guarantee: number | null;
};

export type Registration = {
  id: string;
  player_id: string;
  tournament_id: string;
  status: RegistrationStatus;
  created_at: string;
};

export type Result = {
  id: string;
  tournament_id: string;
  player_id: string;
  place: number;
  rating_points: number;
  created_at: string;
};

export type TournamentParticipant = {
  registration_id: string;
  player_id: string;
  status: "registered" | "attended" | "waitlist";
  created_at: string;
  username: string | null;
  display_name: string;
  telegram_avatar_url?: string;
  custom_avatar_url?: string;
  rating: number;
};

export type TournamentResultInput = {
  player_id: string;
  place: number;
  reentries: number;
  knockouts: number;
  boss_knockouts?: number;
  mystery_bounty_points?: number;
  addons?: number;
  rating_points: number;
  // Rating Breakdown -- see lib/repositories/result/ResultRepository.ts's
  // ResultInsert for why these stay optional/nullable rather than required.
  arrived?: boolean | null;
  participation_points?: number | null;
  knockout_points?: number | null;
  boss_bounty_points?: number | null;
  itm_points?: number | null;
  // Not persisted -- only used to name players in place-validation error
  // messages (lib/tournament-results-validation.ts). Falls back to
  // player_id when omitted.
  display_name?: string;
};

export type TournamentResult = {
  player_id: string;
  place: number;
  knockouts: number;
  boss_knockouts?: number;
  mystery_bounty_points?: number;
  reentries: number;
  addons?: number;
  rating_points: number;
  username: string | null;
  display_name: string;
};

// Mystery Bounty — frozen snapshot computed once when an admin closes Late
// Registration for a `tournament_type: "mystery_bounty"` tournament. See
// docs/MYSTERY_BOUNTY_RESEARCH.md — deliberately its own domain, not folded
// into Tournament/TournamentLiveEntry: it tracks a one-time pool/envelope
// calculation, not per-player live state.
export type MysteryBountyStatus = "pending_envelopes" | "active";

export type MysteryBountySnapshot = {
  tournament_id: string;
  late_registration_status: "open" | "closed";
  status: MysteryBountyStatus;
  players_count: number;
  // Raw sum of the shared "Re-buy" field across arrived players — Total
  // Entries (Initial Entries + Rebuys), not a rebuy count on its own.
  total_entries_count: number;
  // Derived: max(0, total_entries_count - players_count). Kept for
  // display/diagnostics; the Mystery Pool formula uses total_entries_count
  // directly.
  rebuys_count: number;
  addons_count: number;
  active_players_count: number;
  mystery_pool: number;
  envelope_count: number;
  small_count: number;
  small_value: number;
  medium_count: number;
  medium_value: number;
  jackpot_value: number;
  closed_at: string;
  activated_at: string | null;
  recalculated_at: string | null;
};

export type TournamentLiveEntry = {
  id: string;
  tournament_id: string;
  registration_id: string;
  player_id: string;
  display_name: string;
  username: string | null;
  registration_status: "registered" | "attended";
  arrived: boolean;
  rebuys: number;
  addons: number;
  knockouts: number;
  boss_knockouts?: number;
  place: number | null;
  sheet_row_number: number | null;
};

export type TournamentPlayerElimination = {
  player_id: string;
  eliminated: boolean;
  eliminated_at: string | null;
};

export type PlayerAchievement = {
  id: string;
  player_id: string;
  achievement_code: string;
  current_value: number;
  completed_at: string | null;
  updated_at: string;
};
