export interface TournamentAssetStorageRepository {
  // Buffer (the shape features/tournament-visuals.ts's Sharp-generated card
  // derivative comes back as) accepted alongside the original's raw
  // ArrayBuffer -- Buffer.from() in the implementation handles both
  // identically, so this widening needs no implementation change.
  upload(fileName: string, bytes: ArrayBuffer | Buffer): Promise<string>;
}
