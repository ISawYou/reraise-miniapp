import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/types/domain";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findByTelegramId: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
  cookieJar: new Map<string, string>(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {
    findById: mocks.findById,
    findByTelegramId: mocks.findByTelegramId,
    update: mocks.update,
  },
  avatarStorageRepository: { upload: mocks.upload, getPublicUrl: mocks.getPublicUrl },
  contentTypeToExtension: (type: string) =>
    ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[type] ?? "jpg",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookieJar.get(name);
      return value === undefined ? undefined : { value };
    },
  }),
}));

const { POST } = await import("@/app/api/players/[id]/avatar/route");
const { COOKIE_NAME, signSession } = await import("@/lib/telegram-web-session");

const BOT_TOKEN = "123456:avatar-route-test-token";
const BASE_URL = "https://re-raise.ru/api/players";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    telegram_id: null,
    username: null,
    display_name: id,
    role: "player",
    is_blocked: false,
    merged_into_player_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Player;
}

function signedInitData(telegramId: number, ageSeconds = 60) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000) - ageSeconds),
    user: JSON.stringify({ id: telegramId }),
  });
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(checkString).digest("hex"));
  return params.toString();
}

function fileFor(type = "image/jpeg", bytes: Uint8Array = JPEG) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([buffer], `avatar.${type.split("/")[1]}`, { type });
}

function request(
  targetId: string,
  options: {
    origin?: string | null;
    initData?: string;
    file?: File;
    formPlayerId?: string;
  } = {}
) {
  const headers = new Headers();
  if (options.origin !== null) headers.set("origin", options.origin ?? "https://re-raise.ru");
  if (options.initData) headers.set("x-telegram-init-data", options.initData);
  const formData = new FormData();
  formData.set("file", options.file ?? fileFor());
  if (options.formPlayerId) formData.set("playerId", options.formPlayerId);
  return {
    url: `${BASE_URL}/${targetId}/avatar`,
    headers,
    formData: async () => formData,
  } as unknown as Request;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const call = (id: string, options?: Parameters<typeof request>[1]) => POST(request(id, options), ctx(id));

function signIn(id: string, valid = true) {
  mocks.cookieJar.set(COOKIE_NAME, valid ? signSession(id) : `${id}.${"0".repeat(64)}`);
}

beforeEach(() => {
  process.env.SESSION_SECRET = "avatar-route-test-secret";
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  mocks.cookieJar = new Map();
  for (const fn of [mocks.findById, mocks.findByTelegramId, mocks.update, mocks.upload, mocks.getPublicUrl]) fn.mockReset();
  mocks.findById.mockImplementation(async (id: string) => player(id));
  mocks.findByTelegramId.mockImplementation(async (id: number) => player(`tg-${id}`, { telegram_id: id }));
  mocks.update.mockImplementation(async (id: string, values: Partial<Player>) => player(id, values));
  mocks.upload.mockResolvedValue({ error: null });
  mocks.getPublicUrl.mockImplementation((path: string) => `https://re-raise.ru/storage/avatars/${path}`);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/players/[id]/avatar authentication", () => {
  it("accepts a same-origin signed web session without initData", async () => {
    signIn("player-1");
    expect((await call("player-1")).status).toBe(200);
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^player-1\/avatar-[0-9a-f-]{36}\.jpg$/),
      expect.any(ArrayBuffer),
      "image/jpeg"
    );
  });

  it("accepts a verified Telegram Mini App credential without a cookie or Origin", async () => {
    const response = await call("tg-777", { origin: null, initData: signedInitData(777) });
    expect(response.status).toBe(200);
    expect(mocks.findByTelegramId).toHaveBeenCalledWith(777);
  });

  it.each([
    ["missing credentials", () => undefined],
    ["invalid cookie", () => signIn("player-1", false)],
  ])("rejects %s", async (_label, arrange) => {
    arrange();
    expect((await call("player-1")).status).toBe(401);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects invalid and expired Telegram credentials alone", async () => {
    expect((await call("tg-777", { origin: null, initData: "user=x&hash=bad" })).status).toBe(401);
    expect((await call("tg-777", { origin: null, initData: signedInitData(777, 7200) })).status).toBe(401);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("forbids actor A from uploading to B, regardless of a spoofed form playerId", async () => {
    signIn("player-a");
    const response = await call("player-b", { formPlayerId: "player-a" });
    expect(response.status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("denies blocked actors with zero writes", async () => {
    signIn("blocked");
    mocks.findById.mockResolvedValue(player("blocked", { is_blocked: true }));
    expect((await call("blocked")).status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("cannot write under a merged-away route id", async () => {
    signIn("source");
    mocks.findById.mockImplementation(async (id: string) =>
      id === "source" ? player("source", { merged_into_player_id: "target" }) : player("target")
    );
    expect((await call("source")).status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects foreign Origin and cookie before writes", async () => {
    signIn("player-1");
    expect((await call("player-1", { origin: "https://evil.example" })).status).toBe(403);
    expect(mocks.findById).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects cookie-only requests with no same-origin evidence", async () => {
    signIn("player-1");
    expect((await call("player-1", { origin: null })).status).toBe(401);
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it("allows same-origin cookie fallback when a stale Telegram header coexists", async () => {
    signIn("player-1");
    expect((await call("player-1", { initData: signedInitData(777, 7200) })).status).toBe(200);
  });
});

describe("POST /api/players/[id]/avatar validation and persistence", () => {
  beforeEach(() => signIn("player-1"));

  it.each([
    ["image/jpeg", JPEG, "jpg"],
    ["image/png", PNG, "png"],
    ["image/webp", WEBP, "webp"],
  ])("stores valid %s with its real extension", async (type, bytes, extension) => {
    const response = await call("player-1", { file: fileFor(type, bytes) });
    expect(response.status).toBe(200);
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^player-1/avatar-[0-9a-f-]{36}\\.${extension}$`)),
      expect.any(ArrayBuffer),
      type
    );
  });

  it.each([
    fileFor("image/svg+xml", new TextEncoder().encode("<svg/>")),
    fileFor("image/jpeg", new TextEncoder().encode("not a jpeg")),
  ])("rejects unsupported or signature-mismatched files", async (file) => {
    expect((await call("player-1", { file })).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects files over 20 MB", async () => {
    const bytes = new Uint8Array(20 * 1024 * 1024 + 1);
    bytes.set(JPEG);
    expect((await call("player-1", { file: fileFor("image/jpeg", bytes) })).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("returns an error and performs no player update when storage fails", async () => {
    mocks.upload.mockResolvedValue({ error: "disk path /secret failed" });
    const response = await call("player-1");
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("/secret");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not report success when the player update fails", async () => {
    mocks.update.mockRejectedValue(new Error("SQL internal detail"));
    const response = await call("player-1");
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("SQL internal detail");
  });

  it("keeps existing avatar A intact and addressable when upload B is followed by a DB failure", async () => {
    const oldPath = "player-1/avatar-existing.jpg";
    const oldUrl = `https://re-raise.ru/storage/avatars/${oldPath}?v=1`;
    const storedObjects = new Map<string, string>([[oldPath, "avatar-a-bytes"]]);
    const persistedPlayer = player("player-1", { custom_avatar_url: oldUrl });
    mocks.upload.mockImplementation(async (path: string) => {
      storedObjects.set(path, "avatar-b-bytes");
      return { error: null };
    });
    mocks.getPublicUrl.mockImplementation((path: string) => `https://re-raise.ru/storage/avatars/${path}`);
    mocks.update.mockRejectedValue(new Error("database unavailable"));

    const response = await call("player-1");

    expect(response.status).toBe(500);
    const newPath = mocks.upload.mock.calls[0][0] as string;
    expect(newPath).toMatch(/^player-1\/avatar-[0-9a-f-]{36}\.jpg$/);
    expect(newPath).not.toBe(oldPath);
    expect(storedObjects.get(oldPath)).toBe("avatar-a-bytes");
    expect(storedObjects.get(newPath)).toBe("avatar-b-bytes");
    expect(persistedPlayer.custom_avatar_url).toBe(oldUrl);
  });

  it("persists a cache-busted URL and avatar_updated_at for the authenticated actor", async () => {
    const response = await call("player-1", { formPlayerId: "../../victim" });
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("player-1", {
      custom_avatar_url: expect.stringMatching(/\/avatar-[0-9a-f-]{36}\.jpg\?v=\d+$/),
      avatar_updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(mocks.upload.mock.calls[0][0]).toMatch(/^player-1\/avatar-[0-9a-f-]{36}\.jpg$/);
  });
});
