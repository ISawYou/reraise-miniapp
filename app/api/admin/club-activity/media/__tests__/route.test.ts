// POST /api/admin/club-activity/media -- authorization through the REAL
// middleware.ts / lib/admin-auth.ts / lib/admin-permissions.ts chain (only
// the player lookup and cookie verifier are stubbed, exactly like
// middleware.test.ts), plus the route handler's validation responses with
// real sharp.
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { createHmac } from "crypto";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  findByTelegramId: vi.fn(),
  verifySession: vi.fn(),
  saved: [] as Array<{ fileName: string; bytes: Buffer }>,
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {
    findById: mocks.findById,
    findByTelegramId: mocks.findByTelegramId,
  },
}));
vi.mock("@/lib/repositories/club-activity-media-storage", () => ({
  clubActivityMediaStorageRepository: {
    save: vi.fn(async (fileName: string, bytes: Buffer) => {
      mocks.saved.push({ fileName, bytes });
      return `https://re-raise.ru/storage/club-activity/${fileName}`;
    }),
  },
}));
vi.mock("@/lib/telegram-web-session", () => ({
  COOKIE_NAME: "reraise_session",
  verifySession: mocks.verifySession,
}));

import { middleware } from "@/middleware";
import { isAdminRouteAllowedForOperator } from "@/lib/admin-permissions";
import { POST } from "@/app/api/admin/club-activity/media/route";

const URL_PATH = "https://re-raise.ru/api/admin/club-activity/media";
const BOT_TOKEN = "123456:TEST-ONLY-NOT-REAL";

function multipart(file: { name: string; type: string; bytes: Uint8Array } | null) {
  const boundary = "----qa-boundary-7d3f";
  const parts: Buffer[] = [];
  if (file) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ));
    parts.push(Buffer.from(file.bytes));
    parts.push(Buffer.from("\r\n"));
  } else {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="other"\r\n\r\nvalue\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function uploadRequest(
  file: { name: string; type: string; bytes: Uint8Array } | null,
  headers: Record<string, string> = {},
) {
  const { body, contentType } = multipart(file);
  return new NextRequest(URL_PATH, {
    method: "POST",
    headers: { "content-type": contentType, "content-length": String(body.length), ...headers },
    body,
  });
}

function signedInitData(telegramId: number, token = BOT_TOKEN) {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify({ id: telegramId, first_name: "Admin" }));
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

async function png(width = 1200, height = 675) {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 40, g: 160, b: 90 } } }).png().toBuffer(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saved.length = 0;
  vi.stubEnv("TELEGRAM_BOT_TOKEN", BOT_TOKEN);
  // The shared vitest setup runs in jsdom, whose File/Blob globals undici's
  // multipart parser (request.formData()) refuses -- use Node's own, which
  // is what the production Node server has.
  vi.stubGlobal("File", NodeFile);
  vi.stubGlobal("Blob", NodeBlob);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("media upload authorization (real middleware chain)", () => {
  it("rejects an unauthenticated upload with 401", async () => {
    mocks.verifySession.mockReturnValue(null);
    const response = await middleware(uploadRequest({ name: "a.png", type: "image/png", bytes: await png() }));
    expect(response.status).toBe(401);
  });

  it("rejects an ordinary player with 403", async () => {
    mocks.verifySession.mockReturnValue("player-1");
    mocks.findById.mockResolvedValue({ id: "player-1", role: "player" });
    const response = await middleware(uploadRequest(
      { name: "a.png", type: "image/png", bytes: await png() },
      { cookie: "reraise_session=signed" },
    ));
    expect(response.status).toBe(403);
  });

  it("rejects an operator with 403 -- same as the sibling club-activity admin mutations (not allowlisted)", async () => {
    expect(isAdminRouteAllowedForOperator("POST", "/api/admin/club-activity/media")).toBe(false);
    expect(isAdminRouteAllowedForOperator("POST", "/api/admin/club-activity")).toBe(false);
    mocks.verifySession.mockReturnValue("op-1");
    mocks.findById.mockResolvedValue({ id: "op-1", role: "operator" });
    const response = await middleware(uploadRequest(
      { name: "a.png", type: "image/png", bytes: await png() },
      { cookie: "reraise_session=signed" },
    ));
    expect(response.status).toBe(403);
  });

  it("admits a Super Admin via the session cookie", async () => {
    mocks.verifySession.mockReturnValue("admin-1");
    mocks.findById.mockResolvedValue({ id: "admin-1", role: "admin" });
    const response = await middleware(uploadRequest(
      { name: "a.png", type: "image/png", bytes: await png() },
      { cookie: "reraise_session=signed" },
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("admits a Super Admin via genuinely HMAC-signed Telegram initData, and rejects a forged signature", async () => {
    mocks.findByTelegramId.mockResolvedValue({ id: "admin-1", role: "admin" });
    const ok = await middleware(uploadRequest(
      { name: "a.png", type: "image/png", bytes: await png() },
      { "x-telegram-init-data": signedInitData(777) },
    ));
    expect(ok.status).toBe(200);

    const forged = await middleware(uploadRequest(
      { name: "a.png", type: "image/png", bytes: await png() },
      { "x-telegram-init-data": signedInitData(777, "999:WRONG-TOKEN") },
    ));
    expect(forged.status).toBe(401);
  });
});

describe("POST /api/admin/club-activity/media handler", () => {
  it("returns 201 with a permanent https /storage/club-activity WebP URL for a valid PNG", async () => {
    const response = await POST(uploadRequest({ name: "../../My Photo.png", type: "image/png", bytes: await png() }));
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.url).toMatch(/^https:\/\/re-raise\.ru\/storage\/club-activity\/\d+-[0-9a-f-]{36}\.webp$/);
    expect(payload.url).not.toContain("My Photo");
    expect([payload.width, payload.height]).toEqual([1200, 675]);
    expect(mocks.saved).toHaveLength(1);
    expect((await sharp(mocks.saved[0].bytes).metadata()).format).toBe("webp");
  });

  it("422 for a spoofed image/png that is really text; nothing stored", async () => {
    const response = await POST(uploadRequest({ name: "x.png", type: "image/png", bytes: new TextEncoder().encode("hello") }));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("Не удалось обработать изображение");
    expect(mocks.saved).toHaveLength(0);
  });

  it("415 for a non-image declared type and for HEIC", async () => {
    const pdf = await POST(uploadRequest({ name: "x.pdf", type: "application/pdf", bytes: new Uint8Array([1, 2, 3]) }));
    expect(pdf.status).toBe(415);
    const heic = await POST(uploadRequest({ name: "x.heic", type: "image/heic", bytes: new Uint8Array([1, 2, 3]) }));
    expect(heic.status).toBe(415);
    expect((await heic.json()).error).toContain("Этот формат изображения не поддерживается");
  });

  it("413 for an oversized upload (just over 8 MB), before parsing the body", async () => {
    const big = new Uint8Array(8 * 1024 * 1024 + 70 * 1024);
    const response = await POST(uploadRequest({ name: "big.jpg", type: "image/jpeg", bytes: big }));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain("Файл слишком большой");
  });

  it("413 for a file just over the limit even when the request itself is within the header slack", async () => {
    const justOver = new Uint8Array(8 * 1024 * 1024 + 1);
    const response = await POST(uploadRequest({ name: "big.jpg", type: "image/jpeg", bytes: justOver }));
    expect(response.status).toBe(413);
  });

  it("400 when no file part is present", async () => {
    const response = await POST(uploadRequest(null));
    expect(response.status).toBe(400);
  });
});
