import { NextResponse } from "next/server";
import {
  applyTournamentLiveSheetRows,
  getTournamentById,
  getTournamentLiveEntries,
  getTournamentResultsDraft,
  setTournamentPlayerAttendance,
  setTournamentPlayerElimination,
  setTournamentPlayerRebuyState,
} from "@/features/tournaments";
import { readSpreadsheetTabValues } from "@/lib/google-sheets";
import {
  parseBooleanCell,
  parseNullableNumberCell,
  parseNumberCell,
  parseFreeSheetValues,
} from "@/lib/tournament-sheet-parsing";

// `commit` (opt-in, default false): when true, additionally persists the
// pulled values into live Postgres state for kind='free' tournaments --
// arrived into tournament_attendance, eliminated into
// tournament_player_eliminations, and rebuys/addons into
// tournament_rebuy_state -- all via the exact same authoritative setters
// the background live synchronizer uses (features/tournament-sheet-sync.ts),
// so this manual fallback and the automatic sync can never drift in
// behavior. Only app/admin/results/[id]/page.tsx's explicit "Обновить из
// GS" button sends commit:true; the automatic read-only preview fetch on
// page load omits it entirely, so opening the results page can never
// silently overwrite live state with a stale sheet snapshot -- only an
// admin's deliberate click can (see
// docs/POKER_CLOCK_REBUY_ADDON_INVESTIGATION.md §6).
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

    if (tournament.kind === "free") {
      const parsed = parseFreeSheetValues(values, tournament.tournament_type);

      if (!parsed.ok) {
        throw new Error(
          `Структура Google-таблицы не соответствует ожидаемой: ${parsed.reason}`
        );
      }

      const entryPrice = parseNumberCell(values[1]?.[4]);
      const addonPrice = parseNumberCell(values[1]?.[5]);
      const bountyPrice = parseNumberCell(values[1]?.[6]);

      const draftRows = await getTournamentResultsDraft(id);
      const rows = draftRows.map((row) => {
        const sheetRow = parsed.rows.get(row.player_id);

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
          eliminated: sheetRow?.eliminated ?? false,
        };
      });

      if (commit) {
        await Promise.all(
          rows.map((row) =>
            Promise.all([
              setTournamentPlayerAttendance(id, row.player_id, row.arrived),
              setTournamentPlayerElimination(id, row.player_id, row.eliminated),
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

    const entryPrice = parseNumberCell(values[1]?.[4]);
    const addonPrice = parseNumberCell(values[1]?.[5]);
    const bountyPrice = parseNumberCell(values[1]?.[6]);
    const isBossBounty = tournament.tournament_type === "boss_bounty";
    const dataRows = values.slice(7);

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
