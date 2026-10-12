import "server-only";

import { randomUUID } from "crypto";
import {
  assertClubActivityImageDeclaration,
  normalizeClubActivityImage,
} from "@/lib/club-activity-image";
// Imported by subpath, deliberately NOT re-exported from the
// "@/lib/repositories" barrel: the barrel is pulled into middleware and
// instrumentation, and this fs-backed repository belongs only to this
// admin upload path.
import {
  clubActivityMediaStorageRepository,
  type ClubActivityMediaStorageRepository,
} from "@/lib/repositories/club-activity-media-storage";

export type UploadedClubActivityImage = {
  url: string;
  width: number;
  height: number;
  bytes: number;
};

// Admin-only (POST /api/admin/club-activity/media, behind middleware.ts).
// Validates the declared shape, then lets sharp prove the bytes really are a
// decodable JPEG/PNG/WebP, normalizes once, and stores the result under a
// fresh server-generated immutable name. The client-supplied file name is
// never used for anything.
export async function uploadClubActivityImage(
  file: Blob,
  storage: ClubActivityMediaStorageRepository = clubActivityMediaStorageRepository,
): Promise<UploadedClubActivityImage> {
  assertClubActivityImageDeclaration(file.type, file.size);
  const normalized = await normalizeClubActivityImage(Buffer.from(await file.arrayBuffer()));
  const fileName = `${Date.now()}-${randomUUID()}.webp`;
  const url = await storage.save(fileName, normalized.data);
  return {
    url,
    width: normalized.width,
    height: normalized.height,
    bytes: normalized.data.length,
  };
}
