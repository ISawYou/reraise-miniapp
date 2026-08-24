import type {
  ClubActivityEventType,
  ClubActivitySource,
  ClubActivityStatus,
} from "@/types/club-activity";

export type ClubActivityEventRecord = {
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
  idempotency_key: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  player: {
    display_name: string;
    username: string | null;
    telegram_avatar_url: string | null;
    custom_avatar_url: string | null;
  } | null;
  tournament: {
    title: string;
    start_at: string;
  } | null;
};

export type CreateManualClubActivityEvent = {
  event_type: "news" | "update" | "tournament_announcement";
  status: "draft" | "published";
  title: string;
  body: string;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  published_at: string | null;
};

export type UpdateManualClubActivityEvent = Partial<CreateManualClubActivityEvent> & {
  updated_at: string;
};

export type CreateAutomaticClubActivityEvent = {
  event_type: "tournament_winner" | "achievement";
  title: string;
  body: string;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  player_id: string | null;
  tournament_id: string | null;
  achievement_code: string | null;
  idempotency_key: string;
  published_at: string;
};

export type ClubActivityCommentRecord = {
  id: string;
  event_id: string;
  player_id: string;
  body: string;
  created_at: string;
  player: {
    id: string;
    display_name: string;
    telegram_avatar_url: string | null;
    custom_avatar_url: string | null;
  };
};

export type ClubActivityFeedRecord = ClubActivityEventRecord & {
  like_count: number;
  liked_by_me: boolean;
  comment_count: number;
};

export interface ClubActivityRepository {
  listPublished(limit: number, offset: number): Promise<ClubActivityEventRecord[]>;
  listPublishedWithSocial(
    limit: number,
    offset: number,
    playerId?: string,
  ): Promise<ClubActivityFeedRecord[]>;
  listAdmin(limit: number): Promise<ClubActivityEventRecord[]>;
  findById(eventId: string): Promise<ClubActivityEventRecord | null>;
  findPublishedById(eventId: string): Promise<ClubActivityEventRecord | null>;
  countLikes(eventId: string): Promise<number>;
  hasLike(eventId: string, playerId: string): Promise<boolean>;
  toggleLike(eventId: string, playerId: string): Promise<boolean>;
  listComments(eventId: string): Promise<ClubActivityCommentRecord[]>;
  createComment(eventId: string, playerId: string, body: string): Promise<ClubActivityCommentRecord>;
  createManual(input: CreateManualClubActivityEvent): Promise<ClubActivityEventRecord>;
  updateAdmin(
    eventId: string,
    input: UpdateManualClubActivityEvent,
  ): Promise<ClubActivityEventRecord | null>;
  archive(eventId: string, updatedAt: string): Promise<boolean>;
  createAutomaticIdempotently(
    input: CreateAutomaticClubActivityEvent,
  ): Promise<ClubActivityEventRecord>;
}
