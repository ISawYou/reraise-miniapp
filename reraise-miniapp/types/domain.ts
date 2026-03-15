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
  role: PlayerRole;
  created_at: string;
};

export type Tournament = {
  id: string;
  title: string;
  start_at: string;
  max_players: number;
  status: TournamentStatus;
  created_at: string;
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
  status: "registered" | "attended";
  created_at: string;
  username: string | null;
  display_name: string;
  rating: number;
};