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

export interface ClubActivityRepository {
  listPublished(limit: number, offset: number): Promise<ClubActivityEventRecord[]>;
  listAdmin(limit: number): Promise<ClubActivityEventRecord[]>;
  findById(eventId: string): Promise<ClubActivityEventRecord | null>;
  createManual(input: CreateManualClubActivityEvent): Promise<ClubActivityEventRecord>;
  updateManual(
    eventId: string,
    input: UpdateManualClubActivityEvent,
  ): Promise<ClubActivityEventRecord | null>;
  archiveManual(eventId: string, updatedAt: string): Promise<boolean>;
  createAutomaticIdempotently(
    input: CreateAutomaticClubActivityEvent,
  ): Promise<ClubActivityEventRecord>;
}
