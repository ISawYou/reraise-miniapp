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

export type Player = {
  id: string;
  telegram_id: number;
  username: string | null;
  display_name: string;
  role: "player" | "admin";
  accepted_terms_at?: string;
  accepted_terms_version?: string;
  created_at: string;
};

export type Tournament = {
  id: string;
  title: string;
  start_at: string;
  max_players: number;
  season_id: string | null;
  status: TournamentStatus;
  created_at: string;
  description?: string
  location?: string
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