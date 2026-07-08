import "server-only";

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { AvatarStorageRepository } from "./AvatarStorageRepository";

// Served straight out of Next's `public/` directory, which the standalone
// server reads from disk per-request rather than bundling at build time --
// files written here after the container has started are served
// immediately, no rebuild/restart required. On the VPS this directory is a
// bind mount (docker-compose.yml) so uploads survive `docker compose
// build`/`down`, and nginx also serves /storage/ directly from the same
// host path (see /etc/nginx/sites-enabled/re-raise), bypassing Node
// entirely. Same pattern as poker-clock's LocalStorageRepository.
const STORAGE_ROOT = path.join(process.cwd(), "public", "storage", "avatars");

// Baked in at build time (see Dockerfile) and also available at runtime,
// same convention already used for other absolute URLs in this project.
const PUBLIC_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

// Current, active implementation for the re-raise.ru site. `filePath` is
// built by the callers (lib/avatar-sync.ts, the avatar upload route) and
// already includes an extension (see contentTypeToExtension.ts) --
// this class only knows how to write bytes under that path and turn it
// back into a public URL. `contentType` (part of the shared
// AvatarStorageRepository interface, needed by the Supabase implementation)
// isn't needed here -- the extension already embedded in `filePath` is what
// tells nginx how to serve it.
export class LocalAvatarStorageRepository implements AvatarStorageRepository {
  async upload(
    filePath: string,
    bytes: Blob | ArrayBuffer
  ): Promise<{ error: string | null }> {
    try {
      const buffer = Buffer.from(bytes instanceof Blob ? await bytes.arrayBuffer() : bytes);
      const destination = path.join(STORAGE_ROOT, filePath);

      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, buffer);

      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "upload failed" };
    }
  }

  getPublicUrl(filePath: string): string {
    return `${PUBLIC_BASE_URL}/storage/avatars/${filePath}`;
  }
}
