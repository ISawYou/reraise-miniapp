# Rating Engine v2 — отчёт о внедрении

**Дата:** 2026-08-12
**Статус:** реализовано, протестировано, готово к ревью. Историю сезона не трогали.

Реализация по одобренному плану (`C:\Users\KRESTALL\.claude\plans\graceful-toasting-newt.md`) с учётом исправленной бизнес-математики add-on (2× вес entry/rebuy) — правки внесены до начала реализации.

---

## 1. Изменённые файлы

### Новые файлы

| Файл | Назначение |
|---|---|
| `features/rating-v2.ts` | Единый Rating Engine v2 — вся новая формула, чистые функции, версия-диспетчер |
| `features/__tests__/rating-v2.test.ts` | Unit-тесты v2 (кейсы A–N + доп. проверки) |
| `lib/db/migrations/0005_same_blizzard.sql` | Миграция: `results.addons`, `tournaments.rating_formula_version`, `tournaments.rating_guarantee` |
| `lib/db/migrations/meta/0005_snapshot.json` | Drizzle-kit снапшот схемы (сгенерирован `db:generate`) |

### Изменённые файлы

| Файл | Что изменено |
|---|---|
| `features/rating.ts` | **Только** `getBasePlacePoints`/`getFieldCoefficient` сделаны `export` (было `function`, стало `export function`) — сама формула `calculateRatingPoints` не тронута ни строкой |
| `lib/mystery-bounty.ts` | `computeMysteryPool`: формула `entries×6+addons×12` → `entries×5+addons×10` |
| `lib/db/schema/results.ts` | + колонка `addons` |
| `lib/db/schema/tournaments.ts` | + колонки `rating_formula_version`, `rating_guarantee` + check-constraints |
| `types/database.ts`, `types/domain.ts` | Новые поля в `TournamentRow`/`Tournament`, `addons` в `ResultRow`/`TournamentResultInput`/`TournamentResult` |
| `lib/repositories/result/{PostgresResultRepository,SupabaseResultRepository,ResultRepository}.ts` | Персист `addons` (insert + read) |
| `lib/repositories/tournament/{PostgresTournamentRepository,SupabaseTournamentRepository}.ts` | Персист `rating_formula_version`/`rating_guarantee` (insert/update/read) |
| `features/tournaments.ts` | `saveTournamentResults` пишет `addons`; `completeTournamentFromLiveEntries` переведён на `calculateRatingPointsForTournament`; `updateTournament` принимает `rating_guarantee`; третья копия `mapTournamentRow` (локальная, для join-запросов) тоже получила новые поля |
| `features/mystery-bounty.ts` | `computeSnapshotInputs` версия-гейтит формулу Mystery Pool (legacy/v2) |
| `app/api/admin/tournaments/[id]/complete-free/route.ts` | Диспетчер legacy/v2, персист `addons` |
| `app/api/admin/tournaments/[id]/export-sheet/route.ts` | Блок `ratingEngineHeaderExtra` в Google Sheets (только для v2, не Mystery) |
| `app/api/admin/tournaments/route.ts` | Принимает `rating_guarantee` при создании турнира |
| `app/admin/tournaments/create/page.tsx`, `app/admin/tournaments/[id]/edit/page.tsx` | Поле «Rating Guarantee», видимое только для Phoenix |
| `app/admin/results/[id]/page.tsx` | Легаси-бонус-строка («×1.20») теперь показывается только для `rating_formula_version=legacy`; для v2 — живой блок Rating Engine v2 (Players/Entries/Rebuys/Addons + мультипликатор/пул), считается на клиенте той же функцией, что и на сервере |
| `lib/__tests__/mystery-bounty.test.ts` | Числа под новую формулу (240 вместо 290, и т.д.) |

---

## 2. Как хранится/вычисляется Entries / Rebuys / Addons / Paid Units

- **Entries** — не отдельная сущность. Административное поле «Re-buy» (как и раньше) хранит **суммарное число входов игрока** (initial + все rebuys) — тот же принцип, что уже был у Mystery Bounty. Новых полей ввода не добавлено (спец. §2 требовал именно так).
- **Rebuys** — не хранится нигде явно как per-player значение сверх существующего. На уровне турнира вычисляется на лету: `Total Rebuys = max(0, Total Entries − Players)`.
- **Addons** — теперь **персистится** в Postgres (`results.addons`) для free-турниров, чего раньше не было (админ UI уже собирал это поле и слал в Google Sheets, но `complete-free` его молча отбрасывал перед записью в БД — это была архитектурная дыра, которую исправление и закрыло). Для live (paid/cash) турниров `tournament_live_entries.addons` уже существовал и теперь тоже пробрасывается в `results.addons`.
- **Weighted Volume / Extra Volume** (aka «Paid Units» из ТЗ, переименовано ради явности 2×-веса add-on) вычисляются в `features/rating-v2.ts` из агрегатов по пришедшим игрокам на лету при завершении турнира — нигде не хранятся как отдельные колонки, только как временная метаданная расчёта (`meta`), которая уходит в Google Sheets и в live-превью админки, но не в БД (не персистится намеренно — легко пересчитывается из уже сохранённых `entries`/`addons`, хранить избыточно).

---

## 3. Единый Rating Engine

`features/rating-v2.ts` — единственное место с новой бизнес-логикой. Ключевые экспорты:

- `roundHalfUp`, `computeWeightedVolume`, `computeExtraVolume`, `computeVolumeMultiplier`, `computeAddonPlacementMultiplier` — чистые формулы.
- `distributePhoenixTopUp` — Largest Remainder Method с детерминированным tie-break по месту.
- `calculateRatingPointsV2` — основной расчёт по типу турнира (volume / addon_share / mystery / phoenix-ветки).
- `calculateRatingPointsForTournament(players, type, ratingFormulaVersion, options)` — **единая точка диспетчеризации** legacy↔v2, которую используют **оба** места завершения турнира (`complete-free` route и `completeTournamentFromLiveEntries`) — раньше это было два независимых вызова `calculateRatingPoints`, теперь один общий диспетчер, что закрывает риск рассинхронизации между free- и live-путями.

Формула `calculateRatingPoints` (v1) в `features/rating.ts` осталась нетронутой — только две вспомогательные функции стали `export`, поведение `calculateRatingPoints` не изменилось ни на бит (подтверждено тестом N, byte-for-byte сравнение).

---

## 4. Versioning

`tournaments.rating_formula_version` (`text`, `CHECK IN ('legacy','v2')`, `NOT NULL`).

Миграция (по образцу уже использовавшегося в 0004 паттерна add→backfill→constrain):
1. Добавить колонку nullable.
2. `UPDATE tournaments SET rating_formula_version='legacy' WHERE rating_formula_version IS NULL` — **все существующие на момент миграции турниры** получают `legacy`.
3. `SET DEFAULT 'v2'` — только после этого, чтобы default не подмешался в backfill.
4. `SET NOT NULL` + `CHECK`.

Итог: каждый новый турнир после деплоя автоматически получает `v2`; каждый существующий (все 34+ завершённых) остаются на `legacy`. Диспетчер (`calculateRatingPointsForTournament`) читает это поле у **конкретного турнира**, а не полагается на дату деплоя — поэтому повторное открытие/редактирование старого завершённого турнира **гарантированно** пересчитывает его старой формулой, даже если это произойдёт через год после деплоя v2.

То же самое поле версионирует и формулу Mystery Pool (`features/mystery-bounty.ts::computeSnapshotInputs` теперь принимает `ratingFormulaVersion` и внутри выбирает старую 6/12-формулу или новую 5/10-формулу) — предохранитель на случай гипотетического Mystery-турнира, у которого Late Registration была открыта до раскатки v2 (сейчас такого турнира в базе нет — единственный исторический Mystery Bounty уже завершён и заморожен).

---

## 5. Google Sheets sync

Архитектура не менялась (app считает → сохраняет → таблица отображает, формул в самой таблице как не было, так и нет). Добавлен один write-only блок `ratingEngineHeaderExtra`, использующий тот же слот заголовочных строк (1–5, колонки после базовых полей), что и уже существующий `mysteryBountyHeaderExtra` — показывает Weighted/Extra Volume, Volume/Addon Share, множитель, а для Phoenix — Natural/Guarantee/TopUp/Final Pool. Рендерится **только** для `rating_formula_version=v2` и **только** не-Mystery типов (Mystery сохраняет свой существующий блок как есть).

`pull-sheet/route.ts` **не тронут** — блок целиком в неиспользуемых колонках, индексы, по которым парсится ответ, не сдвинулись.

---

## 6. Phoenix Rating Guarantee

- Новое поле `tournaments.rating_guarantee` (nullable integer), настраивается в форме создания/редактирования турнира — **только когда выбран тип Phoenix** (первый в проекте пример условного по типу турнира поля).
- Механика (`calculateRatingPointsV2`, ветка `phoenix`): считается natural pool (участие + место по объёмной формуле, без нокаутов); если `naturalPool < guarantee` — `topUp = guarantee − naturalPool`, распределяется **только** между призовыми местами методом Largest Remainder пропорционально их natural placement points (не участию, не тотал). Инвариант `sum(final rating_points всех пришедших игроков) === Rating Guarantee` при срабатывании — проверен тестами K/L (168/200 → topUp=32, сумма ровно 200).
- Guarantee не сохраняется как отдельный «замороженный» снапшот-пул (в отличие от Mystery) — она пересчитывается заново при каждом сохранении/завершении турнира из текущих `players/entries/addons/place`, что соответствует требованию §23 «live preview для незавершённого турнира» без лишней инфраструктуры.

---

## 7. Подтверждение удаления WTB/Phoenix ×1.20 (v2)

`lib/tournament-helpers.ts::getTournamentTypeMultiplier` (источник ×1.20) **не изменён** и по-прежнему используется — но **только** legacy-формулой (`features/rating.ts::calculateRatingPoints`, вызывается для `rating_formula_version=legacy`). Новый движок `calculateRatingPointsV2` эту функцию **не импортирует и не вызывает вообще** — ни для WTB, ни для Phoenix, ни для чего-либо ещё. Подтверждено тестами I и J: при идентичных входных данных WTB/Phoenix (v2) дают **точно такой же** результат, что и Classic (v2) — то есть эффективно `×1.00`, легаси-коэффициент полностью заменён на объёмный мультипликатор.

Admin UI: строка «Бонус рейтинга ×1.20» на странице результатов теперь показывается **только** для `rating_formula_version=legacy` — для v2-турниров вместо неё показывается реальный Volume/Placement Multiplier.

---

## 8. Результаты тестов

`npx vitest run`:

```
Test Files  4 failed | 4 passed (8)
     Tests  2 failed | 64 passed (66)
```

Все 64 прошедших теста включают:
- 20 новых тестов `features/__tests__/rating-v2.test.ts` (кейсы A–N + доп. проверки участия/чистых формул) — **все зелёные**.
- Обновлённые `lib/__tests__/mystery-bounty.test.ts` (23 теста, включая новую 5/10-формулу) — **все зелёные**.
- Существующий `features/__tests__/rating.test.ts` (legacy, 5 тестов) — **не тронут, не менялся, зелёный** — подтверждает, что v1 остался байт-в-байт прежним.

Оставшиеся 2 failed / 4 failed suites — **предсуществующие**, не связаны с этой задачей: подтверждено сравнением baseline (`git stash` → тот же набор падений уже был **до** начала работы над Rating Engine v2). Это `lib/__tests__/telegram.test.ts` (порядок-зависимые моки sessionStorage/WebApp) и три файла (`admin-delete-player`, `admin-remove-participant`, `waitlist`), падающие из-за нерешённого `"server-only"` в Vite/Vitest-конфиге — оба класса проблем существовали в проекте до этой сессии и не входят в объём этой задачи.

`npx tsc --noEmit` — чисто, 0 ошибок.
`npx eslint` по всем изменённым файлам — 0 ошибок, только 5 предсуществующих warning'ов в местах, которые я не трогал (img-элементы, неиспользуемые параметры в чужом коде).

---

## 9. Расчёты вручную vs application output

| Сценарий | Ручной расчёт | Тест / где проверено |
|---|---|---|
| Classic, Players=14, Entries=28, Addons=0 | Volume Share=0.5, Multiplier=1.625, место 1 = round(162.5)+2=165 | Тест B |
| Classic, Players=14, Entries=28, Addons=10 | Weighted=48, Extra=34, Share=0.708333, Multiplier=1.885417, место1=round(188.5417)+2=191 | Тест C |
| Bounty, те же числа, KO=2 на месте 1 | Addon Share=20/48=0.416667 (НЕ 34/48 — rebuys не подмешиваются), Multiplier=1.520833, место1=round(152.0833)+10(KO)+2=164 | Тест E |
| Mystery Pool, Entries=28, Addons=10 | 28×5+10×10=240 (не 290, не 380) | `lib/__tests__/mystery-bounty.test.ts`, `docs/RATING_BALANCE_ANALYSIS.md`-совместимо |
| Phoenix, 3 игрока, Natural Pool=168, Guarantee=200 | TopUp=32, доли 14/10/8 по Largest Remainder, sum=200 | Тест L |
| Phoenix, Natural Pool=168, Guarantee=100 | Не срабатывает, Final=168 | Тест K |

Все совпадают с выводом `calculateRatingPointsV2`/`computeMysteryPool` — подтверждено ассертами в тестах, не только «на бумаге».

---

## 10. Подтверждение: исторические турниры не пересчитаны

- Формула v1 (`features/rating.ts::calculateRatingPoints`) изменена **только** добавлением `export` к двум вспомогательным функциям — логика расчёта идентична байт-в-байт, что доказано тестом N (прямой вызов `calculateRatingPoints` даёт тот же результат, что и диспетчер с `ratingFormulaVersion="legacy"`).
- Миграция 0005 backfill'ит `rating_formula_version='legacy'` для **всех** турниров, существующих на момент миграции, **до** того как колонка получает default `'v2'` — то есть ни один исторический турнир не может случайно получить v2-математику.
- `results.rating_points` нигде не пересчитывается массово — ни в миграции, ни в коде. Единственный способ изменить `rating_points` завершённого турнира — заново вызвать `complete-free`/`complete-live` вручную, и в этом случае диспетчер всё равно прочитает сохранённый `rating_formula_version` турнира и применит **ту же** формулу, что применялась изначально.
- Массовый пересчёт истории сезона **не выполнялся** и не запускался.

---

## 11. Что осталось за скобками этой задачи (сознательно)

- **Регламент рейтинга / FAQ** (`app/faq/page.tsx`) — не переписан, по прямому указанию спеки (§29, отдельная будущая задача).
- **`features/achievements.ts`** — пороги `rookie_100_rating`(100)/`pro_1000_rating`(1000) откалиброваны под старую шкалу очков и не пересматривались. Это уже отмечалось в плане (раздел «Key architecture facts») как известный побочный эффект: по мере накопления v2-турниров (более крупные пулы для non-knockout форматов) эти пороги будут достигаться быстрее, чем изначально задумано. Не входит в объём задачи, но стоит иметь в виду при следующей итерации.
- **Массовая миграция истории** — не делалась, как и требовалось.
- **Выбор конкретной величины Phoenix Rating Guarantee** — не выбирался мной, поле полностью на усмотрение администратора per-турнир.
