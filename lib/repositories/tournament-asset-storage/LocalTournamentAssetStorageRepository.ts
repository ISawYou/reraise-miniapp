import "server-only";

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { TournamentAssetStorageRepository } from "./TournamentAssetStorageRepository";

const STORAGE_ROOT = path.join(process.cwd(), "public", "storage", "tournament-assets");
const PUBLIC_BASE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

export class LocalTournamentAssetStorageRepository
  implements TournamentAssetStorageRepository
{
  async upload(fileName: string, bytes: ArrayBuffer): Promise<string> {
    await mkdir(STORAGE_ROOT, { recursive: true });
    await writeFile(path.join(STORAGE_ROOT, fileName), Buffer.from(bytes));
    return `${PUBLIC_BASE_URL}/storage/tournament-assets/${fileName}`;
  }
}
