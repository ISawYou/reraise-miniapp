// README tab content for the tournament Google Sheets. Both export routes
// (export-sheet for free/rating tournaments, live-sync for paid/cash) write
// the SAME shared "README" tab, so the roster-ownership instructions live
// here once and are appended by both.
//
// Hard boundary this text documents: ReRaise owns the roster, the waitlist,
// "Не пришёл" and "Допустить в игру" -- the sheet has NO checkbox for any
// of these and its "Статус регистрации" column is written by ReRaise only.
export const ROSTER_OWNERSHIP_README_LINES: string[][] = [
  ["Состав турнира и лист ожидания"],
  ["Состав турнира и лист ожидания управляются в ReRaise."],
  ["Кнопки «Не пришёл» и «Допустить в игру» находятся в приложении."],
  ["Google Таблица используется для ведения уже допущенных игроков."],
  [
    "Если игрок находится в листе ожидания и пришёл в клуб, сначала нажмите «Допустить в игру» в ReRaise. Не переводите его вручную через таблицу.",
  ],
];

// Free/rating tournaments (app/api/admin/tournaments/[id]/export-sheet).
export function buildFreeTournamentReadmeSheetValues(): string[][] {
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
    [],
    ...ROSTER_OWNERSHIP_README_LINES,
  ];
}

// Paid/cash live tournaments (app/api/admin/tournaments/[id]/live-sync).
export function buildLiveTournamentReadmeSheetValues(): string[][] {
  return [
    ["README - live-данные турниров"],
    [],
    ["Эта таблица синхронизируется с Mini App."],
    ["Редактировать можно поля: Пришел, Оплатил, Нал/карта, Беспл. re-entry, Re-buy, Addon, Nok, Boss-нокауты, Место."],
    ["Технические поля скрыты и нужны только для синхронизации."],
    [],
    ...ROSTER_OWNERSHIP_README_LINES,
  ];
}
