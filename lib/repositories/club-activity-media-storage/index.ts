import { LocalClubActivityMediaStorageRepository } from "./LocalClubActivityMediaStorageRepository";

export type { ClubActivityMediaStorageRepository } from "./ClubActivityMediaStorageRepository";

export const clubActivityMediaStorageRepository =
  new LocalClubActivityMediaStorageRepository();
