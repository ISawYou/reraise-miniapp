import { NextResponse } from "next/server";
import {
  getTournamentSheetExportData,
  setTournamentGoogleSheetTabName,
} from "@/features/tournaments";
import { getMysteryBountySnapshot } from "@/features/mystery-bounty";
import {
  applyTournamentSheetFormatting,
  appendReportRow,
  buildSpreadsheetTabUrl,
  ensureReadmeTab,
  ensureSpreadsheetTab,
  replaceSpreadsheetTabValues,
} from "@/lib/google-sheets";
import type { MysteryBountySnapshot } from "@/types/domain";

type FreeSheetRowInput = {
  player_id: string;
  arrived: boolean;
  paid?: boolean;
  payment_type?: string;
  free_reentries?: number;
  rebuys: number;
  addons: number;
  knockouts: number;
  boss_knockouts?: number;
  mystery_bounty_points?: number;
  place: number | null;
  rating_points?: number;
  eliminated?: boolean;
  eliminated_at?: string | null;
};

function formatEliminationTimestamp(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

function getFreeTournamentStatusLabel(status: string) {
  if (status === "open") return "Открыт";
  if (status === "closed") return "Закрыт";
  if (status === "completed") return "Завершен";
  return "Черновик";
}

function buildReadmeSheetValues() {
  return [
    ["README - Google Sheets для турнирного администратора"],
    [],
    ["Что делает этот файл"],
    [
      "В этой таблице администратор на площадке заполняет игровые данные и итоговые места участников турнира.",
    ],
    [],
    ["Какие листы в таблице"],
    ["README - инструкция"],
    ["Листы турниров - рабочие таблицы по каждому турниру"],
    [],
    ["Важно"],
    ["Не удаляйте строки и не меняйте Player ID"],
    ["Повторная выгрузка того же турнира обновляет тот же лист, а не создает новый."],
  ];
}

function buildFreeSheetValues(
  exportData: Awaited<ReturnType<typeof getTournamentSheetExportData>>,
  rows?: FreeSheetRowInput[],
  entryPrice = 0,
  addonPrice = 0,
  bountyPrice = 0,
  mysteryBountySnapshot?: MysteryBountySnapshot | null
) {
  const rowsMap = new Map((rows ?? []).map((row) => [row.player_id, row]));
  const isBossBounty = exportData.tournament.tournament_type === "boss_bounty";
  const isMysteryBounty = exportData.tournament.tournament_type === "mystery_bounty";

  // Mystery Bounty snapshot metrics are write-only display cells appended
  // to the existing header rows (never new rows — data always starts at
  // row 8 / index 7, which pull-sheet's `values.slice(7)` depends on).
  // The app computes and freezes this once; the sheet never generates its
  // own values (spec §18).
  const mysteryBountyHeaderExtra: string[][] = mysteryBountySnapshot
    ? [
        [
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "Small×Cnt",
          `${mysteryBountySnapshot.small_value}×${mysteryBountySnapshot.small_count}`,
          "Medium×Cnt",
          `${mysteryBountySnapshot.medium_value}×${mysteryBountySnapshot.medium_count}`,
          "Jackpot",
          `${mysteryBountySnapshot.jackpot_value}`,
        ],
        [
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "Players",
          `${mysteryBountySnapshot.players_count}`,
          "Active",
          `${mysteryBountySnapshot.active_players_count}`,
        ],
        [
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "Rebuys",
          `${mysteryBountySnapshot.rebuys_count}`,
          "Addons",
          `${mysteryBountySnapshot.addons_count}`,
        ],
        [
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "Late Reg",
          "CLOSED",
          "Status",
          mysteryBountySnapshot.status === "active" ? "ACTIVE" : "PENDING",
        ],
        [
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "Mystery Pool",
          `${mysteryBountySnapshot.mystery_pool}`,
          "Envelopes",
          `${mysteryBountySnapshot.envelope_count}`,
        ],
      ]
    : [[], [], [], [], []];

  function mergeRow(base: (string | number | boolean)[], extra: string[]) {
    const merged = [...base];
    extra.forEach((cell, index) => {
      if (cell !== "") {
        merged[base.length + index] = cell;
      }
    });
    return merged;
  }

  return [
    mergeRow(["Tournament ID", exportData.tournament.id], mysteryBountyHeaderExtra[0]),
    mergeRow(
      ["", "", "Название", exportData.tournament.title, entryPrice, addonPrice, bountyPrice],
      mysteryBountyHeaderExtra[1]
    ),
    mergeRow(
      [
        "",
        "",
        "Дата",
        formatTournamentDate(exportData.tournament.start_at),
        "Entry price",
        "Addon price",
        "Bounty price",
      ],
      mysteryBountyHeaderExtra[2]
    ),
    mergeRow(["", "", "Локация", exportData.tournament.location ?? ""], mysteryBountyHeaderExtra[3]),
    mergeRow(
      ["", "", "Статус", getFreeTournamentStatusLabel(exportData.tournament.status)],
      mysteryBountyHeaderExtra[4]
    ),
    [],
    [
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
    ],
    ...exportData.rows.map((row) => {
      const values = rowsMap.get(row.player_id);

      return [
        row.player_id,
        row.username ?? "",
        row.display_name,
        row.username ? `@${row.username}` : "",
        row.registration_status,
        values?.arrived ?? false,
        values?.paid ?? false,
        values?.payment_type ?? "",
        values?.free_reentries ?? 0,
        values?.rebuys ?? 0,
        values?.addons ?? 0,
        values?.knockouts ?? 0,
        ...(isBossBounty ? [values?.boss_knockouts ?? 0] : []),
        ...(isMysteryBounty ? [values?.mystery_bounty_points ?? 0] : []),
        values?.place ?? "",
        values?.rating_points ?? row.rating_points ?? "",
        values?.eliminated ?? false,
        formatEliminationTimestamp(values?.eliminated_at),
      ];
    }),
  ];
}

function buildLiveSheetValues(
  exportData: Awaited<ReturnType<typeof getTournamentSheetExportData>>,
  entryPrice = 0,
  addonPrice = 0,
  bountyPrice = 0
) {
  const isBossBounty = exportData.tournament.tournament_type === "boss_bounty";

  return [
    ["Tournament ID", exportData.tournament.id],
    ["", "", "Название", exportData.tournament.title, entryPrice, addonPrice, bountyPrice],
    ["", "", "Дата", exportData.tournament.start_at, "Entry price", "Addon price", "Bounty price"],
    ["", "", "Локация", exportData.tournament.location ?? ""],
    ["", "", "Статус", exportData.tournament.status],
    [],
    [
      "Player ID",
      "Ник",
      "Telegram",
      "Статус регистрации",
      "Пришел",
      "Оплатил",
      "Нал/карта",
      "Беспл. re-entry",
      "Re-buy",
      "Addon",
      "Нокауты",
      ...(isBossBounty ? ["Boss-нокауты"] : []),
      "Место",
    ],
    ...exportData.rows.map((row) => [
      row.player_id,
      row.display_name,
      row.username ? `@${row.username}` : "",
      row.registration_status,
      "",
      false,
      "",
      0,
      0,
      0,
      0,
      ...(isBossBounty ? [0] : []),
      "",
    ]),
  ];
}

export async function syncTournamentSheet(
  tournamentId: string,
  rows?: FreeSheetRowInput[],
  entryPrice = 0,
  addonPrice = 0,
  bountyPrice = 0
) {
  const exportData = await getTournamentSheetExportData(tournamentId);
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
  if (sheet.created) {
    try {
      await appendReportRow(exportData.tournament.title, tabName);
    } catch (error) {
      console.error("Failed to append row to Лист1", error);
    }
  }

  const mysteryBountySnapshot =
    exportData.tournament.tournament_type === "mystery_bounty"
      ? await getMysteryBountySnapshot(tournamentId)
      : null;

  const values =
    exportData.tournament.kind === "free"
      ? buildFreeSheetValues(exportData, rows, entryPrice, addonPrice, bountyPrice, mysteryBountySnapshot)
      : buildLiveSheetValues(exportData, entryPrice, addonPrice, bountyPrice);

  await replaceSpreadsheetTabValues(tabName, values);

  const isBossBounty = exportData.tournament.tournament_type === "boss_bounty";
  const isMysteryBounty = exportData.tournament.tournament_type === "mystery_bounty";
  const hasExtraFreeColumn = isBossBounty || isMysteryBounty;
  const columnCount =
    exportData.tournament.kind === "free"
      ? hasExtraFreeColumn
        ? 17
        : 16
      : isBossBounty
        ? 13
        : 12;
  const ratingColumns =
    exportData.tournament.kind === "free"
      ? [hasExtraFreeColumn ? 15 : 14]
      : undefined;

  await applyTournamentSheetFormatting(
    tabName,
    exportData.rows.length,
    columnCount,
    ratingColumns
  );
  await setTournamentGoogleSheetTabName(tournamentId, tabName);

  return {
    tabName,
    url: buildSpreadsheetTabUrl(sheet.sheetId),
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
          rows?: FreeSheetRowInput[];
          entryPrice?: number;
          addonPrice?: number;
          bountyPrice?: number;
        }
      | null;

    const result = await syncTournamentSheet(
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
        error: error instanceof Error ? error.message : "Failed to export sheet",
      },
      { status: 500 }
    );
  }
}
