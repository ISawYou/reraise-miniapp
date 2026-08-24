import "server-only";

import {
  ACHIEVEMENT_CATEGORY,
  getAchievementDefinition,
  type AchievementDefinition,
} from "@/config/achievements";
import {
  clubActivityRepository,
  playerRepository,
  tournamentRepository,
  type ClubActivityEventRecord,
  type ClubActivityRepository,
} from "@/lib/repositories";
import {
  CLUB_ACTIVITY_EVENT_TYPES,
  type ClubActivityEvent,
  type ClubActivityComment,
  type ClubActivityDetail,
} from "@/types/club-activity";

const MANUAL_EVENT_TYPES = new Set([
  CLUB_ACTIVITY_EVENT_TYPES.NEWS,
  CLUB_ACTIVITY_EVENT_TYPES.UPDATE,
  CLUB_ACTIVITY_EVENT_TYPES.TOURNAMENT_ANNOUNCEMENT,
]);

export class ClubActivityValidationError extends Error {}
export class ClubActivityNotFoundError extends Error {}

export type ManualClubActivityInput = {
  eventType: string;
  title: string;
  body: string;
  imageUrl?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  status: "draft" | "published";
};

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ClubActivityValidationError(`${field} обязательно`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new ClubActivityValidationError(`${field}: максимум ${maxLength} символов`);
  }
  return normalized;
}

function optionalHttpUrl(value: string | null | undefined, field: string): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new ClubActivityValidationError(`${field}: некорректный URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ClubActivityValidationError(`${field}: разрешены только http и https`);
  }
  return parsed.toString();
}

export function validateClubActivityCta(
  labelValue?: string | null,
  urlValue?: string | null,
): { label: string | null; url: string | null } {
  const label = labelValue?.trim() ?? "";
  const url = urlValue?.trim() ?? "";
  if (!label && !url) return { label: null, url: null };
  if (!label || !url) {
    throw new ClubActivityValidationError("CTA должен содержать и название, и ссылку");
  }
  if (label.length > 80) {
    throw new ClubActivityValidationError("CTA: максимум 80 символов");
  }
  if (url.startsWith("/") && !url.startsWith("//")) return { label, url };
  return { label, url: optionalHttpUrl(url, "CTA URL") };
}

function normalizeManualInput(input: ManualClubActivityInput) {
  if (!MANUAL_EVENT_TYPES.has(input.eventType as never)) {
    throw new ClubActivityValidationError("Недопустимый тип ручной публикации");
  }
  if (input.status !== "draft" && input.status !== "published") {
    throw new ClubActivityValidationError("Недопустимый статус публикации");
  }
  const cta = validateClubActivityCta(input.ctaLabel, input.ctaUrl);
  return {
    event_type: input.eventType as "news" | "update" | "tournament_announcement",
    status: input.status,
    title: requiredText(input.title, "Заголовок", 200),
    body: requiredText(input.body, "Текст", 5000),
    image_url: optionalHttpUrl(input.imageUrl, "Изображение"),
    cta_label: cta.label,
    cta_url: cta.url,
  };
}

function enrichEvent(row: ClubActivityEventRecord): ClubActivityEvent {
  const definition = row.achievement_code
    ? getAchievementDefinition(row.achievement_code)
    : null;
  return {
    ...row,
    player: row.player
      ? {
          display_name: row.player.display_name,
          username: row.player.username,
          avatar_url: row.player.custom_avatar_url ?? row.player.telegram_avatar_url,
        }
      : null,
    achievement: definition
      ? {
          name: definition.name,
          description: definition.description,
          category: definition.category,
          icon: definition.icon,
          tier: definition.tier ?? null,
        }
      : null,
  };
}

function enrichComment(
  row: Awaited<ReturnType<ClubActivityRepository["listComments"]>>[number],
): ClubActivityComment {
  return {
    id: row.id,
    event_id: row.event_id,
    player_id: row.player_id,
    body: row.body,
    created_at: row.created_at,
    player: {
      id: row.player.id,
      display_name: row.player.display_name,
      avatar_url: row.player.custom_avatar_url ?? row.player.telegram_avatar_url,
    },
  };
}

export async function getPublishedClubActivity(
  limit = 20,
  offset = 0,
  repository: ClubActivityRepository = clubActivityRepository,
): Promise<ClubActivityEvent[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const safeOffset = Math.max(0, offset);
  return (await repository.listPublished(safeLimit, safeOffset)).map(enrichEvent);
}

export async function getPublishedClubActivityDetail(
  eventId: string,
  playerId?: string,
  repository: ClubActivityRepository = clubActivityRepository,
): Promise<ClubActivityDetail> {
  const event = await repository.findPublishedById(eventId);
  if (!event) throw new ClubActivityNotFoundError("Публикация не найдена");

  const [likeCount, likedByMe, comments] = await Promise.all([
    repository.countLikes(eventId),
    playerId ? repository.hasLike(eventId, playerId) : false,
    repository.listComments(eventId),
  ]);

  return {
    event: enrichEvent(event),
    likeCount,
    likedByMe,
    comments: comments.map(enrichComment),
  };
}

export async function toggleClubActivityLike(
  eventId: string,
  playerId: string,
  repository: ClubActivityRepository = clubActivityRepository,
) {
  const event = await repository.findPublishedById(eventId);
  if (!event) throw new ClubActivityNotFoundError("Публикация не найдена");

  const liked = await repository.toggleLike(eventId, playerId);
  return { liked, likeCount: await repository.countLikes(eventId) };
}

export async function createClubActivityComment(
  eventId: string,
  playerId: string,
  bodyValue: unknown,
  repository: ClubActivityRepository = clubActivityRepository,
): Promise<ClubActivityComment> {
  const body = requiredText(bodyValue, "Комментарий", 1000);
  const event = await repository.findPublishedById(eventId);
  if (!event) throw new ClubActivityNotFoundError("Публикация не найдена");
  return enrichComment(await repository.createComment(eventId, playerId, body));
}

export async function getClubActivityAdminList(
  repository: ClubActivityRepository = clubActivityRepository,
): Promise<ClubActivityEvent[]> {
  return (await repository.listAdmin(200)).map(enrichEvent);
}

export async function createManualClubActivity(
  input: ManualClubActivityInput,
  repository: ClubActivityRepository = clubActivityRepository,
): Promise<ClubActivityEvent> {
  const normalized = normalizeManualInput(input);
  const now = new Date().toISOString();
  return enrichEvent(await repository.createManual({
    ...normalized,
    published_at: normalized.status === "published" ? now : null,
  }));
}

export async function updateManualClubActivity(
  eventId: string,
  input: ManualClubActivityInput,
  repository: ClubActivityRepository = clubActivityRepository,
): Promise<ClubActivityEvent> {
  const existing = await repository.findById(eventId);
  if (!existing || existing.source !== "manual" || existing.status === "archived") {
    throw new ClubActivityValidationError("Публикация не найдена или недоступна для редактирования");
  }
  const normalized = normalizeManualInput(input);
  const publishedAt = normalized.status === "published"
    ? existing.published_at ?? new Date().toISOString()
    : null;
  const updated = await repository.updateManual(eventId, {
    ...normalized,
    published_at: publishedAt,
    updated_at: new Date().toISOString(),
  });
  if (!updated) throw new ClubActivityValidationError("Публикация не найдена");
  return enrichEvent(updated);
}

export async function archiveManualClubActivity(
  eventId: string,
  repository: ClubActivityRepository = clubActivityRepository,
): Promise<void> {
  const archived = await repository.archiveManual(eventId, new Date().toISOString());
  if (!archived) {
    throw new ClubActivityValidationError("Ручная публикация не найдена");
  }
}

function formatEventDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(value));
}

export async function publishTournamentWinnerEvent(
  tournamentId: string,
  winnerPlayerId: string | null,
  repository: ClubActivityRepository = clubActivityRepository,
): Promise<ClubActivityEvent | null> {
  if (!winnerPlayerId) return null;
  const [player, tournament] = await Promise.all([
    playerRepository.findById(winnerPlayerId),
    tournamentRepository.findById(tournamentId),
  ]);
  if (!player) return null;
  return enrichEvent(await repository.createAutomaticIdempotently({
    event_type: CLUB_ACTIVITY_EVENT_TYPES.TOURNAMENT_WINNER,
    title: `${player.display_name} выигрывает ${tournament.title}`,
    body: `1 место · ${formatEventDate(tournament.start_at)}`,
    image_url: null,
    cta_label: "Открыть турнир",
    cta_url: `/tournaments/${tournament.id}`,
    player_id: player.id,
    tournament_id: tournament.id,
    achievement_code: null,
    idempotency_key: `tournament-winner:${tournament.id}`,
    published_at: new Date().toISOString(),
  }));
}

export function isLegendaryAchievement(definition: AchievementDefinition): boolean {
  return definition.category === ACHIEVEMENT_CATEGORY.LEGENDARY;
}

export async function publishLegendaryAchievementEvent(
  playerId: string,
  achievementCode: string,
  repository: ClubActivityRepository = clubActivityRepository,
): Promise<ClubActivityEvent | null> {
  const definition = getAchievementDefinition(achievementCode);
  if (!definition || !isLegendaryAchievement(definition)) return null;
  const player = await playerRepository.findById(playerId);
  if (!player) return null;
  return enrichEvent(await repository.createAutomaticIdempotently({
    event_type: CLUB_ACTIVITY_EVENT_TYPES.ACHIEVEMENT,
    title: `${player.display_name} получает Legendary achievement`,
    body: `${definition.name} · ${definition.description}`,
    image_url: null,
    cta_label: "Открыть достижения",
    cta_url: `/players/${player.id}/achievements`,
    player_id: player.id,
    tournament_id: null,
    achievement_code: definition.code,
    idempotency_key: `achievement:${player.id}:${definition.code}`,
    published_at: new Date().toISOString(),
  }));
}
