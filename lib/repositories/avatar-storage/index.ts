import { LocalAvatarStorageRepository } from "./LocalAvatarStorageRepository";
import type { AvatarStorageRepository } from "./AvatarStorageRepository";

export type { AvatarStorageRepository } from "./AvatarStorageRepository";
export { SupabaseAvatarStorageRepository } from "./SupabaseAvatarStorageRepository";
export { contentTypeToExtension } from "./contentTypeToExtension";

// Local filesystem + nginx (re-raise.ru's VPS) is the active implementation
// -- see docs/POSTGRES_MIGRATION_AUDIT.md's Storage follow-up. Storage was
// never tied to DATABASE_PROVIDER (it's a separate axis), so this is a
// plain instantiation, not an env-var switch: SupabaseAvatarStorageRepository
// stays exported above for older environments/rollback, wired back in here
// with a one-line change if ever needed.
export const avatarStorageRepository: AvatarStorageRepository =
  new LocalAvatarStorageRepository();
