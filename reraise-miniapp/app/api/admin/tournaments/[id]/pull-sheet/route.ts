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
      const sheetRows = dataRows
        .map((row: string[]) => ({
          player_id: row[0],
          display_name: row[2] ?? "Игрок",
          username: row[3]?.trim().replace(/^@/, "") || null,
          arrived: parseBooleanCell(row[5]),
          rebuys: parseNumberCell(row[6]),
          addons: parseNumberCell(row[7]),
          knockouts: parseNumberCell(row[8]),
          place: parseNullableNumberCell(row[9]),
        }))
        .filter(
          (row) =>
            typeof row.player_id === "string" && row.player_id.trim().length > 0
        );

      const sheetRowsMap = new Map(
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

    const updates = dataRows
      .map((row: string[], index: number) => ({
        player_id: row[0],
        arrived: parseBooleanCell(row[5]),
        rebuys: parseNumberCell(row[6]),
        addons: parseNumberCell(row[7]),
        knockouts: parseNumberCell(row[8]),
        place: parseNullableNumberCell(row[9]),
        sheet_row_number: index + 8,
      }))
      .filter(
        (row: { player_id: string }) =>
          typeof row.player_id === "string" && row.player_id.trim().length > 0
      );

    await applyTournamentLiveSheetRows(id, updates);
    const rows = await getTournamentLiveEntries(id);

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
