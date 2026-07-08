import { SupabaseAvatarStorageRepository } from "./SupabaseAvatarStorageRepository";
import type { AvatarStorageRepository } from "./AvatarStorageRepository";

export type { AvatarStorageRepository } from "./AvatarStorageRepository";

export const avatarStorageRepository: AvatarStorageRepository =
  new SupabaseAvatarStorageRepository();
