import "server-only";

import { getSupabaseServer } from "@/lib/database";
import type { AvatarStorageRepository } from "./AvatarStorageRepository";

const BUCKET = "avatars";

// Current, active implementation — wraps the exact same
// supabase.storage.from("avatars") calls that lib/avatar-sync.ts and
// app/api/players/[id]/avatar/route.ts used to make directly.
export class SupabaseAvatarStorageRepository implements AvatarStorageRepository {
  async upload(
    filePath: string,
    bytes: Blob | ArrayBuffer,
    contentType: string
  ): Promise<{ error: string | null }> {
    const supabase = getSupabaseServer();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, bytes, { upsert: true, contentType });

    return { error: error?.message ?? null };
  }

  getPublicUrl(filePath: string): string {
    const supabase = getSupabaseServer();
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
    return data.publicUrl;
  }
}
