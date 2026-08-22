import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClubActivityEventRecord,
  ClubActivityRepository,
  CreateAutomaticClubActivityEvent,
  CreateManualClubActivityEvent,
  UpdateManualClubActivityEvent,
} from "@/lib/repositories/club-activity";

const mocks = vi.hoisted(() => ({
  findPlayer: vi.fn(),
  findTournament: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  clubActivityRepository: {},
  playerRepository: { findById: mocks.findPlayer },
  tournamentRepository: { findById: mocks.findTournament },
}));

import {
  ClubActivityValidationError,
  createManualClubActivity,
  getPublishedClubActivity,
  publishLegendaryAchievementEvent,
  publishTournamentWinnerEvent,
  updateManualClubActivity,
  validateClubActivityCta,
} from "@/features/club-activity";

function record(overrides: Partial<ClubActivityEventRecord> = {}): ClubActivityEventRecord {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    event_type: overrides.event_type ?? "news",
    source: overrides.source ?? "manual",
    status: overrides.status ?? "draft",
    title: overrides.title ?? "Title",
    body: overrides.body ?? "Body",
    image_url: overrides.image_url ?? null,
    cta_label: overrides.cta_label ?? null,
    cta_url: overrides.cta_url ?? null,
    player_id: overrides.player_id ?? null,
    tournament_id: overrides.tournament_id ?? null,
    achievement_code: overrides.achievement_code ?? null,
    idempotency_key: overrides.idempotency_key ?? null,
    published_at: overrides.published_at ?? null,
    created_at: overrides.created_at ?? new Date().toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
    player: overrides.player ?? null,
    tournament: overrides.tournament ?? null,
  };
}

class MemoryActivityRepository implements ClubActivityRepository {
  rows: ClubActivityEventRecord[] = [];
  lastPublishedQuery: { limit: number; offset: number } | null = null;

  async listPublished(limit: number, offset: number) {
    this.lastPublishedQuery = { limit, offset };
    return this.rows
      .filter((row) => row.status === "published")
      .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
      .slice(offset, offset + limit);
  }
  async listAdmin(limit: number) { return this.rows.slice(0, limit); }
  async findById(eventId: string) { return this.rows.find((row) => row.id === eventId) ?? null; }
  async createManual(input: CreateManualClubActivityEvent) {
    const row = record({ ...input, source: "manual" });
    this.rows.push(row);
    return row;
  }
  async updateManual(eventId: string, input: UpdateManualClubActivityEvent) {
    const index = this.rows.findIndex((row) => row.id === eventId && row.source === "manual");
    if (index < 0) return null;
    this.rows[index] = record({ ...this.rows[index], ...input });
    return this.rows[index];
  }
  async archiveManual(eventId: string) {
    const row = this.rows.find((item) => item.id === eventId && item.source === "manual");
    if (!row) return false;
    row.status = "archived";
    return true;
  }
  async createAutomaticIdempotently(input: CreateAutomaticClubActivityEvent) {
    const existing = this.rows.find((row) => row.idempotency_key === input.idempotency_key);
    if (existing) {
      Object.assign(existing, input);
      return existing;
    }
    const row = record({ ...input, source: "automatic", status: "published" });
    this.rows.push(row);
    return row;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findPlayer.mockResolvedValue({
    id: "player-1",
    display_name: "Кирилл",
    username: "kirill",
    custom_avatar_url: null,
    telegram_avatar_url: null,
  });
  mocks.findTournament.mockResolvedValue({
    id: "tournament-1",
    title: "Friday Night Poker",
    start_at: "2026-08-22T16:00:00.000Z",
  });
});

describe("Club Activity manual publications", () => {
  it("creates draft and published events while the feed returns published newest-first", async () => {
    const repository = new MemoryActivityRepository();
    await createManualClubActivity({
      eventType: "news", title: "Черновик", body: "Не показывать", status: "draft",
    }, repository);
    await createManualClubActivity({
      eventType: "update", title: "Первое", body: "Показывать", status: "published",
    }, repository);
    await createManualClubActivity({
      eventType: "news", title: "Второе", body: "Показывать", status: "published",
    }, repository);

    const feed = await getPublishedClubActivity(3, 0, repository);
    expect(repository.lastPublishedQuery).toEqual({ limit: 3, offset: 0 });
    expect(feed).toHaveLength(2);
    expect(feed.every((event) => event.status === "published")).toBe(true);
  });

  it("publishes and hides the same manual event without creating another row", async () => {
    const repository = new MemoryActivityRepository();
    const created = await createManualClubActivity({
      eventType: "news", title: "Новость", body: "Текст", status: "draft",
    }, repository);
    const published = await updateManualClubActivity(created.id, {
      eventType: "news", title: "Новость", body: "Текст", status: "published",
    }, repository);
    const hidden = await updateManualClubActivity(created.id, {
      eventType: "news", title: "Новость", body: "Текст", status: "draft",
    }, repository);

    expect(repository.rows).toHaveLength(1);
    expect(published.published_at).not.toBeNull();
    expect(hidden.status).toBe("draft");
    expect(hidden.published_at).toBeNull();
  });

  it("rejects automatic types and unsafe CTA URLs in the manual API", async () => {
    const repository = new MemoryActivityRepository();
    await expect(createManualClubActivity({
      eventType: "achievement", title: "Fake", body: "Fake", status: "published",
    }, repository)).rejects.toBeInstanceOf(ClubActivityValidationError);
    expect(() => validateClubActivityCta("Открыть", "javascript:alert(1)")).toThrow(/http/);
    expect(() => validateClubActivityCta("Открыть", "//evil.example")).toThrow();
    expect(validateClubActivityCta("Академия", "/academy")).toEqual({
      label: "Академия", url: "/academy",
    });
  });
});

describe("Club Activity automatic events", () => {
  it("uses one deterministic event for repeated tournament winner publication", async () => {
    const repository = new MemoryActivityRepository();
    await publishTournamentWinnerEvent("tournament-1", "player-1", repository);
    await publishTournamentWinnerEvent("tournament-1", "player-1", repository);

    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0]).toMatchObject({
      event_type: "tournament_winner",
      idempotency_key: "tournament-winner:tournament-1",
      player_id: "player-1",
      tournament_id: "tournament-1",
    });
  });

  it("publishes Legendary metadata once and ignores a non-Legendary achievement", async () => {
    const repository = new MemoryActivityRepository();
    await publishLegendaryAchievementEvent("player-1", "headhunter", repository);
    await publishLegendaryAchievementEvent("player-1", "headhunter", repository);
    const ordinary = await publishLegendaryAchievementEvent("player-1", "first_tournament", repository);

    expect(ordinary).toBeNull();
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0]).toMatchObject({
      event_type: "achievement",
      achievement_code: "headhunter",
      idempotency_key: "achievement:player-1:headhunter",
    });
  });
});
