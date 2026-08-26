import { LocalTournamentAssetStorageRepository } from "./LocalTournamentAssetStorageRepository";

export type { TournamentAssetStorageRepository } from "./TournamentAssetStorageRepository";

export const tournamentAssetStorageRepository =
  new LocalTournamentAssetStorageRepository();
