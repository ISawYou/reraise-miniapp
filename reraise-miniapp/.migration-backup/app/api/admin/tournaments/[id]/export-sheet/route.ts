import { NextResponse } from "next/server";
import {
  getTournamentSheetExportData,
  setTournamentGoogleSheetTabName,
} from "@/features/tournaments";
import {
  applyTournamentSheetFormatting,
  buildSpreadsheetTabUrl,
  ensureSpreadsheetTab,
  ensureReadmeTab,
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

function buildReadmeSheetValues() {
  return [
    ["README — Google Sheets для турнирного администратора"],
    [],
    ["Что делает этот файл"],
    [
      "В этой таблице администратор на площадке отмечает, кто реально сыграл, считает повторные входы, нокауты и итоговые места.",
    ],
    [],
    ["Какие листы в таблице"],
    ["README — инструкция"],
    ["Листы турниров — рабочие таблицы по каждому турниру"],
    [],
    ["Какие колонки можно редактировать"],
    ["Пришел"],
    ["Re-entry"],
    ["Нокауты"],
    ["Место"],
    ["Комментарий"],
    [],
    ["Какие колонки нельзя менять"],
    ["Player ID"],
    ["Ник"],
    ["Telegram"],
    ["Статус регистрации"],
    [],
    ["Правила заполнения"],
    ["Пришел: ставьте TRUE или Да только если игрок реально сделал хотя бы один вход в турнир."],
    ["Если игрок зарегистрирован, но не приехал или не сыграл ни одного входа, Пришел не заполняйте."],
    ["Если игрок был в waitlist, но по факту сел в турнир и сыграл, тоже ставьте Пришел = TRUE / Да."],
    ["Re-entry: количество повторных входов. Если повторных входов не было, ставьте 0."],
    ["Нокауты: количество выбитых игроков. Если нокаутов не было, ставьте 0."],
    ["Место: итоговое место игрока, когда турнир завершен или место уже известно."],
    [],
    ["Важно"],
    ["Не удаляйте строки и не меняйте Player ID"],
    ["Повторная выгрузка того же турнира обновляет тот же лист, а не создает новый."],
    ["README также переиспользуется и обновляется, а не создается заново."],
  ];
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

    await ensureReadmeTab();
    await replaceSpreadsheetTabValues("README", buildReadmeSheetValues());

    const sheet = await ensureSpreadsheetTab(tabName);
    await replaceSpreadsheetTabValues(tabName, buildSheetValues(exportData));
    await applyTournamentSheetFormatting(tabName);
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
