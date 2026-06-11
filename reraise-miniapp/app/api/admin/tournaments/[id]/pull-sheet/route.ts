import { NextResponse } from "next/server";
import {
  applyTournamentLiveSheetRows,
  getTournamentById,
  getTournamentLiveEntries,
  getTournamentResultsDraft,
} from "@/features/tournaments";
import { readSpreadsheetTabValues } from "@/lib/google-sheets";

function parseBooleanCell(value: string | undefined) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return ["true", "1", "yes", "да", "y"].includes(normalized);
}

function parseNumberCell(value: string | undefined) {
  if (!value?.trim()) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNullableNumberCell(value: string | undefined) {
  if (!value?.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const tournament = await getTournamentById(id);

    if (!tournament.google_sheet_tab_name?.trim()) {
      throw new Error("Для турнира еще не создана Google-таблица");
    }

    const values = await readSpreadsheetTabValues(tournament.google_sheet_tab_name);
    const dataRows = values.slice(7);

    const entryPrice = parseNumberCell(values[1]?.[4]);
    const addonPrice = parseNumberCell(values[1]?.[5]);
    const bountyPrice = parseNumberCell(values[1]?.[6]);

    if (tournament.kind === "free") {
      type FreeSheetRow = {
        player_id: string;
        display_name: string;
        username: string | null;
        arrived: boolean;
        paid: boolean;
        rebuys: number;
        addons: number;
        knockouts: number;
        place: number | null;
      };

      const sheetRows: FreeSheetRow[] = dataRows
        .map((row: string[]) => ({
          player_id: row[0] as string,
          display_name: (row[2] ?? "Игрок") as string,
          username: (row[3]?.trim().replace(/^@/, "") || null) as string | null,
          arrived: parseBooleanCell(row[5]),
          paid: parseBooleanCell(row[6]),
          rebuys: parseNumberCell(row[7]),
          addons: parseNumberCell(row[8]),
          knockouts: parseNumberCell(row[9]),
          place: parseNullableNumberCell(row[10]),
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
          rebuys: sheetRow?.rebuys ?? 0,
          addons: sheetRow?.addons ?? 0,
          knockouts: sheetRow?.knockouts ?? 0,
          place: sheetRow?.place ?? null,
        };
      });

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
      rebuys: number;
      addons: number;
      knockouts: number;
      place: number | null;
      sheet_row_number: number;
    };

    const rawUpdates: LiveSheetUpdate[] = dataRows.map((row: string[], index: number) => ({
      player_id: row[0] as string,
      arrived: parseBooleanCell(row[5]),
      paid: parseBooleanCell(row[6]),
      rebuys: parseNumberCell(row[7]),
      addons: parseNumberCell(row[8]),
      knockouts: parseNumberCell(row[9]),
      place: parseNullableNumberCell(row[10]),
      sheet_row_number: index + 8,
    }));

    const updates = rawUpdates.filter(
      (row) => typeof row.player_id === "string" && row.player_id.trim().length > 0
    );

    const paidMap = new Map<string, boolean>(updates.map((r) => [r.player_id, r.paid]));

    await applyTournamentLiveSheetRows(id, updates);
    const dbRows = await getTournamentLiveEntries(id);
    const rows = dbRows.map((row) => ({
      ...row,
      paid: paidMap.get(row.player_id) ?? false,
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
