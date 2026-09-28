import { playerRepository, resultRepository } from "@/lib/repositories";

// CLUB DISCOUNTS — targeted historical backfill (2026-09-28). Closes the
// gap left by the freeze mechanism (features/tournaments.ts's
// resolveClubDiscountPercents): every result row written BEFORE a
// player's discount was ever configured froze club_discount_percent=0
// (an honest historical fact, not a guess). If the owner later confirms a
// player should have had a discount for some past window, this is the
// ONLY sanctioned way to correct those specific rows — never by touching
// players.club_discount_percent (the LIVE setting, completely
// independent) and never by re-running tournament completion (which
// would also touch place/rating/knockouts/etc.).
//
// Identity is ALWAYS player_id (uuid) — see docs/CLUB_DISCOUNTS.md.
// display_name is surfaced in the preview for the admin's own visual
// confirmation only, never used to select/match rows.

export type ClubDiscountBackfillInput = {
  playerId: string;
  discountPercent: number;
  // Inclusive on both ends. effectiveTo omitted/null means "open-ended,
  // through the most recent tournament".
  effectiveFrom: string;
  effectiveTo?: string | null;
};

export type ClubDiscountBackfillPreviewRow = {
  resultId: string;
  tournamentId: string;
  tournamentTitle: string;
  tournamentStartAt: string;
  currentDiscountPercent: number;
  proposedDiscountPercent: number;
  willChange: boolean;
};

export type ClubDiscountBackfillPreview = {
  playerId: string;
  // For information only — never used to select/match rows (see module doc comment).
  playerDisplayName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  rows: ClubDiscountBackfillPreviewRow[];
  // Finance-impact preview (base/discount/actual game revenue in RUB) is
  // NOT included here on purpose: RERAISE has no tournament pricing data
  // at all (see docs/CLUB_DISCOUNTS.md) — that lives entirely in the
  // separate Finance app's finance_tournament_pricing, which this app has
  // no access to. Only Finance itself could compute that; RERAISE's own
  // preview is necessarily limited to counts and the discount percent
  // itself, never a RUB figure it cannot know.
};

function validateDiscountPercent(discountPercent: number): void {
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new Error("Скидка клуба должна быть целым числом от 0 до 100");
  }
}

function parseWindow(effectiveFrom: string, effectiveTo?: string | null): { fromMs: number; toMs: number } {
  const fromMs = new Date(effectiveFrom).getTime();
  if (Number.isNaN(fromMs)) throw new Error("effectiveFrom — некорректная дата");

  let toMs = Number.POSITIVE_INFINITY;
  if (effectiveTo) {
    toMs = new Date(effectiveTo).getTime();
    if (Number.isNaN(toMs)) throw new Error("effectiveTo — некорректная дата");
  }
  if (toMs < fromMs) throw new Error("effectiveTo не может быть раньше effectiveFrom");

  return { fromMs, toMs };
}

// READ-ONLY. Never writes anything — see applyClubDiscountBackfill for
// the only path that does.
export async function previewClubDiscountBackfill(
  input: ClubDiscountBackfillInput,
): Promise<ClubDiscountBackfillPreview> {
  validateDiscountPercent(input.discountPercent);
  const { fromMs, toMs } = parseWindow(input.effectiveFrom, input.effectiveTo);

  const player = await playerRepository.findById(input.playerId);
  if (!player) throw new Error("Игрок не найден");

  const history = await resultRepository.findClubDiscountHistoryByPlayerId(input.playerId);

  const rows: ClubDiscountBackfillPreviewRow[] = history
    .filter((h) => {
      const t = h.tournamentStartAt.getTime();
      return t >= fromMs && t <= toMs;
    })
    .map((h) => ({
      resultId: h.resultId,
      tournamentId: h.tournamentId,
      tournamentTitle: h.tournamentTitle,
      tournamentStartAt: h.tournamentStartAt.toISOString(),
      currentDiscountPercent: h.clubDiscountPercent,
      proposedDiscountPercent: input.discountPercent,
      willChange: h.clubDiscountPercent !== input.discountPercent,
    }));

  return {
    playerId: input.playerId,
    playerDisplayName: player.admin_display_name?.trim() || player.display_name,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
    rows,
  };
}

export type ClubDiscountBackfillApplyInput = {
  playerId: string;
  discountPercent: number;
  // Explicit, previewed result ids ONLY — never re-derived from a date
  // window at apply time (the window could shift between preview and
  // apply if new tournaments completed in between; applying exactly what
  // was shown is the only way "preview first" means anything).
  resultIds: string[];
};

export type ClubDiscountBackfillApplyResult = {
  updatedCount: number;
};

// Applies ONLY the explicitly previewed rows. Re-verifies every resultId
// actually belongs to this player before writing anything — never trusts
// a caller-supplied id blindly. Touches ONLY
// results.club_discount_percent; every other column (place, reentries,
// addons, free_reentries, rating_points, arrived, ...) on those rows is
// untouched, and players.club_discount_percent (the live setting) is
// never written by this function. Idempotent: re-applying the exact same
// input again just sets the same value again — no second effect.
export async function applyClubDiscountBackfill(
  input: ClubDiscountBackfillApplyInput,
): Promise<ClubDiscountBackfillApplyResult> {
  validateDiscountPercent(input.discountPercent);
  if (input.resultIds.length === 0) return { updatedCount: 0 };

  const history = await resultRepository.findClubDiscountHistoryByPlayerId(input.playerId);
  const ownedResultIds = new Set(history.map((h) => h.resultId));
  const foreign = input.resultIds.filter((id) => !ownedResultIds.has(id));
  if (foreign.length > 0) {
    throw new Error(
      `Отказ: ${foreign.length} result id не принадлежат игроку ${input.playerId} — ничего не применено`,
    );
  }

  for (const resultId of input.resultIds) {
    await resultRepository.updateClubDiscountPercent(resultId, input.discountPercent);
  }

  return { updatedCount: input.resultIds.length };
}
