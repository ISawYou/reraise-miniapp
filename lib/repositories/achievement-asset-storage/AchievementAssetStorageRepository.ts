export interface AchievementAssetStorageRepository {
  upload(fileName: string, bytes: ArrayBuffer): Promise<string>;
}
