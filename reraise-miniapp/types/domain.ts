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
  created_at: string;
};

export type Tournament = {
  id: string;
  title: string;
  start_at: string;
  max_players: number;
  kind: TournamentKind;
  season_id: string | null;
  status: TournamentStatus;
  created_at: string;
  description?: string
  location?: string
  google_sheet_tab_name?: string | null;
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
  rating_points: number;
};

export type TournamentResult = {
  player_id: string;
  place: number;
  knockouts: number;
  reentries: number;
  rating_points: number;
  username: string | null;
  display_name: string;
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
  place: number | null;
  sheet_row_number: number | null;
};

export type PlayerAchievement = {
  id: string;
  player_id: string;
  achievement_code: string;
  current_value: number;
  completed_at: string | null;
  updated_at: string;
};
