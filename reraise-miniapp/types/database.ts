export type PlayerRow = {
  id: string;
  telegram_id: number;
  username: string | null;
  display_name: string;
  role: "player" | "admin";
  created_at: string;
};
export type TournamentRow = {
  id: string;
  title: string;
  start_at: string;
  max_players: number;
  status: "draft" | "open" | "closed" | "completed";
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