import { NextResponse } from "next/server";
import {
  getTournamentSheetExportData,
  setTournamentGoogleSheetTabName,
} from "@/features/tournaments";
import {
  buildSpreadsheetTabUrl,
  ensureSpreadsheetTab,
  replaceSpreadsheetTabValues,
} from "@/lib/google-sheets";

function buildTabName(title: string, startAt: string, tournamentId: string) {
  const date = new Date(startAt);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const shortTitle = title
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);

  return `${day}.${month} | ${shortTitle} | ${tournamentId.slice(0, 4)}`;
}

function buildSheetValues(
  exportData: Awaited<ReturnType<typeof getTournamentSheetExportData>>
) {
  return [
    ["Tournament ID", exportData.tournament.id],
    ["Название", exportData.tournament.title],
    ["Дата", exportData.tournament.start_at],
    ["Локация", exportData.tournament.location ?? ""],
    ["Статус", exportData.tournament.status],
    [],
    [
      "Player ID",
      "Ник",
      "Telegram",
      "Статус регистрации",
      "Пришел",
      "Re-entry",
      "Нокауты",
      "Место",
      "Комментарий",
    ],
    ...exportData.rows.map((row) => [
      row.player_id,
      row.display_name,
      row.username ? `@${row.username}` : "",
      row.registration_status,
      "",
      0,
      0,
      "",
      "",
    ]),
  ];
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const exportData = await getTournamentSheetExportData(id);
    const tabName =
      exportData.tournament.google_sheet_tab_name?.trim() ||
      buildTabName(
        exportData.tournament.title,
        exportData.tournament.start_at,
        exportData.tournament.id
      );

    const sheet = await ensureSpreadsheetTab(tabName);
    await replaceSpreadsheetTabValues(tabName, buildSheetValues(exportData));
    await setTournamentGoogleSheetTabName(id, tabName);

    return NextResponse.json({
      ok: true,
      tabName,
      url: buildSpreadsheetTabUrl(sheet.sheetId),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to export tournament sheet",
      },
      { status: 500 }
    );
  }
}
