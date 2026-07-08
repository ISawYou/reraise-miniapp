// Data-access boundary for the Supabase Storage "avatars" bucket — not a
// database table. Mirrors TournamentRepository's role from Poker Clock's
// StorageRepository, just backed by Supabase Storage instead of the local
// filesystem (Storage stays on Supabase this phase; nothing about
// PostgreSQL/Drizzle changes that).
//
// Deciding *whether* to sync a Telegram avatar, or which URL shape means
// "already synced" vs "user-uploaded", stays in lib/avatar-sync.ts and the
// avatar upload route — this interface only uploads bytes and resolves URLs.
export interface AvatarStorageRepository {
  upload(
    filePath: string,
    bytes: Blob | ArrayBuffer,
    contentType: string
  ): Promise<{ error: string | null }>;
  getPublicUrl(filePath: string): string;
}
