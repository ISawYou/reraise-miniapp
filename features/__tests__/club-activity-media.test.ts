// Club Activity media storage + upload orchestration, on a REAL temporary
// directory with the real Local repository and real sharp.
import { mkdtemp, readdir, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests inject a Local repository rooted in a temp dir instead of the
// default instance (which would write under the project's public/storage).
vi.mock("@/lib/repositories/club-activity-media-storage", () => ({
  clubActivityMediaStorageRepository: { save: vi.fn() },
}));
import { uploadClubActivityImage } from "@/features/club-activity-media";
import { ClubActivityImageError } from "@/lib/club-activity-image";
import {
  CLUB_ACTIVITY_MEDIA_FILE_NAME,
  LocalClubActivityMediaStorageRepository,
} from "@/lib/repositories/club-activity-media-storage/LocalClubActivityMediaStorageRepository";

let sandbox: string;
let storageRoot: string;
let storage: LocalClubActivityMediaStorageRepository;

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(os.tmpdir(), "club-activity-media-"));
  storageRoot = path.join(sandbox, "public", "storage", "club-activity");
  storage = new LocalClubActivityMediaStorageRepository(storageRoot, "https://re-raise.ru");
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

async function pngFile(name = "photo.png", width = 1600, height = 900) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

async function listSandbox(dir = sandbox): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listSandbox(full)));
    else out.push(path.relative(sandbox, full));
  }
  return out;
}

describe("uploadClubActivityImage", () => {
  it("stores a normalized WebP and returns a public HTTPS same-origin /storage URL", async () => {
    const result = await uploadClubActivityImage(await pngFile(), storage);
    expect(result.url).toMatch(/^https:\/\/re-raise\.ru\/storage\/club-activity\/[^/]+\.webp$/);
    expect([result.width, result.height]).toEqual([1440, 810]);

    const fileName = result.url.split("/").pop()!;
    expect(fileName).toMatch(CLUB_ACTIVITY_MEDIA_FILE_NAME);
    const stored = await readFile(path.join(storageRoot, fileName));
    expect(stored.length).toBe(result.bytes);
    expect((await sharp(stored).metadata()).format).toBe("webp");
  });

  it("generates unique, non-colliding file names and never reuses the client name", async () => {
    const urls = await Promise.all(
      Array.from({ length: 12 }, () => uploadClubActivityImage(new File([], "x"), storage).catch(() => null)),
    );
    expect(urls.every((u) => u === null)).toBe(true); // empty files rejected, nothing written

    const results = [];
    for (let i = 0; i < 12; i++) results.push(await uploadClubActivityImage(await pngFile("same-name.png", 64, 36), storage));
    const names = results.map((r) => r.url.split("/").pop());
    expect(new Set(names).size).toBe(12);
    expect(names.some((n) => n?.includes("same-name"))).toBe(false);
    expect((await readdir(storageRoot)).length).toBe(12);
  });

  it("a path-traversal client file name cannot escape the managed storage root", async () => {
    const result = await uploadClubActivityImage(await pngFile("../../../../etc/passwd.png"), storage);
    expect(result.url).not.toContain("..");
    expect(result.url).not.toContain("passwd");
    // The only file written anywhere in the sandbox is inside the managed dir.
    const files = await listSandbox();
    expect(files).toHaveLength(1);
    expect(files[0].startsWith(path.join("public", "storage", "club-activity") + path.sep)).toBe(true);
  });

  it("rejects a spoofed MIME type whose bytes do not decode, writing nothing", async () => {
    const spoofed = new File([new TextEncoder().encode("<?php echo 'not an image'; ?>")], "evil.png", { type: "image/png" });
    await expect(uploadClubActivityImage(spoofed, storage)).rejects.toMatchObject({ code: "not_image" });
    await expect(uploadClubActivityImage(spoofed, storage)).rejects.toBeInstanceOf(ClubActivityImageError);
    expect(await listSandbox()).toEqual([]);
  });

  it("rejects a non-image declared type even if the bytes are an image", async () => {
    const real = await pngFile();
    const declaredPdf = new File([await real.arrayBuffer()], "doc.pdf", { type: "application/pdf" });
    await expect(uploadClubActivityImage(declaredPdf, storage)).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("rejects an oversized upload before reading/decoding it", async () => {
    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" });
    await expect(uploadClubActivityImage(big, storage)).rejects.toMatchObject({ code: "too_large" });
    expect(await listSandbox()).toEqual([]);
  });
});

describe("LocalClubActivityMediaStorageRepository", () => {
  const validName = "1760000000000-0f8fad5b-d9cb-469f-a165-70867728950e.webp";

  it.each([
    "../escape.webp",
    "..%2Fescape.webp",
    "sub/dir.webp",
    "/etc/passwd",
    "1760000000000-0f8fad5b-d9cb-469f-a165-70867728950e.png",
    "photo.webp",
    `${validName}/../../x.webp`,
  ])("refuses the non-generated name %s", async (name) => {
    await expect(storage.save(name, Buffer.from("x"))).rejects.toThrow();
    expect(await listSandbox()).toEqual([]);
  });

  it("never overwrites an existing file", async () => {
    await storage.save(validName, Buffer.from("first"));
    await expect(storage.save(validName, Buffer.from("second"))).rejects.toThrow();
    expect((await readFile(path.join(storageRoot, validName))).toString()).toBe("first");
  });

  it("refuses to produce a URL when the public app URL is not configured", async () => {
    const unconfigured = new LocalClubActivityMediaStorageRepository(storageRoot, "");
    await expect(unconfigured.save(validName, Buffer.from("x"))).rejects.toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});
