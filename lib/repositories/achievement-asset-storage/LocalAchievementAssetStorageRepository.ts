import "server-only";

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { AchievementAssetStorageRepository } from "./AchievementAssetStorageRepository";

const STORAGE_ROOT = path.join(process.cwd(), "public", "storage", "achievement-assets");
const PUBLIC_BASE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

export class LocalAchievementAssetStorageRepository
  implements AchievementAssetStorageRepository
{
  async upload(fileName: string, bytes: ArrayBuffer): Promise<string> {
    await mkdir(STORAGE_ROOT, { recursive: true });
    await writeFile(path.join(STORAGE_ROOT, fileName), Buffer.from(bytes));
    return `${PUBLIC_BASE_URL}/storage/achievement-assets/${fileName}`;
  }
}
