import "server-only";

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { ClubActivityMediaStorageRepository } from "./ClubActivityMediaStorageRepository";

// Same filesystem + nginx pattern as LocalAvatarStorageRepository /
// LocalTournamentAssetStorageRepository: `public/storage` is the production
// `./storage:/app/public/storage` bind mount (docker-compose.yml), and nginx
// serves `/storage/` straight from that host directory (see
// docs/architecture.md, "Как nginx их раздаёт") -- viewing an uploaded image
// never goes through Node.
export const CLUB_ACTIVITY_MEDIA_PUBLIC_DIR = "club-activity";
const DEFAULT_STORAGE_ROOT = path.join(
  process.cwd(),
  "public",
  "storage",
  CLUB_ACTIVITY_MEDIA_PUBLIC_DIR,
);
const DEFAULT_PUBLIC_BASE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

// Server-generated names only (`<timestamp>-<uuid>.webp`). Anything else --
// a path separator, `..`, a different extension -- is refused outright
// before touching the filesystem.
export const CLUB_ACTIVITY_MEDIA_FILE_NAME = /^[0-9]{10,16}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export class LocalClubActivityMediaStorageRepository
  implements ClubActivityMediaStorageRepository
{
  constructor(
    private readonly storageRoot: string = DEFAULT_STORAGE_ROOT,
    private readonly publicBaseUrl: string = DEFAULT_PUBLIC_BASE_URL,
  ) {}

  async save(fileName: string, bytes: Buffer): Promise<string> {
    if (!CLUB_ACTIVITY_MEDIA_FILE_NAME.test(fileName)) {
      throw new Error("Invalid club activity media file name");
    }
    if (!/^https?:\/\//.test(this.publicBaseUrl)) {
      // Without an absolute app URL the result could not be stored as a
      // publication image_url (it must be an absolute http(s) URL).
      throw new Error("NEXT_PUBLIC_APP_URL is not configured");
    }

    const root = path.resolve(this.storageRoot);
    const destination = path.resolve(root, fileName);
    // Belt and braces on top of the strict name check above.
    if (path.dirname(destination) !== root) {
      throw new Error("Invalid club activity media path");
    }

    await mkdir(root, { recursive: true });
    // `wx`: fail instead of overwriting -- every upload is a new immutable
    // file, which is what makes long-lived nginx caching safe.
    await writeFile(destination, bytes, { flag: "wx" });
    return `${this.publicBaseUrl}/storage/${CLUB_ACTIVITY_MEDIA_PUBLIC_DIR}/${fileName}`;
  }
}
