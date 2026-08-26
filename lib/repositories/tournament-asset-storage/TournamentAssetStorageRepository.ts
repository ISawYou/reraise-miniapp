export interface TournamentAssetStorageRepository {
  upload(fileName: string, bytes: ArrayBuffer): Promise<string>;
}
