// Team emblem v1 -- a small, fixed, shared allowlist of selectable
// symbols/emoji. No image upload/storage in v1 (see the Teams v1 product
// spec's "TEAM IDENTITY UI" section) -- a team's emblem is always exactly
// one of these strings. This is the ONE canonical list: both server-side
// validation (features/teams.ts) and every emblem picker in the UI read
// from here, so they can never drift apart.
export const TEAM_EMBLEMS = [
  "♠️",
  "♥️",
  "♦️",
  "♣️",
  "👑",
  "🔥",
  "⚡",
  "🐺",
  "🦈",
  "🐉",
  "💎",
  "🏆",
] as const;

export type TeamEmblem = (typeof TEAM_EMBLEMS)[number];

// Sensible default for the create-team form -- a spade, matching the
// club's existing poker-suit visual language elsewhere in the app.
export const DEFAULT_TEAM_EMBLEM: TeamEmblem = "♠️";

export function isTeamEmblem(value: string): value is TeamEmblem {
  return (TEAM_EMBLEMS as readonly string[]).includes(value);
}
