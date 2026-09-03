import type { TournamentType } from "@/types/domain";

export type TournamentVisualGeometry = {
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
};

export type TournamentVisualConfig = TournamentVisualGeometry & {
  tournamentType: TournamentType;
  assetUrl: string;
  // Optional per-surface override for the /tournaments list card, whose
  // artwork box has a different aspect ratio than Home's (see
  // artworkSizeClassName in TournamentVisual) -- the same scale/offset that
  // looks right in Home's tall box can crop badly in the list's shorter,
  // narrower one. Undefined means "inherit the main geometry above
  // unchanged", so existing configs (and any type an admin never touches)
  // keep rendering on /tournaments exactly as they do today.
  list?: TournamentVisualGeometry;
};

// Explicit product mapping. Filenames are storage details, never business
// logic -- adding/removing a tournament type here is the only place that
// decides what artwork exists, not any lookup by file name.
export const DEFAULT_TOURNAMENT_VISUALS = {
  classic: "/tournament-assets/classic.png",
  bounty: "/tournament-assets/bounty.png",
  boss_bounty: "/tournament-assets/boss-bounty.png",
  win_the_button: "/tournament-assets/win-the-button.png",
  deep_stack: "/tournament-assets/deep-stack.png",
  mystery_bounty: "/tournament-assets/mystery-bounty.png",
  phoenix: "/tournament-assets/phoenix.png",
} as const satisfies Record<TournamentType, string>;

export const TOURNAMENT_VISUAL_TYPES = Object.keys(
  DEFAULT_TOURNAMENT_VISUALS,
) as TournamentType[];

export function isTournamentVisualType(value: string): value is TournamentType {
  return (TOURNAMENT_VISUAL_TYPES as string[]).includes(value);
}

export function getDefaultTournamentVisual(
  tournamentType: TournamentType,
): TournamentVisualConfig {
  return {
    tournamentType,
    assetUrl: DEFAULT_TOURNAMENT_VISUALS[tournamentType],
    scale: 100,
    offsetX: 0,
    offsetY: 0,
    opacity: 100,
  };
}
