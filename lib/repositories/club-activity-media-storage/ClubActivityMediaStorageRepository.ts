// Storage boundary for Club Activity (news/feed) publication images. Only
// ever receives bytes that were already normalized server-side
// (lib/club-activity-image.ts) under a server-generated file name -- no
// user-supplied name, path or extension ever reaches an implementation.
export interface ClubActivityMediaStorageRepository {
  /**
   * Writes a NEW immutable file and returns its public, same-origin URL
   * (`${NEXT_PUBLIC_APP_URL}/storage/club-activity/<fileName>`). Never
   * overwrites an existing file.
   */
  save(fileName: string, bytes: Buffer): Promise<string>;
}
