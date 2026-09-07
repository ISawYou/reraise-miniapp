import type { TournamentType } from "@/types/domain";

export type TournamentVisualGeometry = {
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
};

export type TournamentVisualConfig = TournamentVisualGeometry & {
  tournamentType: TournamentType;
  // Canonical original/source PNG -- always present, always the admin
  // editor's upload target and this config's fallback of last resort.
  assetUrl: string;
  // Optional 512x512 "card" derivative of the SAME artwork as assetUrl --
  // not a separate visual identity. Absent on every config written before
  // this field existed (all seven legacy production assets) and on any
  // config an admin has not re-saved through the derivative-generating
  // upload path yet; TournamentVisual falls back to assetUrl whenever this
  // is missing or fails to load. See features/tournament-visuals.ts's
  // uploadTournamentVisualPng (generates it) and getTournamentVisualConfigs
  // (backfills it onto an unmodified built-in default only).
  cardAssetUrl?: string;
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
  crazy_pineapple: "/tournament-assets/pineapple.png",
} as const satisfies Record<TournamentType, string>;

export const TOURNAMENT_VISUAL_TYPES = Object.keys(
  DEFAULT_TOURNAMENT_VISUALS,
) as TournamentType[];

export function isTournamentVisualType(value: string): value is TournamentType {
  return (TOURNAMENT_VISUAL_TYPES as string[]).includes(value);
}

// Deliberately a PARTIAL map, unlike DEFAULT_TOURNAMENT_VISUALS above --
// only types whose 512px built-in derivative actually exists in the repo
// belong here. Crazy Pineapple is the only one generated so far (Phase
// 2B.2); the seven legacy originals are not backfilled by this change (see
// getTournamentVisualConfigs's stored-default inheritance for why an old
// config is still safe without an entry here) and must never get a guessed
// "-card" entry pointing at a file that doesn't exist.
export const DEFAULT_TOURNAMENT_CARD_VISUALS: Partial<Record<TournamentType, string>> = {
  crazy_pineapple: "/tournament-assets/pineapple-card.png",
};

export function getDefaultTournamentVisual(
  tournamentType: TournamentType,
): TournamentVisualConfig {
  const cardAssetUrl = DEFAULT_TOURNAMENT_CARD_VISUALS[tournamentType];
  return {
    tournamentType,
    assetUrl: DEFAULT_TOURNAMENT_VISUALS[tournamentType],
    ...(cardAssetUrl ? { cardAssetUrl } : {}),
    scale: 100,
    offsetX: 0,
    offsetY: 0,
    opacity: 100,
  };
}
