import type { TournamentType } from "@/types/domain";

// Single shared parser for the `kind === "free"` Google Sheets tab layout
// (buildFreeSheetValues in app/api/admin/tournaments/[id]/export-sheet/route.ts
// is the writer this mirrors). Every consumer that needs to read a free
// tournament's sheet -- the manual "Обновить из GS" pull, the background
// live synchronizer, and the completion-time fresh read -- goes through
// this one module so the column layout is defined exactly once.

// Exported (not just used internally by parseFreeSheetValues below) --
// pull-sheet's kind!=='free' (paid/cash live) branch uses these same
// generic cell parsers and is otherwise untouched by this module.
export function parseBooleanCell(value: string | undefined) {
  if (!value) return false;

  const normalized = value.trim().toLowerCase();
  return ["true", "1", "yes", "да", "y"].includes(normalized);
}

export function parseNumberCell(value: string | undefined) {
  if (!value?.trim()) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseNullableNumberCell(value: string | undefined) {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type FreeSheetColumnLayout = {
  headers: string[];
  knockoutsIndex: number;
  bossKnockoutsIndex: number | null;
  mysteryBountyPointsIndex: number | null;
  placeIndex: number;
  ratingIndex: number;
  eliminatedIndex: number;
  eliminatedAtIndex: number;
};

// Column positions mirror pull-sheet's original inline math exactly
// (knockoutsIndex=11, placeIndex=hasExtraFreeColumn?13:12) plus the two
// trailing columns export-sheet already writes (Рейтинг, Выбыл, Время
// выбытия) that pull-sheet never used to read.
export function getFreeSheetColumnLayout(tournamentType: TournamentType): FreeSheetColumnLayout {
  const isBossBounty = tournamentType === "boss_bounty";
  const isMysteryBounty = tournamentType === "mystery_bounty";
  const hasExtraColumn = isBossBounty || isMysteryBounty;

  const knockoutsIndex = 11;
  const bossKnockoutsIndex = isBossBounty ? 12 : null;
  const mysteryBountyPointsIndex = isMysteryBounty ? 12 : null;
  const placeIndex = hasExtraColumn ? 13 : 12;
  const ratingIndex = placeIndex + 1;
  const eliminatedIndex = placeIndex + 2;
  const eliminatedAtIndex = placeIndex + 3;

  const headers = [
    "Player ID",
    "System",
    "Ник",
    "Telegram",
    "Статус регистрации",
    "Пришел",
    "Оплатил",
    "Нал/карта",
    "Беспл. re-entry",
    "Re-buy",
    "Addon",
    "Nok",
    ...(isBossBounty ? ["Boss Nok"] : []),
    ...(isMysteryBounty ? ["Bounty Points"] : []),
    "Место",
    "Рейтинг",
    "Выбыл",
    "Время выбытия",
  ];

  return {
    headers,
    knockoutsIndex,
    bossKnockoutsIndex,
    mysteryBountyPointsIndex,
    placeIndex,
    ratingIndex,
    eliminatedIndex,
    eliminatedAtIndex,
  };
}

// Normalized shape of one player's row -- deliberately excludes
// `eliminated_at`: the sheet's "Время выбытия" column is write-only/display
// (see export-sheet's formatEliminationTimestamp), never parsed back.
// `eliminated_at` semantics stay entirely server-derived via
// setTournamentPlayerElimination.
export type NormalizedFreeSheetRow = {
  rowNumber: number;
  player_id: string;
  raw_system: string;
  raw_display_name: string;
  raw_telegram: string;
  raw_status: string;
  arrived: boolean;
  paid: boolean;
  payment_type: string;
  free_reentries: number;
  rebuys: number;
  addons: number;
  knockouts: number;
  boss_knockouts: number;
  mystery_bounty_points: number;
  place: number | null;
  eliminated: boolean;
};

export type ParseFreeSheetResult =
  | { ok: true; rows: Map<string, NormalizedFreeSheetRow>; dataRowCount: number }
  | { ok: false; reason: string };

// Header row lives at values[6] (rows 0-5 are the meta block, see
// buildFreeSheetValues); data rows start at values[7] = sheet row 8, same
// "+8" convention pull-sheet's live/paid branch already used for
// sheet_row_number. Validates the FULL expected header before trusting any
// column index -- a reordered/renamed column must never be silently
// misread as a different field.
export function parseFreeSheetValues(
  values: string[][],
  tournamentType: TournamentType
): ParseFreeSheetResult {
  const layout = getFreeSheetColumnLayout(tournamentType);
  const headerRow = values[6] ?? [];

  for (let i = 0; i < layout.headers.length; i++) {
    const actual = (headerRow[i] ?? "").toString().trim();
    if (actual !== layout.headers[i]) {
      return {
        ok: false,
        reason: `Unexpected sheet header at column ${i}: expected "${layout.headers[i]}", got "${actual}"`,
      };
    }
  }

  const dataRows = values.slice(7);
  const rows = new Map<string, NormalizedFreeSheetRow>();

  dataRows.forEach((row, index) => {
    const playerId = (row[0] ?? "").toString().trim();
    if (!playerId) return;

    // Duplicate player_id rows: last one wins (Map overwrite), same
    // precedent as pull-sheet's original sheetRowsMap.
    rows.set(playerId, {
      rowNumber: index + 8,
      player_id: playerId,
      raw_system: (row[1] ?? "").toString(),
      raw_display_name: (row[2] ?? "Игрок").toString(),
      raw_telegram: (row[3] ?? "").toString(),
      raw_status: (row[4] ?? "").toString(),
      arrived: parseBooleanCell(row[5]),
      paid: parseBooleanCell(row[6]),
      payment_type: (row[7] ?? "").toString().trim(),
      free_reentries: parseNumberCell(row[8]),
      rebuys: parseNumberCell(row[9]),
      addons: parseNumberCell(row[10]),
      knockouts: parseNumberCell(row[layout.knockoutsIndex]),
      boss_knockouts:
        layout.bossKnockoutsIndex == null ? 0 : parseNumberCell(row[layout.bossKnockoutsIndex]),
      mystery_bounty_points:
        layout.mysteryBountyPointsIndex == null
          ? 0
          : parseNumberCell(row[layout.mysteryBountyPointsIndex]),
      place: parseNullableNumberCell(row[layout.placeIndex]),
      eliminated: parseBooleanCell(row[layout.eliminatedIndex]),
    });
  });

  return { ok: true, rows, dataRowCount: dataRows.length };
}
