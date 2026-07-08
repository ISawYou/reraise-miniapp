import { NextResponse } from "next/server";
import {
  ensureTournamentLiveEntries,
  getTournamentById,
  getTournamentLiveSheetData,
  setTournamentGoogleSheetTabName,
  updateTournamentLiveEntries,
} from "@/features/tournaments";
import {
  appendReportRow,
  applyTournamentSheetFormatting,
  buildSpreadsheetTabUrl,
  ensureReadmeTab,
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

function formatTournamentDate(date: string) {
  return new Date(date).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTournamentStatusLabel(status: string) {
  return status === "completed" ? "Закрыт" : "Открыт";
}

function buildReadmeSheetValues() {
  return [
    ["README - live-данные турниров"],
    [],
    ["Эта таблица синхронизируется с Mini App."],
    ["Редактировать можно поля: Пришел, Оплатил, Нал/карта, Беспл. re-entry, Re-buy, Addon, Nok, Место."],
    ["Технические поля скрыты и нужны только для синхронизации."],
  ];
}

function buildLiveSheetValues(
  exportData: Awaited<ReturnType<typeof getTournamentLiveSheetData>>,
  paidMap: Map<string, boolean> = new Map(),
  paymentTypeMap: Map<string, string> = new Map(),
  freeReentriesMap: Map<string, number> = new Map(),
  entryPrice = 0,
  addonPrice = 0,
  bountyPrice = 0
) {
  return [
    ["Tournament ID", exportData.tournament.id],
    ["", "", "Название", exportData.tournament.title, entryPrice, addonPrice, bountyPrice],
    ["", "", "Дата", formatTournamentDate(exportData.tournament.start_at), "Entry price", "Addon price", "Bounty price"],
    ["", "", "Локация", exportData.tournament.location ?? ""],
    ["", "", "Статус", getTournamentStatusLabel(exportData.tournament.status)],
    [],
    [
      "Player ID",
      "Registration ID",
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
      "Место",
    ],
    ...exportData.rows.map((row) => [
      row.player_id,
      row.registration_id,
      row.display_name,
      row.username ? `@${row.username}` : "",
      row.registration_status,
      row.arrived,
      paidMap.get(row.player_id) ?? false,
      paymentTypeMap.get(row.player_id) ?? "",
      freeReentriesMap.get(row.player_id) ?? 0,
      row.rebuys,
      row.addons,
      row.knockouts,
      row.place ?? "",
    ]),
  ];
}

export async function syncTournamentLiveSheet(
  tournamentId: string,
  rows?: Array<{
    player_id: string;
    arrived: boolean;
    paid?: boolean;
    payment_type?: string;
    free_reentries?: number;
    rebuys: number;
    addons: number;
    knockouts: number;
    place: number | null;
  }>,
  entryPrice = 0,
  addonPrice = 0,
  bountyPrice = 0
) {
  await ensureTournamentLiveEntries(tournamentId);

  if (rows?.length) {
    await updateTournamentLiveEntries(
      tournamentId,
      rows.map((row) => ({
        player_id: row.player_id,
        arrived: row.arrived,
        rebuys: row.rebuys,
        addons: row.addons,
        knockouts: row.knockouts,
        place: row.place,
      }))
    );
  }

  const paidMap = new Map((rows ?? []).map((r) => [r.player_id, r.paid ?? false]));
  const paymentTypeMap = new Map((rows ?? []).map((r) => [r.player_id, r.payment_type ?? ""]));
  const freeReentriesMap = new Map((rows ?? []).map((r) => [r.player_id, r.free_reentries ?? 0]));

  const tournament = await getTournamentById(tournamentId);
  const tabName =
    tournament.google_sheet_tab_name?.trim() ||
    buildTabName(tournament.title, tournament.start_at, tournament.id);
  const exportData = await getTournamentLiveSheetData(tournamentId);

  await ensureReadmeTab();
  await replaceSpreadsheetTabValues("README", buildReadmeSheetValues());

  const sheet = await ensureSpreadsheetTab(tabName);
  if (sheet.created) {
    try {
      await appendReportRow(tournament.title, tabName);
    } catch (error) {
      console.error("Failed to append row to Лист1", error);
    }
  }

  await replaceSpreadsheetTabValues(
    tabName,
    buildLiveSheetValues(
      exportData,
      paidMap,
      paymentTypeMap,
      freeReentriesMap,
      entryPrice,
      addonPrice,
      bountyPrice
    )
  );
  await applyTournamentSheetFormatting(tabName, exportData.rows.length, 13);
  await setTournamentGoogleSheetTabName(tournamentId, tabName);

  return {
    tabName,
    url: buildSpreadsheetTabUrl(sheet.sheetId),
    rowsCount: exportData.rows.length,
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | {
          rows?: Array<{
            player_id: string;
            arrived: boolean;
            paid?: boolean;
            payment_type?: string;
            free_reentries?: number;
            rebuys: number;
            addons: number;
            knockouts: number;
            place: number | null;
          }>;
          entryPrice?: number;
          addonPrice?: number;
          bountyPrice?: number;
        }
      | null;

    const result = await syncTournamentLiveSheet(
      id,
      body?.rows,
      body?.entryPrice ?? 0,
      body?.addonPrice ?? 0,
      body?.bountyPrice ?? 0
    );

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to sync live sheet",
      },
      { status: 500 }
    );
  }
}
