import type { Player } from "@/types/domain";
import type { PlayerRow } from "@/types/database";

// Insert/patch payload shapes mirror exactly what the app already sends to
// Supabase today — permissive by design (Partial<PlayerRow>), not a new,
// stricter contract. Wrapping the existing calls behind this interface
// changes nothing about what's allowed to be written; validation stays in
// the feature-layer functions (features/auth.ts, features/admin.ts, ...).
export type PlayerInsert = Partial<PlayerRow>;
export type PlayerPatch = Partial<PlayerRow>;

// Mirrors app/api/admin/activity/route.ts's exact 5-column select for its
// player-details lookup — not the full Player shape.
export type PlayerActivitySummary = {
  id: string;
  display_name: string;
  username: string | null;
  email: string | null;
  role: string;
};

// Mirrors isDisplayNameTaken's exact select — only the columns needed to
// compare display names against every other player.
export type DisplayNameCandidate = {
  id: string;
  display_name: string;
  pending_display_name: string | null;
};

// Mirrors getTournamentAccessRecipientsByKind's exact select.
export type AccessRecipient = {
  id: string;
  telegram_id: number | null;
  display_name: string;
};

// Mirrors updatePlayerReferralData's exact partial select.
export type ReferralFields = {
  referral_count: number;
  free_reentries_balance: number;
  yandex_review_bonus_claimed: boolean;
};

// Data-access boundary for everything the app currently reads/writes on
// `players`. Deliberately a thin CRUD surface, not a business-logic layer:
// no role/permission checks, no Telegram initData/HMAC verification, no
// nickname-moderation decisions, no cascading deletes across other
// tables, no stats/leaderboard/achievement computation — all of that stays
// exactly where it is today (features/auth.ts, features/auth-server.ts,
// features/admin.ts, features/tournaments.ts, middleware.ts).
//
// `create`/`update` deliberately throw a bare `Error(message)` (the raw
// Supabase error text, no custom prefix) rather than embedding any one
// call site's wording — today's ~14 call sites each throw a *different*
// custom message for the same underlying update/insert, so the prefix
// stays at the call site, not in the repository, exactly the way
// Poker Clock's route handlers add their own message around
// `RepositoryError` instead of the repository doing it for them.
export interface PlayerRepository {
  findById(playerId: string): Promise<Player | null>;
  // Same lookup as findById, but throws instead of returning null when no
  // row is found — mirrors approveNickname's specific `.single()` fetch
  // (not `.maybeSingle()`), used only there today.
  findByIdOrThrow(playerId: string): Promise<Player>;
  findByTelegramId(telegramId: number): Promise<Player | null>;
  findByEmail(email: string): Promise<Player | null>;

  // Narrow lookups — today's call sites never check the error on these
  // (both just read `data` and treat a failure the same as "not found"),
  // so these deliberately don't throw either.
  findRoleById(playerId: string): Promise<{ id: string; role: string } | null>;
  findSummariesByIds(playerIds: string[]): Promise<PlayerActivitySummary[]>;

  listOrderedByCreatedAtDesc(): Promise<Player[]>;
  listOrderedByDisplayName(): Promise<Player[]>;
  listPendingNicknames(): Promise<Player[]>;
  listDisplayNameCandidates(excludePlayerId: string): Promise<DisplayNameCandidate[]>;
  listByAccessColumn(
    column: "can_access_free" | "can_access_paid" | "can_access_cash"
  ): Promise<AccessRecipient[]>;

  // Returns null both on a genuine "not found" and on a Supabase error —
  // mirrors updatePlayerReferralData's `if (fetchError || !current)` check,
  // which throws its own fixed "Игрок не найден" regardless of the actual
  // error text.
  findReferralFieldsById(playerId: string): Promise<ReferralFields | null>;

  create(data: PlayerInsert): Promise<Player>;
  update(playerId: string, patch: PlayerPatch): Promise<Player>;
  delete(playerId: string): Promise<void>;
}
