import type { TournamentType } from "@/types/domain";

export type TournamentVisualConfig = {
  tournamentType: TournamentType;
  assetUrl: string;
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
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
