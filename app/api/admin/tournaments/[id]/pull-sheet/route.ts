import { NextResponse } from "next/server";
import {
  applyTournamentLiveSheetRows,
  getTournamentById,
  getTournamentLiveEntries,
  getTournamentResultsDraft,
  setTournamentPlayerAttendance,
  setTournamentPlayerRebuyState,
} from "@/features/tournaments";
import { readSpreadsheetTabValues } from "@/lib/google-sheets";

function parseBooleanCell(value: string | undefined) {
  if (!value) return false;

  const normalized = value.trim().toLowerCase();
  return ["true", "1", "yes", "да", "y"].includes(normalized);
}

function parseNumberCell(value: string | undefined) {
  if (!value?.trim()) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNullableNumberCell(value: string | undefined) {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// `commit` (opt-in, default false): when true, additionally persists the
// pulled values into live Postgres state for kind='free' tournaments --
// arrived into tournament_attendance (via the same setTournamentPlayerAttendance
// the "Пришёл" checkbox uses) and rebuys/addons into tournament_rebuy_state.
// Only app/admin/results/[id]/page.tsx's explicit "Обновить из GS" button
// sends commit:true; the automatic read-only preview fetch on page load
// omits it entirely, so opening the results page can never silently
// overwrite live state with a stale sheet snapshot -- only an admin's
// deliberate click can (see docs/POKER_CLOCK_REBUY_ADDON_INVESTIGATION.md
// §6 for why this distinction matters: pressing the button is the one
// point where "trust the sheet now" is an actual, explicit product
// decision, not an implicit side effect of loading a page). eliminated is
// deliberately left untouched here -- the Google Sheet's "Выбыл" column is
// still write-only (never parsed on pull, see the investigation doc's §6
// finding), and this task's instructions were explicit not to change that
// without separately confirming it's needed.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as { commit?: boolean } | null;
    const commit = body?.commit === true;
    const tournament = await getTournamentById(id);

    if (!tournament.google_sheet_tab_name?.trim()) {
      throw new Error("Для турнира еще не создана Google-таблица");
    }

    const values = await readSpreadsheetTabValues(tournament.google_sheet_tab_name);
    const dataRows = values.slice(7);

    const entryPrice = parseNumberCell(values[1]?.[4]);
    const addonPrice = parseNumberCell(values[1]?.[5]);
    const bountyPrice = parseNumberCell(values[1]?.[6]);
    const isBossBounty = tournament.tournament_type === "boss_bounty";
    // Mystery Bounty's aggregate pool/envelope metrics are write-only in the
    // sheet (see export-sheet's buildFreeSheetValues) — only the per-player
    // Bounty Points column round-trips back, exactly like knockouts/rebuys.
    const isMysteryBounty = tournament.tournament_type === "mystery_bounty";
    const hasExtraFreeColumn = isBossBounty || isMysteryBounty;

    if (tournament.kind === "free") {
      type FreeSheetRow = {
        player_id: string;
        display_name: string;
        username: string | null;
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
      };

      const knockoutsIndex = 11;
      const bossKnockoutsIndex = isBossBounty ? 12 : null;
      const mysteryBountyPointsIndex = isMysteryBounty ? 12 : null;
      const placeIndex = hasExtraFreeColumn ? 13 : 12;

      const sheetRows: FreeSheetRow[] = dataRows
        .map((row: string[]) => ({
          player_id: row[0] as string,
          display_name: (row[2] ?? "Игрок") as string,
          username: (row[3]?.trim().replace(/^@/, "") || null) as string | null,
          arrived: parseBooleanCell(row[5]),
          paid: parseBooleanCell(row[6]),
          payment_type: (row[7] ?? "").trim(),
          free_reentries: parseNumberCell(row[8]),
          rebuys: parseNumberCell(row[9]),
          addons: parseNumberCell(row[10]),
          knockouts: parseNumberCell(row[knockoutsIndex]),
          boss_knockouts:
            bossKnockoutsIndex == null ? 0 : parseNumberCell(row[bossKnockoutsIndex]),
          mystery_bounty_points:
            mysteryBountyPointsIndex == null ? 0 : parseNumberCell(row[mysteryBountyPointsIndex]),
          place: parseNullableNumberCell(row[placeIndex]),
        }))
        .filter(
          (row: FreeSheetRow) =>
            typeof row.player_id === "string" && row.player_id.trim().length > 0
        );

      const sheetRowsMap = new Map<string, FreeSheetRow>(
        sheetRows.map((row) => [row.player_id, row])
      );
      const draftRows = await getTournamentResultsDraft(id);
      const rows = draftRows.map((row) => {
        const sheetRow = sheetRowsMap.get(row.player_id);

        return {
          player_id: row.player_id,
          display_name: row.display_name,
          username: row.username,
          arrived: sheetRow?.arrived ?? false,
          paid: sheetRow?.paid ?? false,
          payment_type: sheetRow?.payment_type ?? "",
          free_reentries: sheetRow?.free_reentries ?? 0,
          rebuys: sheetRow?.rebuys ?? 0,
          addons: sheetRow?.addons ?? 0,
          knockouts: sheetRow?.knockouts ?? 0,
          boss_knockouts: sheetRow?.boss_knockouts ?? 0,
          mystery_bounty_points: sheetRow?.mystery_bounty_points ?? 0,
          place: sheetRow?.place ?? null,
        };
      });

      if (commit) {
        await Promise.all(
          rows.map((row) =>
            Promise.all([
              setTournamentPlayerAttendance(id, row.player_id, row.arrived),
              setTournamentPlayerRebuyState(id, row.player_id, row.rebuys, row.addons),
            ])
          )
        );
      }

      return NextResponse.json({
        ok: true,
        rows,
        entryPrice,
        addonPrice,
        bountyPrice,
      });
    }

    type LiveSheetUpdate = {
      player_id: string;
      arrived: boolean;
      paid: boolean;
      payment_type: string;
      free_reentries: number;
      rebuys: number;
      addons: number;
      knockouts: number;
      boss_knockouts: number;
      place: number | null;
      sheet_row_number: number;
    };

    const knockoutsIndex = 10;
    const bossKnockoutsIndex = isBossBounty ? 11 : null;
    const placeIndex = isBossBounty ? 12 : 11;

    const rawUpdates: LiveSheetUpdate[] = dataRows.map((row: string[], index: number) => ({
      player_id: row[0] as string,
      arrived: parseBooleanCell(row[4]),
      paid: parseBooleanCell(row[5]),
      payment_type: (row[6] ?? "").trim(),
      free_reentries: parseNumberCell(row[7]),
      rebuys: parseNumberCell(row[8]),
      addons: parseNumberCell(row[9]),
      knockouts: parseNumberCell(row[knockoutsIndex]),
      boss_knockouts:
        bossKnockoutsIndex == null ? 0 : parseNumberCell(row[bossKnockoutsIndex]),
      place: parseNullableNumberCell(row[placeIndex]),
      sheet_row_number: index + 8,
    }));

    const updates = rawUpdates.filter(
      (row) => typeof row.player_id === "string" && row.player_id.trim().length > 0
    );

    const paidMap = new Map<string, boolean>(updates.map((r) => [r.player_id, r.paid]));
    const paymentTypeMap = new Map<string, string>(
      updates.map((r) => [r.player_id, r.payment_type])
    );
    const freeReentriesMap = new Map<string, number>(
      updates.map((r) => [r.player_id, r.free_reentries])
    );

    await applyTournamentLiveSheetRows(id, updates);
    const dbRows = await getTournamentLiveEntries(id);
    const rows = dbRows.map((row) => ({
      ...row,
      paid: paidMap.get(row.player_id) ?? false,
      payment_type: paymentTypeMap.get(row.player_id) ?? "",
      free_reentries: freeReentriesMap.get(row.player_id) ?? 0,
    }));

    return NextResponse.json({
      ok: true,
      rows,
      entryPrice,
      addonPrice,
      bountyPrice,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to pull tournament data from sheet",
      },
      { status: 500 }
    );
  }
}
