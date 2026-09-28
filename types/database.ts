import type { TournamentType } from "./domain";

export type PlayerRow = {
  id: string;
  telegram_id: number | null;
  email: string | null;
  username: string | null;
  display_name: string;
  admin_display_name: string | null;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
  avatar_updated_at: string | null;
  role: string;
  is_blocked: boolean;
  accepted_terms_at: string | null;
  accepted_terms_version: string | null;
  profile_completed_at: string | null;
  nickname_status: string;
  pending_display_name: string | null;
  can_access_free: boolean;
  can_access_paid: boolean;
  can_access_cash: boolean;
  referral_count: number;
  free_reentries_balance: number;
  yandex_review_bonus_claimed: boolean;
  // Club discount (CLUB DISCOUNTS + GAINUP DISCOUNT AUDIT, 2026-09-27):
  // a permanent, LIVE percent discount (0-100) applied to this player's
  // paid tournament participation (entry/re-entry/add-on). Editable by a
  // Super Admin in the player catalog (app/admin/moderation/page.tsx).
  // This is the CURRENT setting only -- it is never read back for a
  // completed tournament's financial facts, which freeze their own copy
  // on results.club_discount_percent instead (see that schema's comment
  // for why). 0 = no discount, the default for every player.
  club_discount_percent: number;
  created_at: string;
};

export type TournamentRow = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  google_sheet_tab_name: string | null;
  start_at: string;
  max_players: number;
  kind: "free" | "paid" | "cash";
  tournament_type: TournamentType;
  season_id: string | null;
  status: string;
  created_at: string;
  rating_formula_version: "legacy" | "v2";
  rating_guarantee: number | null;
  placement_points_multiplier: number;
  is_final: boolean;
};

export type RegistrationRow = {
  id: string;
  player_id: string;
  tournament_id: string;
  status: "registered" | "waitlist" | "cancelled" | "attended";
  created_at: string;
};

export type ResultRow = {
  id: string;
  tournament_id: string;
  player_id: string;
  season_id: string | null;
  place: number;
  reentries: number;
  knockouts: number;
  boss_knockouts?: number;
  mystery_bounty_points?: number;
  addons?: number;
  rating_points: number;
  created_at: string;
};

export type TournamentLiveEntryRow = {
  id: string;
  tournament_id: string;
  player_id: string;
  registration_id: string;
  arrived: boolean;
  rebuys: number;
  addons: number;
  knockouts: number;
  boss_knockouts?: number;
  place: number | null;
  sheet_row_number: number | null;
  created_at: string;
  updated_at: string;
};

export type TournamentPlayerEliminationRow = {
  tournament_id: string;
  player_id: string;
  eliminated: boolean;
  eliminated_at: string | null;
  updated_at: string;
};

export type TournamentAttendanceRow = {
  tournament_id: string;
  player_id: string;
  arrived: boolean;
  arrived_at: string | null;
  write_seq: number;
  updated_at: string;
};

export type PlayerAchievementRow = {
  id: string;
  player_id: string;
  achievement_code: string;
  current_value: number;
  completed_at: string | null;
  updated_at: string;
};
