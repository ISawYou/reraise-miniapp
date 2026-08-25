# Live persistence для Re-buy/Add-on (kind=free) + normalized Integration API

Реализация по итогам read-only investigation
([docs/POKER_CLOCK_REBUY_ADDON_INVESTIGATION.md](./POKER_CLOCK_REBUY_ADDON_INVESTIGATION.md)):
закрывает главный найденный gap — у rating/points-турниров (`kind='free'`) не было live-хранилища
для Re-buy/Add-on в Postgres. Poker Clock не тронут.

Выкатывалось в два коммита, специально ради безопасного порядка "schema до runtime":

- **Phase 1** (`1ffe3cc2fe1982e9f67463678e15e07b54d22a61`, закоммичен, запушен, задеплоен) —
  additive-only: таблица `tournament_rebuy_state`, репозиторный слой (Postgres + Supabase), миграция
  `0013_green_warbound.sql`. Ни один production request path её ещё не вызывал — см. доказательство
  в §7. Миграция `0013` затем применена к production Postgres через штатный
  `production-migrations.yml` (`workflow_dispatch`, подтверждение `MIGRATE`) — **успешно, green**.
- **Phase 2** (этот документ, ниже) — поведенческая часть: прямое сохранение из UI, `commit`-флаг у
  «Обновить из GS», нормализованный Integration API contract, completion reconciliation. Именно
  Phase 2 описан в разделах 2-6 ниже.

production для этого функционала — только `https://re-raise.ru` (VPS, `DATABASE_PROVIDER=postgres`).
Vercel/Supabase выведены из production-контура отдельным cutover (Telegram Menu Button и webhook
переключены на re-raise.ru, Vercel Git auto-deploy отключён) до начала Phase 2 — миграция схемы в
Supabase поэтому сознательно **не выполнялась** и не требуется: `SupabaseTournamentLiveStateRepository`
реализация в коде осталась (тот же паттерн, что и у всех остальных доменов — держится для отката),
но production-рантайм её не вызывает.

## 1. Выбранная live schema

Новая таблица `tournament_rebuy_state` — **не** `tournament_live_entries` (его семантика
специфична для paid/cash: `registration_id` FK, `knockouts`, `place`, `sheet_row_number` — ничего
из этого не существует для free-турнира до completion). Смоделирована 1:1 на
`tournament_attendance`/`tournament_player_eliminations` — тот же паттерн, что уже принят в
проекте для operational player-state: композитный PK, без suid, plain last-processed-wins upsert,
без клиентского ordering token.

```
tournament_rebuy_state (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  rebuys        integer NOT NULL DEFAULT 0 CHECK (rebuys >= 0),
  addons        integer NOT NULL DEFAULT 0 CHECK (addons >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
)
```

Хранит **сырое** админское значение «Re-buy» (Total Entries convention), не нормализованное —
нормализация в `initialStackTaken`/`rebuys` происходит только на границе Integration API
(`getArrivedPlayersForIntegration`), никогда в хранилище. Это сознательный выбор: раздельные
ответственности («что хранит Re-Raise внутри» vs «что видит Poker Clock снаружи»), тот же принцип,
что уже применён к `results.reentries`.

- Схема: [lib/db/schema/tournamentLiveState.ts](../lib/db/schema/tournamentLiveState.ts) (таблица `tournamentRebuyState`, добавлена четвёртой в файл рядом с `tournamentLiveEntries`/`tournamentPlayerEliminations`/`tournamentAttendance`)
- Интерфейс репозитория: [lib/repositories/tournament-live-state/TournamentLiveStateRepository.ts](../lib/repositories/tournament-live-state/TournamentLiveStateRepository.ts) (`RebuyState`, `RebuyStateUpsert`, `findRebuyStateByTournamentId`, `upsertRebuyState`)
- Postgres-реализация: [PostgresTournamentLiveStateRepository.ts](../lib/repositories/tournament-live-state/PostgresTournamentLiveStateRepository.ts) (Drizzle upsert, `onConflictDoUpdate`)
- Supabase-реализация: [SupabaseTournamentLiveStateRepository.ts](../lib/repositories/tournament-live-state/SupabaseTournamentLiveStateRepository.ts) — обычный `.upsert()`, RPC-функция **не понадобилась** (в отличие от `tournament_attendance`, где `arrived_at` требует COALESCE-логики — здесь оба поля всегда простой overwrite). Держится в коде для симметрии/отката, production её не вызывает (Vercel/Supabase retired, см. intro)
- Manual-apply SQL для Supabase-проекта: [sql/tournament_rebuy_state.sql](../sql/tournament_rebuy_state.sql) — **сознательно не применён** ни к какой БД (Vercel/Supabase больше не production backend — применять незачем), файл остаётся в репозитории как есть, как и `sql/tournament_attendance.sql`
- Drizzle-миграция: [lib/db/migrations/0013_green_warbound.sql](../lib/db/migrations/0013_green_warbound.sql) — применена к production Postgres через `production-migrations.yml` (green run, backup verified, `applied` count подтверждён до/после)

Оба backend'а реализованы (`lib/repositories/tournament-live-state/index.ts` переключает
Supabase/Postgres через `DATABASE_PROVIDER`) — на момент реализации схемы (Phase 1) ещё не было
окончательно решено, останется ли Vercel/Supabase вторым production-деплоем. Решение принято позже,
до начала Phase 2: Vercel/Supabase выведены из production-контура (см. intro выше), production —
только re-raise.ru/Postgres. Supabase-реализация репозитория осталась в коде нетронутой (тот же
принцип отката, что и у остальных доменов), но `sql/tournament_rebuy_state.sql` сознательно не
применялся — Vercel больше не деплоит и не исполняет этот код.

## 2. Direct UI persistence

Поля Re-buy/Add-on — свободный числовой инпут, а не чекбокс, поэтому «мгновенно» здесь означает
**commit на blur**, а не на каждый keystroke:

- `onChange` по-прежнему только меняет React state (без изменений).
- `onBlur` теперь, помимо существующей нормализации пустого значения в "0", дополнительно
  отправляет пару `{rebuys, addons}` через `RebuyWriteQueue` — новый класс
  ([lib/rebuy-write-queue.ts](../lib/rebuy-write-queue.ts)), обобщение существующего
  `AttendanceWriteQueue` на значение из двух чисел вместо одного булева (тот же класс
  переиспользовать нельзя — он жёстко типизирован под `boolean`). Та же гарантия: не более одного
  запроса на игрока в полёте, поздние правки коалесцируются.
- Пишет через новый эндпоинт `POST /api/admin/tournaments/[id]/rebuy-state`
  ([route.ts](../app/api/admin/tournaments/[id]/rebuy-state/route.ts)) →
  `setTournamentPlayerRebuyState` ([features/tournaments.ts](../features/tournaments.ts)).
- **Без rollback-на-ошибке** (в отличие от attendance): фоновый сбой сохранения не откатывает то,
  что админ только что напечатал — только `setError`. Обоснование: для чекбокса откат нужен, чтобы
  визуальное состояние не врало; для текстового поля откат печатного значения был бы хуже, чем
  просто показать ошибку и позволить повторить попытку на следующий blur.

При загрузке страницы и при "Обновить из GS" live-состояние оверлеится поверх черновика/листа тем
же способом, что уже применяется к `arrived`/`eliminated` — то есть Postgres выигрывает у
устаревшего значения из превью, а не наоборот. Иначе перезагрузка страницы могла бы визуально
«откатить» уже сохранённую правку.

## 3. GS Pull persistence

Ключевое архитектурное решение: `pull-sheet` — **один и тот же эндпоинт** используется (а) для
автоматического read-only превью при открытии страницы, и (б) для явного клика «Обновить из GS».
Раньше отличить их было невозможно. Добавлен опциональный флаг `commit` в теле POST:

- `commit` не передан / `false` → эндпоинт ведёт себя ровно как раньше: только парсит лист,
  возвращает JSON, ничего не пишет в БД. Именно это по-прежнему шлёт автозагрузка страницы.
- `commit: true` → **только** после парсинга листа, для `kind='free'`, дополнительно вызывает
  `setTournamentPlayerAttendance` + `setTournamentPlayerRebuyState` для каждой строки. Это
  единственное значение, которое шлёт кнопка «Обновить из GS» (`handlePullFreeRows` в
  [page.tsx](../app/admin/results/[id]/page.tsx)).

Почему разделение критично: если бы `pull-sheet` коммитил всегда, простое открытие страницы могло
бы молча перезаписать `tournament_attendance` устаревшим значением из листа. Явный клик — это
единственный момент, где «доверять листу сейчас» является настоящим продуктовым решением
администратора, а не побочным эффектом загрузки страницы.

`eliminated` **намеренно не тронут** — колонка «Выбыл» в листе по-прежнему не парсится на pull
(подтверждено ещё в investigation, поведение не менялось). Задача явно просила не добавлять это
автоматически без отдельного подтверждения необходимости — решение: оставить как есть.

- Реализация: [app/api/admin/tournaments/[id]/pull-sheet/route.ts](../app/api/admin/tournaments/[id]/pull-sheet/route.ts)
- Тесты: [pull-sheet/__tests__/route.test.ts](../app/api/admin/tournaments/[id]/pull-sheet/__tests__/route.test.ts) — commit false/true/omitted, Re-buy 0→1→2 по последовательным pull'ам, arrived false→true, free_reentries/bounty не просачиваются в rebuy-state, paid/cash не задет

## 4. Новый Integration API contract

`GET /api/integrations/v1/tournaments/:id/players` расширен нормализованными полями:

```ts
export type IntegrationPlayer = {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  ratingPoints: number | null;
  eliminated: boolean;
  initialStackTaken: boolean;  // rawRebuy >= 1
  rebuys: number;               // max(rawRebuy - 1, 0)
  addons: number;                // as-is
};
```

Нормализация — **по-игрочно**, в
`getArrivedPlayersForIntegration` ([features/tournaments.ts](../features/tournaments.ts)), а не
через агрегатный shortcut `max(0, totalEntries - fieldSize)` из `features/rating-v2.ts`. Это
сознательное решение по итогам investigation (§8-9 read-only отчёта): агрегатная формула
недосчитывает, если у пришедшего игрока raw Re-buy = 0, пока у других игроков raw Re-buy ≥ 2 —
именно та ситуация, для которой бизнес-правило явно оставляет Re-buy = 0 валидным состоянием.
Тест `"does NOT use the aggregate ... shortcut"` в
[tournament-attendance.test.ts](../features/__tests__/tournament-attendance.test.ts) прямо
воспроизводит этот контрпример на двух игроках и проверяет, что per-player-подход даёт верный
результат там, где агрегатная формула ошиблась бы.

Игрок без строки в `tournament_rebuy_state` (никогда не трогали) трактуется как raw Re-buy = 0 —
`initialStackTaken: false, rebuys: 0` — тот же принцип «отсутствие строки = ещё не случилось»,
что уже используется для `eliminated`.

Маршрут `app/api/integrations/v1/tournaments/[id]/players/route.ts` не менялся — он просто
сериализует то, что вернёт feature-функция; новые поля протекают через него без изменений кода.

## 5. Completion reconciliation

`complete-free` уже реконсилировал `arrived` против `tournament_attendance` (защита от устаревшей
второй вкладки). Та же логика, тот же файл, добавлена для `rebuys`/`addons` против
`tournament_rebuy_state`:

```ts
const [attendance, rebuyState] = await Promise.all([
  getTournamentAttendance(id),
  getTournamentRebuyState(id),
]);
const rows = rawRows.map((row) => {
  const liveRebuyState = rebuyState.get(row.player_id);
  return {
    ...row,
    arrived: attendance.get(row.player_id)?.arrived ?? row.arrived ?? false,
    rebuys: liveRebuyState?.rebuys ?? row.rebuys ?? 0,
    addons: liveRebuyState?.addons ?? row.addons ?? 0,
  };
});
```

**Authoritative semantics при completion: live Postgres-состояние побеждает submitted React
rows, когда для игрока есть строка в `tournament_rebuy_state`** — ровно то же правило, что уже
принято для `arrived`, и по той же причине (защита от устаревшей второй вкладки/сессии). Если
строки нет вовсе (игрока никогда не трогали ни в UI, ни через commit-pull) — используется
submitted-значение, затем 0. Никакого «два независимых значения одновременно» не остаётся: ровно
одно правило разрешает конфликт, и оно уже было прецедентно для `arrived`.

`completeTournamentFromLiveEntries` (paid/cash-путь) **не тронут** — там источник истины уже
`tournament_live_entries`, другой gap не было.

- Реализация: [app/api/admin/tournaments/[id]/complete-free/route.ts](../app/api/admin/tournaments/[id]/complete-free/route.ts)
- Тесты: [complete-free/__tests__/route.test.ts](../app/api/admin/tournaments/[id]/complete-free/__tests__/route.test.ts) — live-state побеждает submitted, fallback на submitted при отсутствии live-строки, fallback на 0/0, "stale second tab" сценарий, rating считается по реконсилированному значению (не по submitted), free_reentries/mystery_bounty_points не задеты, Mystery Bounty guard не сломан, 0/0 не роняет запись

## 6. Существующий UI не ухудшен

- Редактирование таблицы работает как раньше — persistence происходит за кулисами на blur, без
  новых кнопок/подтверждений.
- «Обновить из GS» ведёт себя визуально так же (то же сообщение, тот же payload rows) — просто
  теперь ещё и коммитит в БД.
- Paid/cash-форма (`tournament_live_entries`) не тронута вообще — ни одна строка кода в
  live-ветке `updateLiveRow`/`handleSyncLiveRows`/`handlePullFromSheet`/`handleCompleteLiveTournament`
  не менялась.
- Полный ручной прогон в браузере не выполнялся (см. §8) — только автоматические тесты и
  production build.

## 7. Изменённые/новые файлы

**Phase 1** (`1ffe3cc2fe1982e9f67463678e15e07b54d22a61`, уже в `main`, задеплоен, `0013` применена к production):
- `lib/db/schema/tournamentLiveState.ts` — таблица `tournamentRebuyState`
- `lib/repositories/tournament-live-state/TournamentLiveStateRepository.ts` — интерфейс + типы
- `lib/repositories/tournament-live-state/PostgresTournamentLiveStateRepository.ts` — реализация
- `lib/repositories/tournament-live-state/SupabaseTournamentLiveStateRepository.ts` — реализация (не вызывается production'ом, см. intro)
- `features/tournaments.ts` — только `getTournamentRebuyState`/`setTournamentPlayerRebuyState` (неиспользуемые до Phase 2)
- `lib/db/migrations/0013_green_warbound.sql` + `lib/db/migrations/meta/0013_snapshot.json` — **применены** к production Postgres
- `sql/tournament_rebuy_state.sql` — manual-apply файл для Supabase, **сознательно не применён**
- `lib/repositories/tournament-live-state/__tests__/upsert-rebuy-state-postgres.integration.test.ts` (gated за `REBUY_STATE_POSTGRES_TEST_URL`)

**Phase 2** (этот коммит — ещё не закоммичен на момент отчёта):

Изменены:
- `features/tournaments.ts` — оставшаяся часть: нормализация в `getArrivedPlayersForIntegration`, расширенный `IntegrationPlayer`
- `app/api/admin/tournaments/[id]/pull-sheet/route.ts` — флаг `commit`
- `app/api/admin/tournaments/[id]/complete-free/route.ts` — reconciliation
- `app/admin/results/[id]/page.tsx` — onBlur-commit, live-overlay при загрузке/pull, `commit:true` в теле pull-запроса
- `features/__tests__/tournament-attendance.test.ts` — новые моки + тесты нормализации
- `app/api/integrations/v1/tournaments/[id]/players/__tests__/route.test.ts` — обновлённые ожидания под новые поля

Новые:
- `lib/rebuy-write-queue.ts` + `lib/__tests__/rebuy-write-queue.test.ts`
- `app/api/admin/tournaments/[id]/rebuy-state/route.ts` + `__tests__/route.test.ts`
- `app/api/admin/tournaments/[id]/pull-sheet/__tests__/route.test.ts`
- `app/api/admin/tournaments/[id]/complete-free/__tests__/route.test.ts`

Никаких новых миграций/schema-изменений в Phase 2 — `0013` уже покрывает всё, что нужно рантайму.

## 8. Результаты проверки

```
npx tsc --noEmit -p tsconfig.json     → 0 ошибок
npm run lint                           → 0 ошибок (19 pre-existing warnings в нетронутых файлах)
npm run build (next build)             → успешно, включая новый /api/admin/tournaments/[id]/rebuy-state
npx vitest run                         → 412 passed, 3 failed (pre-existing, не связаны — подтверждено
                                          сравнением с чистым baseline через git stash), 20 skipped
                                          (gated real-Postgres тесты, включая новый)
```

Новые/изменённые тестовые файлы отдельно: **54 passed, 6 skipped** (0 failed).

3 pre-existing падения (`lib/__tests__/telegram.test.ts`, `lib/__tests__/achievement-display.test.ts`,
`features/__tests__/waitlist.test.ts` + 2 других suite из-за отсутствующего `NEXT_PUBLIC_SUPABASE_URL`
в этом окружении) воспроизводятся один-в-один на чистом `git stash` baseline — не вызваны этой
работой.

Real-Postgres интеграционные тесты (включая новый `upsert-rebuy-state-postgres.integration.test.ts`)
пропущены — в этом окружении не настроена тестовая БД (`ATTENDANCE_POSTGRES_TEST_URL`/
`REBUY_STATE_POSTGRES_TEST_URL` не заданы), это ожидаемо и соответствует существующему паттерну
gated-тестов в проекте.

## 9. Что НЕ делалось (по явному ограничению задачи)

- Poker Clock не тронут.
- Phase 2 (этот коммит) не закоммичен/не запушен/не задеплоен на момент отчёта — только Phase 1.
- Supabase-SQL сознательно не применялся (Vercel/Supabase больше не production backend) — не
  недоделанность, а решение по итогам cutover.
- `tournament_live_entries` (paid/cash) не менялся.
- `eliminated`/GS "Выбыл"-парсинг не добавлялся.
- Race в eliminated, агрегатный rebuy-баг в `rating-v2.ts`, remote completion Poker Clock, bounty,
  free re-entry — не трогались, остаются техдолгом (см. также риски в read-only investigation).

---

# Investigation: «Завершить позднюю регистрацию» (Mystery Bounty)

Read-only, без изменений — по требованию задачи.

## Где находится и что вызывает

- Кнопка: `handleCloseLateRegistration` в
  [app/admin/results/[id]/page.tsx](../app/admin/results/[id]/page.tsx) — видна только для
  `tournament_type === "mystery_bounty"` и только пока `mysteryBountySnapshot === null`.
- API: `POST /api/admin/tournaments/[id]/mystery-bounty/close-late-registration`
  ([route.ts](../app/api/admin/tournaments/[id]/mystery-bounty/close-late-registration/route.ts))
  → `closeMysteryBountyLateRegistration(tournamentId, rows)` в
  [features/mystery-bounty.ts](../features/mystery-bounty.ts).

## Что записывается в БД

Ровно **одна строка** в `tournament_mystery_bounty` (PK = `tournament_id` — максимум одна строка
на турнир, [lib/db/schema/tournamentMysteryBounty.ts](../lib/db/schema/tournamentMysteryBounty.ts)):
`players_count`, `total_entries_count`, `rebuys_count` (derived-диагностика, не участвует в
формуле пула), `addons_count`, `active_players_count`, `mystery_pool`, `envelope_count` и номиналы
конвертов (`small/medium/jackpot`), `closed_at` (`defaultNow()`).

**Отдельного flag/status-столбца «closed» нет** — само наличие строки в
`tournament_mystery_bounty` и есть флаг: `mapRow()` всегда возвращает
`late_registration_status: "closed"`, потому что строка физически не существует, пока Late
Registration открыта (`getMysteryBountySnapshot` возвращает `null`).

## Что считается в этот момент

**Только** пул Mystery Bounty и диагностические агрегаты (`players_count`/`total_entries_count`/
`rebuys_count`/`addons_count`/`active_players_count`). **Rating points игроков НЕ считаются** —
`closeMysteryBountyLateRegistration` ни разу не вызывает `calculateRatingPointsForTournament`.
Рейтинговые очки по-прежнему считаются только один раз, при `/complete-free`, как и для любого
другого типа турнира. Это важно для будущего продуктового плана: сегодня «Завершить позднюю
регистрацию» **не** даёт готового "рейтинг/призовой пул очков" в смысле per-player rating —
только денежный (очковый) пул конвертов Mystery Bounty и число мест/активных игроков.

## Почему только для Mystery Bounty

Потому что это единственный тип турнира с физическим шагом подготовки (конверты нужно
подготовить и распечатать заранее, с зафиксированными номиналами) — нужна твёрдая точка
"количество игроков и входов зафиксировано, дальше не меняется просчёт пула". У остальных типов
(classic/phoenix/deep_stack/bounty/boss_bounty/win_the_button) рейтинг считается непрерывно на
клиенте (live-превью в `ratingEngineV2Summary`) и финально один раз при completion — нет
аналогичного физического шага, требующего промежуточной заморозки.

## Идемпотентность и повторный клик

**Не идемпотентна.** `closeMysteryBountyLateRegistration` явно проверяет
`existing = await tournamentMysteryBountyRepository.findByTournamentId(...)` и бросает ошибку
`"Late Registration уже закрыта для этого турнира. Используйте «Пересчитать Mystery Bounty»."`,
если строка уже есть. Повторный клик на ту же кнопку — гарантированная ошибка 400, не тихий no-op
и не перезапись. Изменить уже закрытый снапшот можно только через отдельный
`recalculateMysteryBounty` — и то лишь пока `alreadyAwarded` (сумма выданных Bounty Points по
игрокам) равна нулю; как только конверт вскрыт хотя бы одному игроку, пересчёт заблокирован
("Пересчёт запрещён: у игроков уже есть выданные Mystery Bounty очки").

## Что происходит при изменении arrived/rebuy/addon ПОСЛЕ закрытия

Ничего не пересчитывается автоматически. Замороженные `players_count`/`total_entries_count`/
`mystery_pool` в `tournament_mystery_bounty` могут разойтись с текущим состоянием ростера, если
админ поменяет Re-buy/Add-on/Пришёл после закрытия и не нажмёт «Пересчитать» (которое, опять же,
заблокировано после первого вскрытого конверта). Это существующий, известный источник дрейфа —
не новый, не вызванный текущей работой; ровно тот компромисс, который явно допускает продуктовая
модель Mystery Bounty (заморозка ради физической подготовки конвертов важнее гибкости).

## Хороший ли это момент для фиксации состава турнира

Частично. Это единственный существующий в коде пример «зафиксировать агрегаты турнира до
completion» — концептуально близко к тому, что нужно для будущего generic "late registration
closed" сигнала для Poker Clock. Но:
- Сегодня это специфично под Mystery Bounty (конкретные envelope-поля в схеме, не переиспользуемые
  для других типов).
- Не считает rating points — генерализация "Poker Clock получит рассчитанный рейтинг/призовой
  пул" потребует **новой** логики, не просто снятия ограничения `tournament_type === "mystery_bounty"`
  с существующей функции.
- Не идемпотентна по продуктовому дизайну (специально) — генерализованная версия должна была бы
  решить, нужна ли эта же жёсткость для типов без физического шага подготовки, где, вероятно,
  более уместен idempotent "upsert" момент, а не one-shot "insert or 400".

## Рекомендация по генерализации (не реализовывать сейчас)

Извлечь общий, не специфичный для Mystery Bounty концепт "late registration closed":
- Либо `late_registration_closed_at timestamptz` на самой `tournaments` (простой флаг для любого
  free-турнира), либо отдельная небольшая таблица `tournament_late_registration` (per-tournament,
  как `tournament_mystery_bounty`, но без envelope-специфичных столбцов).
- `tournament_mystery_bounty` остаётся Mystery-Bounty-специфичным **расширением** этого общего
  концепта (как `boss_knockouts` — надстройка над `results`, а не параллельный механизм) —
  общие поля (`players_count`, `total_entries_count`, `addons_count`, `active_players_count`)
  переезжают в generic-таблицу/на `tournaments`, envelope-поля остаются только в
  `tournament_mystery_bounty`.
- Для generic-версии стоит отдельно решить (не решать явочным порядком копированием текущей
  not-idempotent семантики): нужна ли твёрдая one-shot заморозка для всех типов, или достаточно
  простого upsert-флага "closed_at", который можно двигать вперёд, но не назад.
- Rating points при таком generic-close по-прежнему разумно **не** считать заранее — оставить
  единственным источником `/complete-free`, чтобы не завести вторую независимую точку расчёта
  рейтинга (тот же принцип, что уже защищает нынешний Mystery Bounty flow, где расчёт рейтинга
  подчёркнуто отделён от close-late-registration).

Ничего из этого не реализовано в рамках текущей задачи — только зафиксировано.
