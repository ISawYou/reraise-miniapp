// Data-access boundary for `tournament_mystery_bounty` — the frozen
// Late-Registration-close snapshot for a `tournament_type: "mystery_bounty"`
// tournament. One row per tournament, created once by close-late-registration
// and only ever patched afterwards (activate, recalculate) — never a second
// row. Deciding *whether* a tournament is eligible, computing the pool/
// envelope math (lib/mystery-bounty.ts), and orchestrating the
// close/activate/recalculate flow all stay in features/mystery-bounty.ts,
// exactly as the sibling TournamentLiveStateRepository keeps live-mode
// business logic in features/tournaments.ts.
export type MysteryBountyStatusRow = "pending_envelopes" | "active";

export type MysteryBountyRow = {
  tournament_id: string;
  status: MysteryBountyStatusRow;
  players_count: number;
  total_entries_count: number;
  rebuys_count: number;
  addons_count: number;
  active_players_count: number;
  mystery_pool: number;
  envelope_count: number;
  small_count: number;
  small_value: number;
  medium_count: number;
  medium_value: number;
  jackpot_value: number;
  closed_at: string;
  activated_at: string | null;
  recalculated_at: string | null;
};

export type MysteryBountyInsert = Omit<
  MysteryBountyRow,
  "closed_at" | "activated_at" | "recalculated_at"
>;

export type MysteryBountyPatch = Partial<
  Pick<
    MysteryBountyRow,
    | "status"
    | "players_count"
    | "total_entries_count"
    | "rebuys_count"
    | "addons_count"
    | "active_players_count"
    | "mystery_pool"
    | "envelope_count"
    | "small_count"
    | "small_value"
    | "medium_count"
    | "medium_value"
    | "jackpot_value"
    | "activated_at"
    | "recalculated_at"
  >
>;

export interface TournamentMysteryBountyRepository {
  findByTournamentId(tournamentId: string): Promise<MysteryBountyRow | null>;
  insert(row: MysteryBountyInsert): Promise<MysteryBountyRow>;
  update(tournamentId: string, patch: MysteryBountyPatch): Promise<MysteryBountyRow>;
}
