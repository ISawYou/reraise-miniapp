import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPlayerRepository = { findByTelegramId: vi.fn(), update: vi.fn() };
const mockAvatarStorageRepository = { upload: vi.fn(), getPublicUrl: vi.fn() };

vi.mock("@/lib/repositories", () => ({
  playerRepository: mockPlayerRepository,
  avatarStorageRepository: mockAvatarStorageRepository,
  contentTypeToExtension: () => "jpg",
}));

const { POST } = await import("@/app/api/players/[id]/avatar/route");

const BOT_TOKEN = "test-bot-token";

function signedInitData(user: { id: number }) {
  const params = new URLSearchParams();
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));
  params.set("user", JSON.stringify(user));

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  params.set("hash", hash);
  return params.toString();
}

// Building a real multipart body via `new Request(..., { body: formData })`
// and letting the route's own `request.formData()` re-parse it trips an
// undici/jsdom File-brand mismatch in this test environment (unrelated to
// the route itself) -- so the fake request here skips real multipart
// encoding and just hands back the same FormData the route reads from.
function uploadRequest(initData: string) {
  const formData = new FormData();
  formData.set("file", new File(["x"], "avatar.jpg", { type: "image/jpeg" }));
  formData.set("telegramInitData", initData);

  return {
    formData: async () => formData,
  } as unknown as Request;
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  mockPlayerRepository.findByTelegramId.mockReset();
  mockPlayerRepository.update.mockReset();
  mockAvatarStorageRepository.upload.mockReset().mockResolvedValue({ error: null });
  mockAvatarStorageRepository.getPublicUrl.mockReset().mockReturnValue("https://cdn/avatar.jpg");
});

describe("POST /api/players/[id]/avatar", () => {
  it("rejects upload for a blocked player even with valid Telegram initData", async () => {
    mockPlayerRepository.findByTelegramId.mockResolvedValue({
      id: "player-1",
      is_blocked: true,
    });

    const response = await POST(
      uploadRequest(signedInitData({ id: 555 })),
      ctx("player-1")
    );

    expect(response.status).toBe(403);
    expect(mockAvatarStorageRepository.upload).not.toHaveBeenCalled();
    expect(mockPlayerRepository.update).not.toHaveBeenCalled();
  });

  it("allows upload for an active player", async () => {
    mockPlayerRepository.findByTelegramId.mockResolvedValue({
      id: "player-1",
      is_blocked: false,
    });
    mockPlayerRepository.update.mockResolvedValue({ id: "player-1", is_blocked: false });

    const response = await POST(
      uploadRequest(signedInitData({ id: 555 })),
      ctx("player-1")
    );

    expect(response.status).toBe(200);
    expect(mockAvatarStorageRepository.upload).toHaveBeenCalled();
  });
});
