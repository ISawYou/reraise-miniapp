export type PlayerRow = {
  id: string;
  telegram_id: number;
  username: string | null;
  display_name: string;
  role: string;
  accepted_terms_at: string | null;
  accepted_terms_version: string | null;
  created_at: string;
};

export type TournamentRow = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  max_players: number;
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