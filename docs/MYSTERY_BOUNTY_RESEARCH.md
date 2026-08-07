# Re-Raise: архитектура турниров перед Mystery Bounty

> Архитектурное исследование, read-only. Код, миграции, БД и Google Sheets не изменялись; completion-роуты не запускались. Источники — прямое чтение исходников (первично) и Graphify-навигация (вторично, для ориентации).
>
> Дата: 2026-08-08. Стек: Next.js · TypeScript · Drizzle/Postgres · Supabase · Google Sheets API.

## Содержание

1. [Executive summary](#01-executive-summary)
2. [Карта типов турниров](#02-карта-типов-турниров)
3. [Lifecycle турнира end-to-end](#03-lifecycle-турнира-end-to-end)
4. [Players / arrived / active / eliminated](#04-players--registration--arrived--active--eliminated)
5. [Rebuys / Add-ons](#05-rebuys--add-ons)
6. [Existing Bounty](#06-existing-bounty-bounty--boss_bounty)
7. [Rating pipeline](#07-rating-pipeline)
8. [Google Sheets architecture](#08-google-sheets-architecture-и-source-of-truth)
9. [DB model](#09-db-model-ключевые-поля)
10. [Admin UI map](#10-admin-ui-map)
11. [Graphify paths](#11-ключевые-graphify-paths)
12. [Риски регрессий](#12-риски-регрессий-при-добавлении-нового-tournament-format)
13. [Куда встраивать Mystery Bounty](#13-куда-архитектурно-должен-встраиваться-mystery-bounty--предварительный-вывод)
14. [Открытые вопросы](#14-открытые-вопросы--не-решаются-однозначно-по-коду)

---

## 01. Executive summary

У турнира два независимых измерения, и это ключевое для проектирования Mystery Bounty:

- `tournament.kind`: `free | paid | cash` — **какой из двух конвейеров исполнения** (обычная «свободная» форма результатов vs. полноценный live-режим с `tournament_live_entries`).
- `tournament.tournament_type`: `classic | phoenix | deep_stack | bounty | boss_bounty | win_the_button` — **формат/механика начисления рейтинга** и опциональные доп.поля в UI/Sheets.

> **Главная находка.** `kind` — мёртвое измерение. И в API создания (`app/api/admin/tournaments/route.ts:80`), и в обоих мапперах чтения строки БД (`lib/repositories/tournament/PostgresTournamentRepository.ts:16-22`, `lib/repositories/tournament/SupabaseTournamentRepository.ts:16-30`) значение жёстко захардкожено как `"free"`, независимо от того, что реально лежит в столбце БД. Комментарий в коде прямо это фиксирует: *"every tournament created through the app is 'free' today"*. Live-режим (paid/cash), маршруты `complete-live`/`live-sync`, таблица `tournament_live_entries` — всё это полностью реализовано, но недостижимо через объектную модель приложения. Ни один турнир, созданный через приложение, физически не может сегодня иметь `kind ≠ "free"` с точки зрения бизнес-логики.

Реальный рычаг дифференциации — `tournament_type`. Именно он переключает бонусы рейтинга (`features/rating.ts:47-78`) и единственное реально ветвящееся по типу UI-поле — «Boss Nok» для `boss_bounty`.

> **Существующий Bounty проще, чем можно было предположить.** «Bounty» в проекте — это чисто рейтинговая механика: ручной счётчик нокаутов на игрока, конвертируемый в +5 (обычный нокаут) / +10 (boss-нокаут) очков рейтинга. Денег/выплат, привязанных к нокауту, в коде нет вообще — ни расчёта, ни хранения. Поле «Bounty price» существует в UI и в Google Sheets, но нигде не умножается ни на что — это чисто отображаемая метаданная для ручного учёта организатором. Атрибуции «кто кого выбил» тоже нет — только числовой счётчик.

Рейтинг — **полностью вычисляемое** состояние (нет столбца `rating` ни на `players`, ни где-либо ещё): всегда свежий `SUM(results.rating_points)`, посчитанный один раз в момент завершения турнира и замороженный как снапшот (комментарий в `lib/db/schema/results.ts:28-32` подтверждает: не пересчитывается ретроактивно при изменении формулы).

Google Sheets — одна таблица (spreadsheet), по одной вкладке на турнир. Приложение почти всегда пишет (clear-then-replace), читает только через отдельный `pull-sheet`. «Guard от записи в dev», который упомянут в задаче — **в коде не найден** (см. §08 и §14).

Денежного слоя (buy-in/prize pool/spent) в коде нет вообще ни для одного формата турнира — это будет новый код независимо от того, как архитектурно разместить Mystery Bounty. Также нет готового запроса «сколько игроков сейчас реально активны» — тоже нужно строить с нуля.

---

## 02. Карта типов турниров

Source of truth для обоих измерений — `types/domain.ts:14-21`:

```ts
export type TournamentKind = "free" | "paid" | "cash";
export type TournamentType =
  | "classic" | "phoenix" | "deep_stack"
  | "bounty" | "boss_bounty" | "win_the_button";
```

Postgres-ограничения (`lib/db/schema/tournaments.ts:16-30`) продублированы независимыми `CHECK`-констрейнтами на каждый столбец — без композитного правила, связывающего `kind` и `tournament_type` между собой; технически комбинация `kind=cash + tournament_type=bounty` в БД не запрещена, но недостижима через приложение (см. §01).

### Измерение kind — какой конвейер исполняется

| Значение | UI | Бизнес-смысл | Создание | Проведение | Завершение | Рейтинг | Sheets |
|---|---|---|---|---|---|---|---|
| `free` | нет селектора — единственный реально существующий | «обычный» турнир: форма результатов на клиенте + Sheets, без постоянного live-состояния в БД | хардкод при создании (`route.ts:80`) | `app/admin/results/[id]/page.tsx`, ветка `isFreeTournament`; вылеты через `/eliminate` | `POST .../complete-free` | формула по `tournament_type`, не по `kind` | `export-sheet`, 16/17-колоночный layout |
| `paid` / `cash` | нет UI-пути установить это значение | «live»-конвейер: `tournament_live_entries` как постоянное состояние в БД во время игры | невозможно через приложение | код существует (`features/tournaments.ts:625-724`), но недостижим — гейт `kind==="free"` throw | `POST .../complete-live` — тоже недостижим на практике | формула идентична, но требует все `place` заполненными | `live-sync`, 12/13-колоночный layout |

### Измерение tournament_type — реальная дифференциация

| Значение | UI-лейбл | Бизнес-смысл | Влияние на рейтинг | Доп. поля |
|---|---|---|---|---|
| `classic` | Texas Classic | база, множитель ×1 | стандартная формула без бонусов | — |
| `phoenix` | Phoenix | реентри-формат | множитель ×1.2 (`lib/tournament-helpers.ts:40-46`) | — |
| `deep_stack` | Deep Stack | глубокий стек | стандартная формула | — |
| `bounty` | Bounty | охота за головами (только рейтингово) | +5 очков/нокаут (`features/rating.ts:64-65`) | обычное поле «Nok» |
| `boss_bounty` | Boss Bounty | bounty + отдельная «boss»-цель | +5/нокаут и +10/boss-нокаут | отдельная колонка «Boss Nok» в UI и Sheets |
| `win_the_button` | Win The Button | особый формат баттона | множитель ×1.2 | — |

> **Нет единого source of truth для списка значений.** Zod/схема-валидации в проекте нет вообще (0 совпадений на `zod` в репозитории). Список из 6 значений `tournament_type` продублирован вручную минимум в 6+ местах: `types/domain.ts`, `types/database.ts`, Drizzle-схема + миграция, два независимых массива `TOURNAMENT_TYPE_OPTIONS` (create/edit страницы), `lib/tournament-helpers.ts` (лейблы/бонусы). Добавление `boss_bounty` исторически потребовало правки во всех точках сразу (коммит `435846d "Boss Bounty"`, 14+ файлов) — это прецедент объёма работы для нового типа.

---

## 03. Lifecycle турнира end-to-end

Фактическая цепочка статусов — только `open → completed`. `draft` и `closed` существуют в enum (`tournaments_status_check`), но ни один код-путь их не устанавливает.

1. **Create** — `app/admin/tournaments/create/page.tsx:78-91` → `POST /api/admin/tournaments` (`app/api/admin/tournaments/route.ts:34-108`) → `tournamentRepository.create({kind:"free", status:"open", ...})` → `Postgres/SupabaseTournamentRepository.create`.
2. **Registration** — не REST, а Next.js Server Action: `registerPlayerForTournament` (`features/tournaments.ts:240-281`), вызывается из `app/tournaments/[id]/page.tsx:318`. Ёмкость (`max_players`) проверяется на уровне приложения (сравнение count), в БД никакого constraint на вместимость нет.
3. **«Старт»** — явного перехода нет. «Live» — это просто UI-режим экрана результатов, переключаемый по `kind`. Ничего не «стартует» — это открытие экрана управления.
4. **Live/управление** — `app/admin/results/[id]/page.tsx`: одна большая страница на обе ветки (free / live). Вылет — `POST /api/admin/tournaments/[id]/eliminate` → `setTournamentPlayerElimination` (`features/tournaments.ts:1028-1062`), сегодня подключён только к free-ветке UI.
5. **Results** — вводятся вручную администратором (place/knockouts/boss_knockouts), не выводятся автоматически из вылетов. Таблица `results` имеет уникальные ограничения `(tournament_id, player_id)` и `(tournament_id, place)`.
6. **Complete** — два раздельных маршрута, `complete-cash` не существует.
7. **Rating** — `calculateRatingPoints` (`features/rating.ts`), см. §07.
8. **Google Sheets** — синхронизация до и/или после завершения, см. §08.

### complete-free vs complete-live — почему два маршрута

| | `complete-free` | `complete-live` |
|---|---|---|
| Файл | `app/api/admin/tournaments/[id]/complete-free/route.ts` | `app/api/admin/tournaments/[id]/complete-live/route.ts` |
| Источник результатов | доверяет `rows` из тела запроса напрямую | перечитывает `tournament_live_entries` из БД, тело запроса используется только для sync в Sheet перед завершением |
| Гейт по kind | нет | `completeTournamentFromLiveEntries` кидает ошибку, если `kind==="free"` (`features/tournaments.ts:795-797`) |
| Валидация | — | требует заполненный `place` у каждой live-записи (`features/tournaments.ts:805-813`) |
| Sheets | 1 запись после завершения | 2 записи: до и после завершения (`complete-live/route.ts:32-48`) |
| Общее | оба — `deleteByTournamentId` → `insertMany` → `markAttendedBulk` → `patch(status:"completed")` → best-effort `syncPlayersAchievements` | |

> **Идемпотентность без явного guard.** Ни один из маршрутов не проверяет `tournament.status !== "completed"` перед выполнением. Идемпотентность достигается косвенно — паттерном delete-then-insert, а не явным блокированием повторного запуска. Повторный вызов возможен в любой момент и полностью перезатирает `results` (без аудиторского следа первого запуска). Риск: если во втором сабмите два игрока получат одинаковый `place`, bulk-INSERT упадёт *после* уже выполненного `deleteByTournamentId` — турнир на короткое время останется без единой строки в `results`.

---

## 04. Players / registration / arrived / active / eliminated

| Состояние | Где хранится | Значения | Кто выставляет |
|---|---|---|---|
| Регистрация | `registrations.status` | `registered / waitlist / cancelled / attended` | `registerPlayerForTournament`, `cancelPlayerRegistration` |
| Arrived (live) | `tournament_live_entries.arrived` | boolean | чекбокс в `app/admin/results/[id]/page.tsx:1343` |
| Arrived (free) | нет столбца БД — только React-state + Google Sheet | boolean | чекбокс, живёт до export/complete |
| Eliminated | `tournament_player_eliminations` (composite PK `tournament_id, player_id`) | `eliminated` bool + `eliminated_at` | `setTournamentPlayerElimination`, `features/tournaments.ts:1028-1062` |
| Место/финиш | `tournament_live_entries.place` → заморожено в `results.place` | null пока активен, 1..N по завершении | ручной ввод администратором |
| No-show | — | **отдельного состояния нет** — только косвенно, через `arrived=false` | — |

> **No-show не отделён от «пришёл».** При завершении турнира `markAttendedBulk` (`lib/repositories/registration/PostgresRegistrationRepository.ts:187-202`) переводит в `attended` **всех** игроков из финального списка, вне зависимости от `arrived`. Единственный след неявки — `arrived: false` в замороженных live-данных и итоговые 0 очков рейтинга (`features/rating.ts:60-61`: `if (!player.arrived) return {rating_points: 0}`).

> **Таблица eliminations подключена только к free-ветке.** `tournament_player_eliminations` и маршрут `/eliminate` полностью рабочие, но вызываются исключительно из free-ветки экрана результатов (`app/admin/results/[id]/page.tsx:397-468`). Для live/paid-ветки (потенциально именно там будет жить Mystery Bounty, если он денежный) «активный игрок» сегодня **нигде не вычисляется** — ни `eliminated=false`, ни `arrived && place IS NULL` не используются как агрегирующий запрос где-либо в коде.

> **«Active Players At Late Registration Close» — такого запроса нет.** Ни в одном месте кода не вычисляется «сколько игроков сейчас реально ещё в игре». Ближайшие сырые данные для этого: `tournament_live_entries` с фильтром `arrived=true AND place IS NULL` (для paid/cash) или `tournament_player_eliminations.eliminated=false` (для free) — но ни то, ни другое сегодня не агрегируется. Для Mystery Bounty Pool это придётся строить с нуля, и явно выбрать, на каком из двух (несовместимых сегодня) механизмов основываться.

**Bust → rebuy → снова active / bust → no rebuy → покинул**: `setTournamentPlayerElimination` и обновление `rebuys` (`updateLiveEntry`) — две полностью независимые операции, нигде не связанные кодом. Rebuy не «отменяет» элиминацию автоматически, элиминация не блокирует rebuy. Синхронность между ними — целиком на администраторе, руками.

---

## 05. Rebuys / Add-ons

Хранятся как **счётчики** (не отдельные сущности-события): `tournament_live_entries.rebuys` / `.addons`, целые числа, обновляются прямым SQL `UPDATE` (`lib/repositories/tournament-live-state/PostgresTournamentLiveStateRepository.ts:104-138`). Истории отдельных событий rebuy/add-on в схеме БД нет — только текущее значение.

UI — обычные `<input type="number">` в `app/admin/results/[id]/page.tsx:1396-1417`, без кнопки «+1»; администратор вводит итоговое число целиком.

> **reentries = rebuys** (просто переименование на границе завершения): `results.reentries: entry.rebuys` (`features/tournaments.ts:837`) — один и тот же концепт под двумя именами по разные стороны completion.

> **Add-ons теряются после завершения.** `results` не имеет столбца addons — при `saveTournamentResults`/`completeTournamentFromLiveEntries` add-on-счётчик просто отбрасывается. Если Mystery Bounty Pool должен учитывать add-on'ы постфактум — нужна новая колонка/логика.

> **Нет временного окна для изменений.** Ни один из путей записи rebuy/add-on не проверяет `tournament.status`. `live-sync`/`export-sheet` можно вызвать даже после `status="completed"` — ничего не блокирует. Комплитмент тоже можно перезапускать сколько угодно раз (см. §03). Итог: сегодня нет механизма «заморозить» пул после завершения турнира.

> **Денежного расчёта нет вообще.** Поиск по `spent|buy_in|buyin|prize_pool|prizePool` по всему репозиторию — 0 совпадений. `entryPrice`/`addonPrice`/`bountyPrice` существуют только как значения ячеек заголовка в Google Sheet (для ручного учёта человеком) — нигде не умножаются на `rebuys`/`addons`/knockouts в коде TypeScript. Prize pool для Mystery Bounty — на 100% новый код.

---

## 06. Existing Bounty (bounty / boss_bounty)

Администратор создаёт Bounty-турнир так же, как любой другой — выбором `tournament_type` в выпадающем списке при создании (`app/admin/tournaments/create/page.tsx:9-16`). Никаких дополнительных полей на этапе создания не появляется.

**Нокауты записываются как простой ручной целочисленный счётчик** на строку игрока («Nok» / «Boss Nok» инпуты, `app/admin/results/[id]/page.tsx:1236-1259, 1444-1492`) — не привязаны к тому, кто именно кого выбил. Чекбокс «Выбыл» (элиминация) влияет только на место самого выбывающего игрока и никак не трогает чужой счётчик нокаутов — это две независимые ручные операции администратора.

```ts
// lib/tournament-helpers.ts:48-54
supportsTournamentKnockouts(type)      // bounty | boss_bounty
supportsTournamentBossKnockouts(type)  // boss_bounty only

// features/rating.ts:64-67
const knockoutPoints = hasKnockouts ? player.knockouts * 5 : 0;
const bossKnockoutPoints = supportsTournamentBossKnockouts(tournamentType)
  ? (player.boss_knockouts ?? 0) * 10 : 0;
```

> **Нет ни денег, ни атрибуции — только рейтинг.** Bounty в Re-Raise — это переключатель бонуса в формуле рейтинга плюс (для boss_bounty) одна дополнительная колонка в UI/Sheets. Никакого выплатного/денежного слоя, привязанного к нокауту, не существует. «Bounty price» — просто отображаемая цифра в Sheets, вводимая вручную и нигде не используемая программно.

**boss_bounty vs bounty**: единственная разница — второй, отдельный счётчик «boss-нокаутов» (×10 очков вместо ×5), со своей колонкой в UI (`app/admin/results/[id]/page.tsx:298`, `isBossBountyTournament`) и в Google Sheets. Других отличий (структура блайндов, размер стека и т.п.) в коде не найдено.

Пересинхронизация/повторное завершение: knockouts/boss_knockouts подчиняются той же схеме delete-then-insert, что и весь `results` — перезаписываются полностью, отдельного защищённого журнала нокаутов нет (см. §03 про идемпотентность).

Sheets: колонка «Boss Nok»/«Boss-нокауты» условно вставляется в layout при `tournament_type === "boss_bounty"`, сдвигая индексы остальных колонок — эта проверка руками продублирована в 6 разных местах (`export-sheet/route.ts:103,163,240`, `live-sync/route.ts:65,179`, `pull-sheet/route.ts:47`) вместо использования общего хелпера `supportsTournamentBossKnockouts`.

---

## 07. Rating pipeline

Формула — `features/rating.ts:47-78`, вызывается один раз в момент завершения (не раньше, не по расписанию):

```ts
const BASE_PLACE_POINTS = {1:100, 2:75, 3:55, 4:40, 5:30, 6:24, 7:19, 8:15, 9:12, 10:10, 11:8, 12:6}; // иначе 5

// коэффициент поля (fieldSize = кол-во arrived)
0.7 (≤7) · 0.85 (≤11) · 1.0 (≤15) · 1.1 (≤19) · 1.2 (≤24) · 1.3 (≤29) · 1.4 (≤35) · 1.5 (>35)

// на игрока:
if (!arrived) return { rating_points: 0 };
basePlacePoints = place ≤ ratingZoneSize ? BASE_PLACE_POINTS[place] : 0;
knockoutPoints = hasKnockouts ? knockouts * 5 : 0;
bossKnockoutPoints = supportsBossKnockouts ? boss_knockouts * 10 : 0;
placePoints = basePlacePoints > 0
  ? round(basePlacePoints * fieldCoefficient * typeMultiplier) : 0;
rating_points = placePoints + knockoutPoints + bossKnockoutPoints + 2;  // "+2 за участие"
```

`ratingZoneSize` = `getExpectedPrizePlaces` = `clamp(ceil(fieldSize * 0.3), 3, fieldSize)` (`lib/tournament-helpers.ts:75-81`) — «призовая зона» рейтинга, за пределами которой призовые очки за место не начисляются (только +2 за участие и очки за нокауты).

**+2 за участие подтверждено буквально** — безусловное слагаемое для каждого `arrived`-игрока, независимо от места.

**Рейтинг — вычисляемое состояние**, не накопительное: на `players` нет столбца рейтинга вообще. Профиль игрока (`app/players/[id]/page.tsx:217`) — сумма `resultRepository.findRatingPointsByPlayerId` за всё время; leaderboard (`app/api/leaderboard/route.ts:1-56`) — та же сумма, но в рамках активного сезона.

> **Идемпотентность подтверждена, но без накопления.** Оба маршрута завершения делают `deleteByTournamentId` → `insertMany` — повторный запуск не удваивает очки, полностью пересчитывает и замещает строки `results` для этого турнира. Но при этом **`rating_points` — замороженный снапшот** (комментарий `lib/db/schema/results.ts:28-32`): изменение формулы в будущем не пересчитает задним числом уже завершённые турниры, только явный повторный вызов completion для конкретного турнира это сделает.

`lib/achievement-engine/` — отдельная, однонаправленная система: `RatingEvaluator` лишь читает уже посчитанную сумму рейтинга как один из пяти входов для ачивок, ничего не пишет обратно в `results`.

---

## 08. Google Sheets architecture и source of truth

Единственный живой клиент — `lib/google-sheets.ts` (543 строки, service-account JWT через `GOOGLE_CLIENT_EMAIL`/`GOOGLE_PRIVATE_KEY`). `lib/sheets.ts` — пустой файл, мёртвый код, нигде не импортируется. Один spreadsheet на весь проект (`GOOGLE_SHEETS_SPREADSHEET_ID`), по одной вкладке на турнир, имя вкладки — `tournament.google_sheet_tab_name`. Вкладка создаётся лениво, при первой записи (`ensureSpreadsheetTab`, `lib/google-sheets.ts:49-92`), не при создании турнира.

### Кто что пишет/читает

| Маршрут | Направление | Операция | Когда |
|---|---|---|---|
| `export-sheet` | App → Sheet | clear + update (`replaceSpreadsheetTabValues`) | вручную из UI; повторно из `complete-free` |
| `live-sync` | DB ← UI, затем DB → Sheet | сначала пишет в `tournament_live_entries`, потом clear+update Sheet | вручную; дважды из `complete-live` (до и после) |
| `pull-sheet` (free) | Sheet → UI (черновик) | чтение, без записи в БД | вручную, требует уже существующую вкладку |
| `pull-sheet` (paid/cash) | Sheet → DB | upsert по игроку в `tournament_live_entries` | вручную — единственное место, где Sheets данные автоматически попадают в БД |

> **«Development Google Sheets write guard» — в коде не найден.** Проверено: `NODE_ENV`, dry-run, feature-флаги, конфиги, docker-compose — единственная проверка перед записью — это проверка наличия трёх env-переменных (`lib/google-sheets.ts:19-47`), не проверка окружения. Если у разработчика локально настроены реальные production-креды — локальный вызов `export-sheet`/`live-sync`/`pull-sheet` уйдёт в боевую таблицу. Единственно безопасное поведение (которое и было соблюдено в этом исследовании) — вообще не вызывать эти маршруты.

Источник истины по стадиям (пример для paid/cash-live): после `pull-sheet` — БД (`tournament_live_entries`) снова авторитетна до следующей ручной правки в самой таблице. Для free-режима — Google Sheet авторитетен «в моменте» до explicit export/complete, ничего не сохраняется в БД до самого завершения (кроме элиминаций, которые пишутся сразу через `/eliminate`).

Идемпотентность операций: все записи значений — `clear`-then-`update` (не append) → безопасно для повторного запуска *с точки зрения дублирования строк*, но **опасно для ручных правок** в самой таблице — они гарантированно затираются при следующем export/live-sync/complete. Единственная `append`-операция — создание строки-отчёта в вкладке «Лист1» при первом создании вкладки турнира, защищена флагом `created`.

---

## 09. DB model (ключевые поля)

| Таблица | Ключевые поля | Констрейнты |
|---|---|---|
| `tournaments` | `kind`, `tournament_type`, `status`, `max_players`, `season_id`, `google_sheet_tab_name` | независимые CHECK на `kind` и `tournament_type`; `max_players > 0` |
| `registrations` | `status`, `player_id`, `tournament_id` | unique `(player_id, tournament_id)` |
| `tournament_live_entries` | `arrived`, `rebuys`, `addons`, `knockouts`, `boss_knockouts`, `place`, `sheet_row_number` | unique `registration_id` |
| `tournament_player_eliminations` | `eliminated`, `eliminated_at` | composite PK `(tournament_id, player_id)` |
| `results` | `place`, `reentries`, `knockouts`, `boss_knockouts`, `rating_points` (frozen), `season_id` | unique `(tournament_id, player_id)` и `(tournament_id, place)`; `place > 0`; `rating_points ≥ 0` |
| `seasons` | активный сезон определяет scope leaderboard'а | — |
| `players` | `can_access_free/paid/cash`, `referral_count`, `free_reentries_balance` | **нет столбца рейтинга** — подтверждает derived-модель |

История миграций (`lib/db/migrations/`): `0000` — исходная схема Postgres/Drizzle (`tournament_type` ещё без `boss_bounty`); `0001` — добавление `boss_bounty` в CHECK + столбцы `boss_knockouts`; `0002` — не относится к турнирам. Параллельный ручной скрипт `sql/boss_bounty.sql` синхронизирует то же самое на Supabase-стороне.

---

## 10. Admin UI map

| Экран | Файл | Зависит от kind/type? |
|---|---|---|
| Создание турнира | `app/admin/tournaments/create/page.tsx` | `TOURNAMENT_TYPE_OPTIONS` — выбор типа; `kind` не показан вообще |
| Список турниров | `app/admin/tournaments/page.tsx` | нет |
| Редактирование + ростер регистраций | `app/admin/tournaments/[id]/edit/page.tsx` | `tournament_type` редактируется; `kind` — нет |
| Live/результаты (единственный экран на обе kind-ветки) | `app/admin/results/[id]/page.tsx` (1501 строк) | `isFreeTournament` переключает весь layout; `isBossBountyTournament` добавляет колонку «Boss Nok» |
| Вылет игрока | `app/api/admin/tournaments/[id]/eliminate/route.ts` | подключён только из free-ветки |

Отдельного каталога компонентов для турниров нет (в отличие от `components/achievements/`) — вся админ-логика инлайнена в 4 файла страниц выше. `components/TournamentCard.tsx` и `components/RatingTable.tsx` — пустые файлы, мёртвый код.

---

## 11. Ключевые Graphify paths

`python -m graphify update .` выполнен в начале — топологических изменений не обнаружено (граф уже актуален по существующему коду). Запросы, использованные для навигации (все выводы затем перепроверены прямым чтением исходников):

- `python -m graphify query "tournament kind type"` — вывел на `lib/db/migrations/meta/*_snapshot.json` и связал `kind`/`tournament_type` со столбцами `tournaments` — отправная точка для §02/§09.
- `python -m graphify query "bounty tournament"` — вывел на `types/domain.ts` (`TournamentType`, `TournamentKind`, `TournamentResult`, `TournamentPlayerElimination`) — отправная точка для §04/§06/§07.

> **Найдена рассинхронизация графа.** Один из research-агентов обнаружил, что граф индексирует `.migration-backup/lib/google-sheets.ts` (устаревшая копия без `appendReportRow` и флага `created`) наравне с реальным живым `lib/google-sheets.ts` — потому что оба файла физически существуют в репозитории. Это не проблема кэша Graphify, а гигиена репозитория: каталог `.migration-backup/` с устаревшими копиями типов/кода стоит либо удалить, либо явно исключить из индексации, иначе граф-навигация будет систематически предлагать устаревшие узлы наравне с живыми (как и вышло в этом исследовании — отсюда правило «Graphify использовать как инструмент навигации, но все важные выводы перепроверять прямым чтением», которое здесь и спасло).

---

## 12. Риски регрессий при добавлении нового tournament format

1. **Пробуждение мёртвого кода.** Если Mystery Bounty будет реализован через `kind="paid"/"cash"`, это впервые активирует live-конвейер (`complete-live`, `live-sync`, `tournament_live_entries`), который никогда не выполнялся в проде на реальных данных. Это качественно другой уровень риска, чем добавление нового значения `tournament_type`.
2. **Элиминации не подключены к live-ветке.** Понадобится либо впервые связать чекбокс «Выбыл» с paid/cash-режимом, либо выбрать альтернативный источник «активности» (`arrived && place IS NULL`) — ни один вариант сегодня не оттестирован.
3. **Нет completion lock.** Rebuy/add-on/элиминации можно менять после `status="completed"`; completion можно перезапускать бесконечно. Любой денежный пул, «замороженный» по факту завершения, сегодня ничем не защищён от последующего изменения исходных данных.
4. **Clear-then-replace в Sheets стирает ручные правки.** Если организатор поправит вкладку турнира руками (например, вручную распределит bounty-пул), следующий export-sheet/live-sync/complete полностью её перезапишет.
5. **Замороженный rating_points-снапшот.** Если формула для Mystery Bounty будет меняться после запуска, потребуется явно решить и задокументировать retroactivity policy — сама архитектура не пересчитывает прошлое автоматически.
6. **Дублирование enum-списков вручную (6+ мест).** Пропуск одного из них при добавлении `mystery_bounty` — это либо runtime-ошибка на уровне Postgres CHECK (без валидации на уровне приложения), либо тихая рассинхронизация UI/лейблов.
7. **Нет денежного слоя вообще.** Prize pool/bounty pool — полностью новый код, более широкая поверхность для ошибок, чем расширение существующей рейтинговой логики.
8. **Нет запроса «активных игроков сейчас».** Придётся выбрать один источник данных (live-entries vs eliminations) и построить агрегацию с нуля — при выборе неверного источника (несовместимого с фактической kind-веткой) число будет систематически неверным.
9. **Отсутствие Zod/схема-валидации.** Некорректное значение типа будет поймано только на уровне «сырой» Postgres-ошибки CHECK-constraint — плохой UX для админки при опечатке.
10. **Мёртвые файлы и `.migration-backup/` засоряют навигацию** (и человеку, и графу) — стоит учитывать при поиске «похожего существующего кода» для reuse.

---

## 13. Куда архитектурно должен встраиваться Mystery Bounty — предварительный вывод

Вывод основан не на названии «MYSTERY_BOUNTY», а на том, какое из двух измерений в этой архитектуре реально несёт вариативность формата.

### Вариант A — новое значение tournament_type (рекомендуется как отправная точка)

Точно повторяет уже проверенный на практике путь добавления `boss_bounty`: расширение enum + миграция, хук в `features/rating.ts`, пункт в `TOURNAMENT_TYPE_OPTIONS` (оба места), опциональная доп.колонка в UI/results/Sheets.

- **DB**: 1 миграция (CHECK constraint).
- **UI**: 2 правки списка + опциональное поле.
- **Live flow**: без изменений — работает поверх уже используемого free-конвейера.
- **Completion**: без изменений.
- **Rating**: новая ветка в существующей формуле.
- **Sheets**: возможна доп.колонка по образцу boss_bounty.
- **Backward compat**: минимальный риск — все существующие типы не затрагиваются.

### Вариант B — активировать kind="paid"/"cash" (live-конвейер)

Оправдан только если Mystery Bounty должен быть по-настоящему денежным форматом с постоянным live-состоянием в БД, а не «ещё одной кнопкой в форме результатов».

- **DB**: без изменений схемы, но впервые реально используемые таблицы.
- **UI**: нужно связать элиминации с live-веткой, протестировать весь ранее мёртвый путь.
- **Live flow**: впервые проверяется в проде — наибольший риск.
- **Completion**: `complete-live` впервые реально исполняется.
- **Rating**: формула уже это поддерживает.
- **Sheets**: live-layout впервые реально используется.
- **Backward compat**: не ломает free-турниры, но добавляет новый, ранее нетестированный класс поведения приложения.

> **Главный вывод.** Ось `tournament_type` — единственная ось, которая исторически (boss_bounty) успешно несла новый игровой формат с минимальным blast radius. Ось `kind` сегодня не несёт варьирования вообще — это переключатель между «работает» (free) и «существует, но никогда не запускалось» (paid/cash). Технически естественнее всего добавить Mystery Bounty как новое значение `tournament_type` поверх free-конвейера — **если** продуктовый смысл Mystery Bounty укладывается в «дополнительная рейтинговая механика» (как сегодняшний bounty/boss_bounty). Но реальный Mystery Bounty (случайные/скрытые денежные бонусы за нокаут, обычно с реальным пулом и выплатой) требует денежного слоя и понятия «кто кого выбил», которых **не существует ни для одного типа турнира сегодня** — это будет новая инфраструктура независимо от выбора между вариантом A и B. «Расширение существующего Bounty» (третий вариант из задания) по факту сводится к варианту A плюс эта новая инфраструктура — не отдельный архитектурный путь, а его частный случай.

---

## 14. Открытые вопросы — не решаются однозначно по коду

- Хардкод `kind:"free"` — это осознанное текущее состояние продукта (paid/cash отложены) или технический долг/забытая недоделка? От ответа зависит, стоит ли Mystery Bounty впервые активировать live-конвейер.
- Должен ли Mystery Bounty реально перемещать деньги (пул, выплата по нокауту), или — как сегодняшний Bounty — быть чисто рейтинговой механикой с денежной терминологией только для человека-организатора?
- Нужна ли атрибуция «кто кого выбил» (для конвертов/карточек с суммами), или достаточно счётчика на игрока, как сегодня?
- Должны ли элиминации (`tournament_player_eliminations`) быть впервые подключены к live/paid-ветке, или «активный игрок» лучше определять как `arrived && place IS NULL` в `tournament_live_entries`?
- Нужен ли completion lock (запрет правок rebuy/add-on/элиминаций и повторного завершения после `status="completed"`) до того, как на нём будет основан денежный расчёт пула?
- Должны ли add-on'ы наконец сохраняться в `results` постфактум, если они входят в расчёт пула Mystery Bounty?
- Существует ли guard от записи в Google Sheets в dev-окружении на уровне инфраструктуры/процесса (вне этого репозитория)? В коде такого guard'а не найдено — риск случайной записи в боевую таблицу с локальной машины при реальных креды в `.env.local`.
- Стоит ли перед добавлением `mystery_bounty` сначала вынести дублирующиеся списки типов в общий `config/tournaments.ts` (по аналогии с `config/achievements.ts`) — учитывая, что boss_bounty потребовал правки 6+ разрозненных мест?
- Какая политика ретроактивности рейтинга нужна, если формула Mystery Bounty будет меняться после первых прогонов — учитывая, что `rating_points` сегодня замороженный снапшот по конструкции?
