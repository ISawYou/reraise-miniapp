export const CLUB_ACTIVITY_EVENT_TYPES = {
  NEWS: "news",
  UPDATE: "update",
  TOURNAMENT_ANNOUNCEMENT: "tournament_announcement",
  TOURNAMENT_WINNER: "tournament_winner",
  ACHIEVEMENT: "achievement",
} as const;

export type ClubActivityEventType =
  (typeof CLUB_ACTIVITY_EVENT_TYPES)[keyof typeof CLUB_ACTIVITY_EVENT_TYPES];
export type ClubActivitySource = "manual" | "automatic";
export type ClubActivityStatus = "draft" | "published" | "archived";

export type ClubActivityEvent = {
  id: string;
  event_type: ClubActivityEventType;
  source: ClubActivitySource;
  status: ClubActivityStatus;
  title: string;
  body: string;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  player_id: string | null;
  tournament_id: string | null;
  achievement_code: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  player: {
    display_name: string;
    username: string | null;
    avatar_url: string | null;
  } | null;
  tournament: {
    title: string;
    start_at: string;
  } | null;
  achievement: {
    name: string;
    description: string;
    category: string;
    icon: string;
    tier: string | null;
  } | null;
};
