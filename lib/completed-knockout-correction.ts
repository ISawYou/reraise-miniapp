// Shared DTO only; persisted snapshots and correction planning stay server-only.
export type CompletedKnockoutSnapshot = {
  player_id: string;
  knockouts: number;
  boss_knockouts: number;
  rating_points: number;
  place: number;
  revision: string;
  points_per_ko: number;
  points_per_boss_ko: number;
  has_boss_ko: boolean;
};

export type CompletedKnockoutCommand = {
  player_id: string;
  knockouts: number;
  boss_knockouts: number;
  revision: string;
};

export type CompletedKnockoutResponse = {
  result: CompletedKnockoutSnapshot;
  warnings: string[];
};

export const POSTGRES_INTEGER_MAX = 2_147_483_647;
export function isKnockoutCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= POSTGRES_INTEGER_MAX;
}
