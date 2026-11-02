import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), getPublicUrl: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/repositories", () => ({
  avatarStorageRepository: { upload: mocks.upload, getPublicUrl: mocks.getPublicUrl },
  playerRepository: { update: mocks.update },
  contentTypeToExtension: () => "jpg",
}));

const { syncTelegramAvatar } = await import("@/lib/avatar-sync");
const { getPlayerAvatarFallback, getPlayerAvatarUrl } = await import("@/lib/player-avatar");

function player(overrides: Partial<Player> = {}): Player {
  return {
    id: "player-1",
    telegram_id: 1,
    username: null,
    display_name: "Alice",
    role: "player",
    is_blocked: false,
    merged_into_player_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Player;
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.upload.mockReset().mockResolvedValue({ error: null });
  mocks.getPublicUrl.mockReset().mockReturnValue("/storage/avatars/player-1/telegram-avatar.jpg");
  mocks.update.mockReset();
});

describe("avatar precedence", () => {
  it("manual custom avatar wins over Telegram", () => {
    expect(getPlayerAvatarUrl(player({ custom_avatar_url: "https://custom/photo", telegram_avatar_url: "https://telegram/photo" }))).toBe("https://custom/photo");
  });

  it("falls back from custom to Telegram, then initials", () => {
    expect(getPlayerAvatarUrl(player({ custom_avatar_url: undefined, telegram_avatar_url: "https://telegram/photo" }))).toBe("https://telegram/photo");
    expect(getPlayerAvatarUrl(player({ custom_avatar_url: undefined, telegram_avatar_url: undefined }))).toBeNull();
    expect(getPlayerAvatarFallback(player({ display_name: "alice" }))).toBe("A");
  });

  it("never overwrites a manual custom URL even when it does not contain /avatar", async () => {
    const current = player({ custom_avatar_url: "https://images.example/u/portrait.webp" });
    expect(await syncTelegramAvatar(current, "https://telegram/photo.jpg")).toBe(current);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("reuses an existing Telegram-synced local avatar", async () => {
    const current = player({ custom_avatar_url: "/storage/avatars/player-1/telegram-avatar.jpg" });
    expect(await syncTelegramAvatar(current, "https://telegram/new.jpg")).toBe(current);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("missing or inaccessible Telegram photo is best-effort and preserves login", async () => {
    const current = player({ custom_avatar_url: undefined });
    expect(await syncTelegramAvatar(current, null)).toBe(current);

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("expired"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await syncTelegramAvatar(current, "https://telegram/expired.jpg")).toBe(current);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
