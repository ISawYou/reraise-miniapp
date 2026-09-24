// Public Club Activity policy for achievement events. Some achievements
// stay real (granted, shown on the profile) but must never be announced in
// the public feed -- e.g. Bubble Boy (marco_reus) fires far too often to be
// "news". This single list drives both sides of the boundary:
// - features/club-activity.ts never CREATES a public event for these codes;
// - the PostgreSQL public reads (feed, detail) never RETURN one, in SQL,
//   so historical rows created before this rule stay hidden without being
//   deleted/archived and without breaking feed pagination.
// Admin reads are intentionally unaffected.
export const PUBLIC_ACTIVITY_HIDDEN_ACHIEVEMENT_CODES: readonly string[] = ["marco_reus"];

export function isAchievementPublishableToPublicActivity(achievementCode: string): boolean {
  return !PUBLIC_ACTIVITY_HIDDEN_ACHIEVEMENT_CODES.includes(achievementCode);
}
