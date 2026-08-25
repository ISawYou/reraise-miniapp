# Re-buy / Add-on / GS Pull / Completion — investigation для интеграции с Poker Clock

Read-only расследование (2026-08-25) перед расширением интеграции Re-Raise → Poker Clock:
Re-buy, Add-on, «Обновить из GS», завершение турнира. Ничего не менялось в коде, схеме БД,
Google Sheets flow или Poker Clock — только чтение исходников, миграций и потока данных.

Область: rating/points-турниры, то есть `tournaments.kind = 'free'`
(`lib/db/schema/tournaments.ts:16,42`). Cash/paid-турниры (`kind = 'paid' | 'cash'`) идут по
отдельному live-пути через `tournament_live_entries` и упоминаются здесь только для контраста.

Уже работает на момент расследования: live arrived, live eliminated, integration API турниров,
integration API roster (`app/api/integrations/v1/**`).

## 0. Главное за минуту

- Бизнес-правило про Re-buy **подтверждается кодом дословно**: поле «Re-buy» хранит не
  количество ре-баев, а суммарное число входов (`initial + rebuys`). Это закреплено как
  явная, осознанная конвенция в комментариях сразу в трёх местах кода.
- Главный gap: для `kind=free` у Re-buy/Add-on **нет live-хранилища в Postgres вообще** —
  до нажатия «Завершить турнир» они существуют только в React state и Google Sheets.
  «Обновить из GS» ничего не пишет в БД для этих двух полей.
- Найден риск в текущем production-коде рейтинга (`features/rating-v2.ts`): агрегатная формула
  `totalRebuys = max(0, totalEntries − fieldSize)` расходится с точной по-игрочной формулой
  `Σ max(rebuy_i − 1, 0)`, если у пришедшего игрока Re-buy = 0 (валидное состояние по бизнес-правилу).
- Authoritative-момент завершения турнира — `tournaments.status = 'completed'` внутри
  `saveTournamentResults` (`features/tournaments.ts:954`), **до** записи в Google Sheets.
  Хорошая точка для будущего вызова Poker Clock, но сегодня без idempotency-гарда и без
  защиты от partial failure на этапе GS-синхронизации.

---

## 1. Семантика Re-buy

Бизнес-правило из задачи полностью подтверждается кодом:

| Re-buy | Значение |
|---|---|
| `0` | игрок ещё не получил первоначальный стек (arrived, но не заведён) |
| `1` | initial stack выдан, настоящих ребаев ещё 0 |
| `2` | initial + 1 настоящий rebuy |
| `N` | initial + (N−1) настоящих rebuy-ев |

```
actualRebuys      = max(rebuyValue - 1, 0)
initialStackTaken = rebuyValue >= 1
```

Это не предположение — дословный комментарий разработчиков, независимо повторённый в трёх местах:

- `app/api/admin/tournaments/[id]/complete-free/route.ts:87-89` — «row.rebuys is each player's
  TOTAL entries (initial entry + every rebuy) — the same admin-facing field/convention used
  throughout the app».
- `features/tournaments.ts:834-836` (`completeTournamentFromLiveEntries`) — идентичный комментарий
  для live/cash-пути.
- `lib/mystery-bounty.ts:9-18` — та же конвенция для Mystery Bounty pool: «Players + Rebuys =
  Total Entries by definition».

**Не enforced в коде:** явной связи «Re-buy не может расти без Arrived = true» не существует ни в
UI, ни в БД (нет CHECK-constraint, связывающего эти два поля). Технически `rebuys > 0` при
`arrived = false` сегодня достижимо.

## 2. Семантика Add-on

Семантика 0/1 подтверждается использованием поля в расчётах: `computeWeightedVolume` и
`computeExtraVolume` (`features/rating-v2.ts:95-113`) используют вес `2 × addons`, что
предполагает единичный add-on на игрока.

Но **«максимум один add-on» — это только продуктовая конвенция, не ограничение схемы**:

- Ни в `results.addons`, ни в `tournament_live_entries.addons` нет CHECK-constraint на значение
  (в отличие, например, от `results_itm_points_check` или `results_rating_points_check`, которые
  в `results` есть — `lib/db/schema/results.ts:85-88`).
- В UI поле имеет только `min="0"`, без `max="1"` (`app/admin/results/[id]/page.tsx:1758-1777`).
- Значение `addons = 2` технически сохранимо уже сегодня.

```
addons = addonValue   // суммируется как есть, без нормализации
```

## 3. Где хранится

Ключевой факт для всей интеграции: у Re-Raise есть **два параллельных механизма** результатов
турнира, переключаемые по `tournaments.kind` (`'free' | 'paid' | 'cash'`,
`lib/db/schema/tournaments.ts:16,42`). Rating/points-турниры — это `kind = 'free'`.

| Таблица | Поле | Тип / default | Когда существует строка | Область |
|---|---|---|---|---|
| `results` | `reentries` | `integer NOT NULL default 0` | Только после «Завершить турнир» (delete-then-insert) | result-state, tournament-specific, заморожено |
| `results` | `addons` | `integer NOT NULL default 0` | Только после «Завершить турнир» | result-state, tournament-specific, заморожено |
| `tournament_live_entries` | `rebuys` | `integer NOT NULL default 0` | С момента регистрации, но **только kind ≠ free** | live player-state, для paid/cash |
| `tournament_live_entries` | `addons` | `integer NOT NULL default 0` | С момента регистрации, только kind ≠ free | live player-state, для paid/cash |
| — (нет таблицы) | rebuys/addons для free-турниров | — | **никогда до completion** — живёт в React-state + Google Sheets | только UI + GS, не БД |

Источники: `lib/db/schema/results.ts:19-29`, `lib/db/schema/tournamentLiveState.ts:13-46`.

Это и есть тот самый gap: для rating-турниров Re-buy/Add-on — это **result-state** (появляется
только в момент завершения), а не **tournament-specific player-state**, живущий параллельно с
турниром — в отличие от `arrived` и `eliminated`, у которых такое live player-state есть
(`tournament_attendance`, `tournament_player_eliminations`, см. `lib/db/schema/tournamentLiveState.ts:48-107`).

## 4. Полный flow Re-buy (rating-турнир)

```
UI (инпут «Re-buy», page.tsx:1729)
  → updateFreeRow() — только React state (page.tsx:536)
  → [никакого запроса к серверу на этом шаге]
```

Дальше — два независимых пути «наружу» из React-state:

```
«Сохранить в GS» → POST /export-sheet → syncTournamentSheet()
  → результат: ТОЛЬКО Google Sheets (replaceSpreadsheetTabValues), Postgres не трогается
```

```
«Завершить турнир» → POST /complete-free → saveTournamentResults() (features/tournaments.ts:906)
  → resultRepository: delete-then-insert
  → Postgres: results.reentries = row.rebuys
```

Ответы на вопросы задачи:

| Вопрос | Ответ |
|---|---|
| Точное имя поля | `rebuys` в UI/API-payload → `reentries` в таблице `results` (переименование при записи, `features/tournaments.ts:927`) |
| Таблица | `results` (после completion); до этого — таблицы нет вовсе |
| result-state или player-state? | Для free-турниров — только result-state |
| Когда пишется в Postgres | Единственный момент — POST `/complete-free`, внутри `saveTournamentResults` |
| Меняется сразу при редактировании? | Нет — только локальный state до явного действия |
| Можно изменить после начала турнира? | Да, свободно, пока не нажата «Завершить турнир» |
| Можно изменить/уменьшить после completion? | Технически да — endpoint не проверяет `status`, страница не блокирует поля (см. §10, риск №4) |
| Отдельный API для Re-buy? | Нет — только массовые пути: export-sheet / pull-sheet / complete-free / live-sync / complete-live |
| Используется ли ещё где-то? | Да — питает `calculateRatingPointsV2` (агрегаты Entries/Rebuys) и Mystery Bounty pool |

## 5. Полный flow Add-on

Идентичный маршрут Re-buy — тот же инпут-компонент, тот же `updateFreeRow`, тот же
export-sheet/pull-sheet/complete-free. Единственное отличие — имя поля не переименовывается при
записи: `addons` в UI и в `results.addons` совпадают дословно
(`features/tournaments.ts:931`: `addons: item.addons ?? 0`).

| Вопрос | Ответ |
|---|---|
| Точное имя поля | `addons` везде — UI, API, `results.addons` |
| result-state или player-state? | Только result-state, как и Re-buy |
| Когда пишется в Postgres | Только при `/complete-free` |
| Отдельный API | Нет |
| Используется ещё где-то | Да — `computeWeightedVolume`/`computeExtraVolume` в `rating-v2.ts` берут его с весом ×2 |

## 6. «Обновить из GS» по полям — критичный раздел

Для `kind=free` кнопка вызывает `handlePullFreeRows` → `POST /pull-sheet`
(`pull-sheet/route.ts:54-130`, ветка `kind==="free"`). Эта ветка читает Google Sheet, мёржит с
ростером и **возвращает JSON клиенту — и всё**. Ни одного вызова репозитория на запись здесь нет.

| Поле | A. Pull меняет только React state? | B. Pull сразу пишет в Postgres? | C. Нужен доп. Save? | D. Что видит Integration API сразу после Pull |
|---|---|---|---|---|
| `arrived` | Частично — значение из листа сначала кладётся в state | Нет — сам Pull ничего не пишет | Не поможет: Save (export-sheet) тоже не пишет в `tournament_attendance` | Старое значение из `tournament_attendance`, если оно там уже есть, перезаписывает значение из листа в клиенте (`page.tsx:861`); если строки в таблице нет вовсе — API не увидит игрока как arrived, даже если в листе TRUE |
| `eliminated` | Нет — колонка листа вообще не парсится (`pull-sheet/route.ts` не читает «Выбыл»/«Время выбытия») | Нет | — | Всегда актуальное значение из `tournament_player_eliminations` — единственный источник, полностью консистентно |
| `rebuys` (Re-buy) | Да — значение из листа напрямую в state | Нет | Да, но единственный «Save» — это «Завершить турнир», не «Сохранить в GS» | Ничего не увидит — значения в БД для free-турниров нет до completion, независимо от Pull |
| `addons` (Add-on) | Да | Нет | То же, что Re-buy | То же, что Re-buy |

**Явный gap:** после «Обновить из GS» админ видит в интерфейсе новые значения Re-buy/Add-on (и
иногда — arrived), но ни одно из них не долетает до Postgres этим действием. Если между Pull и
«Завершить турнир» пройдёт время, Integration API всё это время будет отдавать
устаревшие/нулевые данные, а UI — актуальные. Для `arrived` есть дополнительная асимметрия:
колонка листа может показать TRUE, но если админ никогда не жал чекбокс «Пришёл» в самом
приложении, строки в `tournament_attendance` не существует — `findAttendedPlayersWithDetails`
(`lib/repositories/tournament-live-state/PostgresTournamentLiveStateRepository.ts:290-309`)
строго фильтрует `WHERE tournament_attendance.arrived = true`, так что Poker Clock такого игрока
не увидит, пока чекбокс не нажат вручную в Re-Raise.

**Асимметрия с paid/cash-турнирами:** в ветке `kind≠free` того же `pull-sheet/route.ts`
(строки 132-192) Pull действительно пишет в Postgres — вызывает `applyTournamentLiveSheetRows()`,
который сразу апдейтит `tournament_live_entries.rebuys/addons`. У cash/paid-турниров такого
разрыва нет — он специфичен именно для free/rating-турниров, той самой конфигурации, что нужна
Poker Clock.

## 7. Direct UI vs GS Pull — согласованность источников

Область — rating/points-турнир (`kind=free`), до завершения турнира.

| Field | Direct UI persistence | GS Pull persistence | DB source | Integration API видит сразу? |
|---|---|---|---|---|
| `arrived` | Мгновенно — POST `/attendance` при клике на чекбокс | Нет — только в state, если нет записи в БД | `tournament_attendance` | Да — если чекбокс хоть раз нажат в приложении |
| `eliminated` | Мгновенно — POST `/eliminate` | Не читается вообще из листа | `tournament_player_eliminations` | Да — всегда |
| `rebuys` | Нет — только React state | Нет — только React state | нет источника до completion | Нет (поля пока нет в контракте) |
| `addons` | Нет | Нет | нет источника до completion | Нет |

Вывод: расходящихся путей «прямое редактирование → DB» и «GS pull → только local state» в
строгом смысле нет — потому что для rebuys/addons **оба** пути ведут в никуда до completion.
Разрыв не между UI и GS, а между UI+GS (оба) и Postgres.

## 8. Integration API contract — рекомендация

Предпочтение нормализованному контракту (`initialStackTaken` + `rebuys`) подтверждается кодом
сильнее, чем можно было предположить: сама Re-Raise использует «сырое» значение
`rebuyValue = totalEntries` только как внутреннее соглашение, задокументированное отдельно в
нескольких местах кода, потому что оно контр-интуитивно даже для собственных разработчиков
(см. §1). Протекание этого соглашения в Poker Clock повторило бы ту же путаницу на новом месте.

- **Вариант A — raw** (`rebuyEntries: 3`): дёшево на стороне Re-Raise, но заставляет Poker Clock
  знать и держать в актуальном состоянии странную конвенцию «−1», которая нигде, кроме Re-Raise,
  не имеет смысла.
- **Вариант B — normalized** (`initialStackTaken: boolean, rebuys: number`) — **рекомендуется**.
  Значения должны вычисляться по формуле задачи (`rebuyValue >= 1` /
  `max(rebuyValue-1, 0)`) на стороне Re-Raise, **не** через агрегатный shortcut `rating-v2.ts`
  (см. §9).

```ts
// предлагаемое расширение GET /api/integrations/v1/tournaments/:id/players
{
  id: string
  nickname: string
  avatarUrl: string | null
  ratingPoints: number | null
  eliminated: boolean
  initialStackTaken: boolean   // rebuyValue >= 1
  rebuys: number                // max(rebuyValue - 1, 0)
  addons: number
}
```

**Предусловие, не готово сегодня:** этот контракт физически нельзя реализовать «пока играет»
rating-турнир — потому что, как показано в §3-6, для `kind=free` у rebuys/addons нет
live-хранилища в Postgres. Расширение API само по себе не закроет разрыв — сначала нужен способ
писать Re-buy/Add-on в БД раньше, чем нажата «Завершить турнир» (не в рамках этого расследования —
только фиксация факта).

## 9. Формула Poker Clock stats (total chips / average stack)

Формула из задачи соответствует бизнес-семантике данных Re-Raise **если** `actualRebuys`
считается по-игрочно, а не агрегатным способом, которым сегодня пользуется сама Re-Raise.

**Найденное расхождение.** Production-код (`features/rating-v2.ts:204-213`, используется в
реальном расчёте рейтинга, не только для дисплея) вычисляет:

```
totalEntries = Σ arrived.entries
totalRebuys  = max(0, totalEntries − fieldSize)   // fieldSize = players.length
```

Это эквивалентно `Σ max(rebuy_i − 1, 0)` **только** если у каждого пришедшего игрока
`rebuy_i ≥ 1`. Но правило из задачи явно допускает `Re-buy = 0` для пришедшего игрока, которому
ещё не выдали стек. Контрпример на реальных числах:

| Игрок | rebuyValue | По формуле задачи |
|---|---|---|
| A | 2 | `max(2−1,0) = 1` |
| B | 0 | `max(0−1,0) = 0` |

Корректный `actualRebuys = 1`. Агрегатная формула Re-Raise: `totalEntries=2, fieldSize=2 →
max(0, 2−2) = 0` — теряет один настоящий rebuy.

Это расхождение не гипотетическое для будущего — оно уже встроено в текущий production rating
engine (v2). Если ситуация «Arrived=true, Re-buy=0» когда-либо встречается в реальных турнирах
(а бизнес-правило прямо говорит, что это нормальное промежуточное состояние), текущий
рейтинг-движок Re-Raise теоретически недосчитывает totalRebuys. Не предмет исправления в рамках
этого расследования — только фиксация. **Для Poker Clock: считать actualRebuys по-игрочно
(`Σ max(rebuy_i − 1, 0)`), не переиспользовать агрегатный shortcut Re-Raise.**

Независимое подтверждение того же shortcut и той же неявной предпосылки — `lib/mystery-bounty.ts:45-49`.

Остальные компоненты формулы:

| Компонент | Статус |
|---|---|
| `arrivedTotal` | Соответствует `tournament_attendance WHERE arrived=true` — данных достаточно уже сегодня |
| `activePlayers` | `arrived && !eliminated` — оба поля live в Postgres, консистентны, уже доступны Poker Clock |
| `initialStacks` | Требует Re-buy per-player живьём — недоступно до completion для free-турниров (см. §3) |
| `actualRebuys` | То же ограничение + должен считаться по-игрочно, не агрегатно |
| `addons` | Простая сумма, но также недоступна live до completion |

Free re-entry (`free_reentries`) и Bounty/Mystery/Boss bounty поля уже сегодня физически отделены
от rebuys/addons на уровне схемы и UI — исключить их из формулы можно без дополнительной работы,
они и так нигде не смешаны с Re-buy/Add-on в коде.

## 10. Завершение турнира — где именно `status = 'completed'`

```
UI «Завершить турнир» (handleCompleteFreeTournament)
  → POST /complete-free (complete-free/route.ts)
  → reconcile: arrived ← tournament_attendance (route.ts:52-56)
  → calculateRatingPointsForTournament (route.ts:90-104)
  → saveTournamentResults() (features/tournaments.ts:906)
      1. delete results WHERE tournament_id       (tournaments.ts:920)
      2. insert results (rebuys→reentries, addons…) (tournaments.ts:943)
      3. markAttendedBulk(registrations)            (tournaments.ts:948)
      4. tournaments.status = 'completed'  ← AUTHORITATIVE (tournaments.ts:954)
      5. winner event + achievement sync (try/catch, best-effort) (tournaments.ts:956-969)
  ← saveTournamentResults() возвращается
  → syncTournamentSheet() — запись в Google Sheets (complete-free/route.ts:133-154)
```

**Authoritative-момент:** `tournamentRepository.patch(id, {status:"completed"})` внутри
`saveTournamentResults` (`features/tournaments.ts:954`) — после записи results, до Google
Sheets. Это уже готовая, безопасная точка для будущего вызова Poker Clock: DB-истина
зафиксирована, а сеть к Google ещё не трогали.

**Partial failure.** Весь POST-handler обёрнут в один try/catch. Если `syncTournamentSheet`
упадёт (после того как DB уже закоммичена), клиент получит общую ошибку «Ошибка завершения
турнира» (`lib/tournament-completion-errors.ts:29-44` — только два «expected»-случая:
валидация мест и unique-constraint; всё остальное — generic 500) — но в Postgres турнир уже
`completed`, а `results` уже сохранены. UI вводит админа в заблуждение о состоянии данных в
этом сценарии.

**Идемпотентность — небезопасна на уровне продукта.** На уровне SQL повторный вызов безопасен
(delete-then-insert, patch — natural no-op). Но нет проверки `tournament.status !== 'completed'`
ни в route, ни в `saveTournamentResults`, а страница результатов не блокирует инпуты и кнопку
«Завершить турнир» после completion. Повторный клик с изменёнными значениями
Re-buy/Add-on/место молча перезаписывает «замороженные» `results` — то самое свойство, которое
комментарии в `lib/db/schema/results.ts:42-46` называют «Frozen snapshot… never recalculated
retroactively». Плюс winner-event и achievement-sync переигрываются повторно.

**Для контраста — complete-live (paid/cash).** Та же архитектура: authoritative-момент —
`tournamentRepository.patch(...,{status:'completed'})` внутри `completeTournamentFromLiveEntries`
(`features/tournaments.ts:886`). Отличие: `complete-live/route.ts` синхронизирует Google Sheet
дважды — один раз до завершения (строки 36-42) и один раз после (строки 46-52), причём второй
раз с теми же client-submitted `rows`, не перечитывая уже закоммиченное состояние из БД. Не баг,
но избыточность, которую стоит иметь в виду, если Poker Clock-хук в будущем будет вешаться на
этот путь тоже.

## 11. Риски и неоднозначности

1. **Нет live-хранилища Re-buy/Add-on для rating-турниров.** Единственный физический источник —
   React state + Google Sheets до нажатия «Завершить турнир». Любой будущий live-контракт Poker
   Clock для этих двух полей потребует новой персистентности, которой сегодня нет — расширение
   JSON-ответа само по себе проблему не решит.
2. **Arrived может «сходиться» неверно после GS Pull.** Если admin проставляет «Пришёл» только в
   Google Sheets и никогда не жмёт чекбокс в приложении, `tournament_attendance` не получает
   строку — Integration API не увидит игрока arrived, хотя при completion `results.arrived`
   всё равно возьмёт значение из клиентского submit (которое может быть основано на данных из
   листа). Live-view и финальный snapshot могут разойтись для игроков, чью явку вводили только
   через таблицу.
3. **Агрегатная формула rebuys в `rating-v2.ts`.** `max(0, totalEntries − fieldSize)` расходится
   с точной по-игрочной формулой, когда у arrived-игрока Re-buy=0. Встроено в реальный расчёт
   рейтинга сегодня, не только в дисплей.
4. **Re-buy/Add-on редактируемы после completion без предупреждения.** Ни UI, ни API не
   блокируют повторное изменение и повторный вызов «Завершить турнир» для уже завершённого
   турнира — «замороженный» results молча перезаписывается.
5. **Partial failure в completion скрывает успешный DB-commit.** Ошибка на этапе Google Sheets
   sync после уже закоммиченных results/status возвращает общий 500 клиенту — админ видит
   «Ошибка завершения», хотя турнир по факту уже completed в БД.
6. **Add-on «максимум 1» — не ограничение схемы.** Нет CHECK-constraint ни в `results`, ни в
   `tournament_live_entries`. Значение 2+ технически сохранимо и сегодня, и в будущем API, если
   контракт не добавит собственную валидацию на стороне Poker Clock или Re-Raise.
7. **Re-buy > 0 при Arrived = false технически достижимо.** Нет constraint, связывающего эти два
   поля. Не встречается в обычном UI-флоу, но стоит явно решить семантику для будущего API до
   того, как она станет вопросом на проде.

## 12. Доказательная база (файл:строка)

| Локация | Что подтверждает |
|---|---|
| `lib/db/schema/results.ts:19-29` | Колонки `reentries`, `addons` в `results`, с комментарием о «Total Entries» конвенции |
| `lib/db/schema/tournamentLiveState.ts:13-46` | `tournament_live_entries` — live player-state, но только для paid/cash |
| `lib/db/schema/tournamentLiveState.ts:48-107` | `tournament_player_eliminations`, `tournament_attendance` — live, для всех kind, композитный PK |
| `lib/db/schema/tournaments.ts:15-46` | `kind` ('free'\|'paid'\|'cash'), `tournament_type`, CHECK-constraints |
| `app/admin/results/[id]/page.tsx:413, 536-580, 671-694` | `isFreeTournament`, `updateFreeRow` (state-only), `handleToggleFreeArrived` (мгновенный write) |
| `app/api/admin/tournaments/[id]/export-sheet/route.ts:386-454` | `syncTournamentSheet` — пишет только в Google Sheets + `google_sheet_tab_name` |
| `app/api/admin/tournaments/[id]/pull-sheet/route.ts:54-130` vs `132-192` | free-ветка не пишет в БД; live-ветка вызывает `applyTournamentLiveSheetRows` |
| `app/api/admin/tournaments/[id]/complete-free/route.ts:87-89` | Дословный комментарий: «row.rebuys is each player's TOTAL entries» |
| `features/tournaments.ts:497-511` | `getTournamentResultsDraft` — ростер без rebuys/addons вообще |
| `features/tournaments.ts:906-970` | `saveTournamentResults` — authoritative completion для free-турниров, порядок операций |
| `features/tournaments.ts:1088-1160, 1205-1246` | Elimination/Attendance CRUD + `getArrivedPlayersForIntegration` (текущий контракт) |
| `lib/repositories/tournament-live-state/PostgresTournamentLiveStateRepository.ts:290-309` | `findAttendedPlayersWithDetails` — строгий фильтр `arrived=true` по таблице |
| `features/rating-v2.ts:204-213` | Production-формула агрегатных `totalRebuys` — источник риска №3 |
| `lib/mystery-bounty.ts:9-18, 45-49` | Независимое подтверждение конвенции «Re-buy = Total Entries» + тот же агрегатный shortcut |
| `docs/RATING_ENGINE_V2_IMPLEMENTATION.md:43-49` | Письменное подтверждение конвенции в проектной документации |
| `app/api/admin/tournaments/[id]/complete-live/route.ts:35-52` | Двойная синхронизация Google Sheets до/после завершения для live-пути |
| `lib/tournament-completion-errors.ts:29-44` | Единая обработка ошибок completion — общий 500 для «неожиданных» ошибок |
| `grep: "poker.?clock\|external_tournament_id\|club_id"` | Ни одного совпадения в схеме/коде Re-Raise — привязка к Poker Clock существует только на стороне Poker Clock |

---

*Расследование проведено с использованием Graphify (`python -m graphify`) для первичной
навигации, все ключевые выводы перепроверены прямым чтением исходников и Drizzle-схемы.
Ничего не изменено: код, схема БД, Google Sheets flow и Poker Clock не тронуты.*
