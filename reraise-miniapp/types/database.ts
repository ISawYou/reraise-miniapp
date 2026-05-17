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
  accepted_terms_at: string | null;
  accepted_terms_version: string | null;
  profile_completed_at: string | null;
  nickname_status: string;
  pending_display_name: string | null;
  can_access_free: boolean;
  can_access_paid: boolean;
  can_access_cash: boolean;
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
  season_id: string | null;
  status: string;
  created_at: string;
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
  place: number | null;
  sheet_row_number: number | null;
  created_at: string;
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
