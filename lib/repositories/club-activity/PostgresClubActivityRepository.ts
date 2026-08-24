import "server-only";

import { and, asc, count, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  clubActivityComments,
  clubActivityEvents,
  clubActivityLikes,
  players,
  tournaments,
} from "@/lib/db/schema";
import type {
  ClubActivityCommentRecord,
  ClubActivityFeedRecord,
  ClubActivityEventRecord,
  ClubActivityRepository,
  CreateAutomaticClubActivityEvent,
  CreateManualClubActivityEvent,
  UpdateManualClubActivityEvent,
} from "./ClubActivityRepository";

const eventSelection = {
  id: clubActivityEvents.id,
  event_type: clubActivityEvents.eventType,
  source: clubActivityEvents.source,
  status: clubActivityEvents.status,
  title: clubActivityEvents.title,
  body: clubActivityEvents.body,
  image_url: clubActivityEvents.imageUrl,
  cta_label: clubActivityEvents.ctaLabel,
  cta_url: clubActivityEvents.ctaUrl,
  player_id: clubActivityEvents.playerId,
  tournament_id: clubActivityEvents.tournamentId,
  achievement_code: clubActivityEvents.achievementCode,
  idempotency_key: clubActivityEvents.idempotencyKey,
  published_at: clubActivityEvents.publishedAt,
  created_at: clubActivityEvents.createdAt,
  updated_at: clubActivityEvents.updatedAt,
  player_display_name: players.displayName,
  player_username: players.username,
  player_telegram_avatar_url: players.telegramAvatarUrl,
  player_custom_avatar_url: players.customAvatarUrl,
  tournament_title: tournaments.title,
  tournament_start_at: tournaments.startAt,
};

type SelectedEvent = {
  id: string;
  event_type: string;
  source: string;
  status: string;
  title: string;
  body: string;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  player_id: string | null;
  tournament_id: string | null;
  achievement_code: string | null;
  idempotency_key: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
  player_display_name: string | null;
  player_username: string | null;
  player_telegram_avatar_url: string | null;
  player_custom_avatar_url: string | null;
  tournament_title: string | null;
  tournament_start_at: Date | null;
};

function mapEvent(row: SelectedEvent): ClubActivityEventRecord {
  return {
    id: row.id,
    event_type: row.event_type as ClubActivityEventRecord["event_type"],
    source: row.source as ClubActivityEventRecord["source"],
    status: row.status as ClubActivityEventRecord["status"],
    title: row.title,
    body: row.body,
    image_url: row.image_url,
    cta_label: row.cta_label,
    cta_url: row.cta_url,
    player_id: row.player_id,
    tournament_id: row.tournament_id,
    achievement_code: row.achievement_code,
    idempotency_key: row.idempotency_key,
    published_at: row.published_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    player: row.player_display_name
      ? {
          display_name: row.player_display_name,
          username: row.player_username,
          telegram_avatar_url: row.player_telegram_avatar_url,
          custom_avatar_url: row.player_custom_avatar_url,
        }
      : null,
    tournament: row.tournament_title && row.tournament_start_at
      ? { title: row.tournament_title, start_at: row.tournament_start_at.toISOString() }
      : null,
  };
}

function selectEvents() {
  return db
    .select(eventSelection)
    .from(clubActivityEvents)
    .leftJoin(players, eq(clubActivityEvents.playerId, players.id))
    .leftJoin(tournaments, eq(clubActivityEvents.tournamentId, tournaments.id));
}

export class PostgresClubActivityRepository implements ClubActivityRepository {
  async listPublished(limit: number, offset: number): Promise<ClubActivityEventRecord[]> {
    const rows = await selectEvents()
      .where(and(
        eq(clubActivityEvents.status, "published"),
        lte(clubActivityEvents.publishedAt, new Date()),
      ))
      .orderBy(desc(clubActivityEvents.publishedAt), desc(clubActivityEvents.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map((row) => mapEvent(row as SelectedEvent));
  }

  async listAdmin(limit: number): Promise<ClubActivityEventRecord[]> {
    const rows = await selectEvents()
      .orderBy(desc(clubActivityEvents.createdAt))
      .limit(limit);
    return rows.map((row) => mapEvent(row as SelectedEvent));
  }

  async findById(eventId: string): Promise<ClubActivityEventRecord | null> {
    const [row] = await selectEvents().where(eq(clubActivityEvents.id, eventId)).limit(1);
    return row ? mapEvent(row as SelectedEvent) : null;
  }

  async listPublishedWithSocial(
    limit: number,
    offset: number,
    playerId?: string,
  ): Promise<ClubActivityFeedRecord[]> {
    const likeCount = sql<number>`(
      SELECT count(*)::int FROM ${clubActivityLikes}
      WHERE ${clubActivityLikes.eventId} = ${clubActivityEvents.id}
    )`.mapWith(Number);
    const commentCount = sql<number>`(
      SELECT count(*)::int FROM ${clubActivityComments}
      WHERE ${clubActivityComments.eventId} = ${clubActivityEvents.id}
    )`.mapWith(Number);
    const likedByMe = playerId
      ? sql<boolean>`EXISTS (
          SELECT 1 FROM ${clubActivityLikes}
          WHERE ${clubActivityLikes.eventId} = ${clubActivityEvents.id}
            AND ${clubActivityLikes.playerId} = ${playerId}
        )`
      : sql<boolean>`false`;

    const rows = await db.select({
      ...eventSelection,
      like_count: likeCount,
      liked_by_me: likedByMe,
      comment_count: commentCount,
    })
      .from(clubActivityEvents)
      .leftJoin(players, eq(clubActivityEvents.playerId, players.id))
      .leftJoin(tournaments, eq(clubActivityEvents.tournamentId, tournaments.id))
      .where(and(
        eq(clubActivityEvents.status, "published"),
        lte(clubActivityEvents.publishedAt, new Date()),
      ))
      .orderBy(desc(clubActivityEvents.publishedAt), desc(clubActivityEvents.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((row) => ({
      ...mapEvent(row as SelectedEvent),
      like_count: row.like_count,
      liked_by_me: row.liked_by_me,
      comment_count: row.comment_count,
    }));
  }

  async findPublishedById(eventId: string): Promise<ClubActivityEventRecord | null> {
    const [row] = await selectEvents().where(and(
      eq(clubActivityEvents.id, eventId),
      eq(clubActivityEvents.status, "published"),
      lte(clubActivityEvents.publishedAt, new Date()),
    )).limit(1);
    return row ? mapEvent(row as SelectedEvent) : null;
  }

  async countLikes(eventId: string): Promise<number> {
    const [row] = await db.select({ value: count() })
      .from(clubActivityLikes)
      .where(eq(clubActivityLikes.eventId, eventId));
    return row?.value ?? 0;
  }

  async hasLike(eventId: string, playerId: string): Promise<boolean> {
    const [row] = await db.select({ eventId: clubActivityLikes.eventId })
      .from(clubActivityLikes)
      .where(and(
        eq(clubActivityLikes.eventId, eventId),
        eq(clubActivityLikes.playerId, playerId),
      ))
      .limit(1);
    return Boolean(row);
  }

  async toggleLike(eventId: string, playerId: string): Promise<boolean> {
    const [deleted] = await db.delete(clubActivityLikes)
      .where(and(
        eq(clubActivityLikes.eventId, eventId),
        eq(clubActivityLikes.playerId, playerId),
      ))
      .returning({ eventId: clubActivityLikes.eventId });
    if (deleted) return false;

    await db.insert(clubActivityLikes)
      .values({ eventId, playerId })
      .onConflictDoNothing();
    return true;
  }

  async listComments(eventId: string): Promise<ClubActivityCommentRecord[]> {
    const rows = await db.select({
      id: clubActivityComments.id,
      eventId: clubActivityComments.eventId,
      playerId: clubActivityComments.playerId,
      body: clubActivityComments.body,
      createdAt: clubActivityComments.createdAt,
      displayName: players.displayName,
      telegramAvatarUrl: players.telegramAvatarUrl,
      customAvatarUrl: players.customAvatarUrl,
    })
      .from(clubActivityComments)
      .innerJoin(players, eq(clubActivityComments.playerId, players.id))
      .where(eq(clubActivityComments.eventId, eventId))
      .orderBy(asc(clubActivityComments.createdAt));

    return rows.map((row) => ({
      id: row.id,
      event_id: row.eventId,
      player_id: row.playerId,
      body: row.body,
      created_at: row.createdAt.toISOString(),
      player: {
        id: row.playerId,
        display_name: row.displayName,
        telegram_avatar_url: row.telegramAvatarUrl,
        custom_avatar_url: row.customAvatarUrl,
      },
    }));
  }

  async createComment(
    eventId: string,
    playerId: string,
    body: string,
  ): Promise<ClubActivityCommentRecord> {
    const [created] = await db.insert(clubActivityComments)
      .values({ eventId, playerId, body })
      .returning({ id: clubActivityComments.id });
    const comments = await this.listComments(eventId);
    return comments.find((comment) => comment.id === created.id)!;
  }

  async createManual(input: CreateManualClubActivityEvent): Promise<ClubActivityEventRecord> {
    const [created] = await db.insert(clubActivityEvents).values({
      eventType: input.event_type,
      source: "manual",
      status: input.status,
      title: input.title,
      body: input.body,
      imageUrl: input.image_url,
      ctaLabel: input.cta_label,
      ctaUrl: input.cta_url,
      publishedAt: input.published_at ? new Date(input.published_at) : null,
    }).returning({ id: clubActivityEvents.id });
    return (await this.findById(created.id))!;
  }

  async updateAdmin(
    eventId: string,
    input: UpdateManualClubActivityEvent,
  ): Promise<ClubActivityEventRecord | null> {
    const values: Partial<typeof clubActivityEvents.$inferInsert> = {
      updatedAt: new Date(input.updated_at),
    };
    if (input.event_type !== undefined) values.eventType = input.event_type;
    if (input.status !== undefined) values.status = input.status;
    if (input.title !== undefined) values.title = input.title;
    if (input.body !== undefined) values.body = input.body;
    if (input.image_url !== undefined) values.imageUrl = input.image_url;
    if (input.cta_label !== undefined) values.ctaLabel = input.cta_label;
    if (input.cta_url !== undefined) values.ctaUrl = input.cta_url;
    if (input.published_at !== undefined) {
      values.publishedAt = input.published_at ? new Date(input.published_at) : null;
    }

    const [updated] = await db.update(clubActivityEvents)
      .set(values)
      .where(eq(clubActivityEvents.id, eventId))
      .returning({ id: clubActivityEvents.id });
    return updated ? this.findById(updated.id) : null;
  }

  async updateManual(eventId: string, input: UpdateManualClubActivityEvent) {
    return this.updateAdmin(eventId, input);
  }

  async archive(eventId: string, updatedAt: string): Promise<boolean> {
    const [updated] = await db.update(clubActivityEvents)
      .set({ status: "archived", updatedAt: new Date(updatedAt) })
      .where(eq(clubActivityEvents.id, eventId))
      .returning({ id: clubActivityEvents.id });
    return Boolean(updated);
  }

  async archiveManual(eventId: string, updatedAt: string) {
    return this.archive(eventId, updatedAt);
  }

  async createAutomaticIdempotently(
    input: CreateAutomaticClubActivityEvent,
  ): Promise<ClubActivityEventRecord> {
    const [created] = await db.insert(clubActivityEvents).values({
      eventType: input.event_type,
      source: "automatic",
      status: "published",
      title: input.title,
      body: input.body,
      imageUrl: input.image_url,
      ctaLabel: input.cta_label,
      ctaUrl: input.cta_url,
      playerId: input.player_id,
      tournamentId: input.tournament_id,
      achievementCode: input.achievement_code,
      idempotencyKey: input.idempotency_key,
      publishedAt: new Date(input.published_at),
    }).onConflictDoNothing().returning({ id: clubActivityEvents.id });

    if (created) return (await this.findById(created.id))!;

    const [existing] = await db.select({ id: clubActivityEvents.id })
      .from(clubActivityEvents)
      .where(eq(clubActivityEvents.idempotencyKey, input.idempotency_key))
      .limit(1);
    return (await this.findById(existing.id))!;
  }
}
