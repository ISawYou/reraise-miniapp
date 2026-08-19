# Rating Breakdown — анализ и migration plan

**Дата:** 2026-08-18
**Статус:** schema migration 0006, application-код и **historical backfill — все выполнены в production**. Commit `c3ae484` (ветка `feature/rating-breakdown`, смёржена в `origin/main` fast-forward'ом от `e158887`) задеплоен и подтверждён живым. Все 594 historical rows теперь имеют заполненный Rating Breakdown; `rating_points` не изменился (checksum до/после backfill идентичен: `sum_rating_points = 17619` в обоих случаях). См. раздел 9.

Важно: этот коммит содержит ТОЛЬКО Rating Breakdown — собран поверх `main` (не поверх `feature/achievements`), чтобы не задеплоить в production ещё не готовую Achievement System (новый Evaluator engine, каталог достижений и т.д.), которая по-прежнему живёт исключительно в `feature/achievements` и намеренно не тронута. См. раздел 8 (ниже) для деталей деплоя.

**Важное уточнение архитектуры (актуализировано в этом раунде):** продакшен этого приложения — VPS + Docker + self-hosted PostgreSQL (`DATABASE_PROVIDER=postgres`). Supabase/Vercel в продакшене больше не используются вообще (более ранняя версия этого документа ошибочно опиралась на переходное состояние из `docs/architecture.md`, где Vercel-деплой ещё оставался на Supabase — по прямому уточнению пользователя это больше не так). Из-за этого исходный dry-run скрипт (`scripts/backfill-rating-breakdown.mjs`, на `@supabase/supabase-js`) физически не может подключиться к продакшену — ему не к чему подключаться. Для реального прогона был написан новый, Postgres-native скрипт — см. раздел 6.

Документ фиксирует: (1) как `results.rating_points` раскладывается на компоненты в актуальном Rating Engine (legacy + v2), (2) почему историческую реконструкцию делает вычитание из уже замороженного `rating_points`, а не повторный вызов формулы, (3) результаты dry-run проверки.

---

## 1. Инвариант и откуда он берётся

```
rating_points === participation_points + knockout_points
  + boss_bounty_points + mystery_bounty_points + itm_points
```

Гарантируется по построению: `features/rating.ts::calculateRatingPoints` и
`features/rating-v2.ts::calculateRatingPointsV2` теперь возвращают breakdown
как побочный продукт **того же** вычисления, что строит `rating_points` —
`rating_points` буквально равен сумме пяти именованных промежуточных
переменных, не отдельно выведенному числу. На уровне БД инвариант
дополнительно закреплён CHECK-constraint'ом
`results_rating_points_breakdown_check` (см. `lib/db/migrations/0006_rating_breakdown.sql`).

## 2. Компоненты — определения и источник истины

| Компонент | Формула (обе версии одинаковы по структуре) | Источник |
|---|---|---|
| `participation_points` | `2`, если `arrived`; иначе `0` | безусловное слагаемое в обеих формулах |
| `knockout_points` | `supportsTournamentKnockouts(type) ? knockouts × 5 : 0` | `results.knockouts` + `tournaments.tournament_type` |
| `boss_bounty_points` | `supportsTournamentBossKnockouts(type) ? boss_knockouts × 10 : 0` | `results.boss_knockouts` + `tournament_type` |
| `mystery_bounty_points` | как есть, уже существующее поле | `results.mystery_bounty_points` (не новая колонка) |
| `itm_points` | v1: `place ≤ ratingZoneSize ? round(base×fieldCoefficient×tournamentMultiplier) : 0`. v2: то же с `volumeMultiplier`/`placementMultiplier`/без множителя (mystery), плюс Phoenix Guarantee top-up (см. ниже) | `place`, поле турнира на момент завершения |

`itm_points > 0` однозначно означает попадание в рейтинговую зону — доказано: минимальное ненулевое значение `itm_points` в обеих формулах ≥4 (`round(5×0.7×1)`), т.е. никогда не может случайно округлиться в 0.

### Phoenix Rating Guarantee

Зафиксированное продуктовое решение: Guarantee — не отдельный вид очков, а
механизм, определяющий итоговый размер пула рейтинговой зоны. Реализовано
буквально: в `calculateRatingPointsV2`, когда guarantee срабатывает,
`topUp`-доля (распределяется только между призовыми местами методом Largest
Remainder) прибавляется **к `itm_points`**, не в отдельное поле.
`phoenix_guarantee_points` не существует ни в коде, ни в схеме.

## 3. Единый источник расчёта

`features/rating.ts::calculateRatingPoints` (legacy) и
`features/rating-v2.ts::calculateRatingPointsV2` (v2) — единственные места
вычисления, каждая формула расширена breakdown-полями аддитивно, без
изменения арифметики, дающей `rating_points`
(`features/__tests__/rating.test.ts`/`rating-v2.test.ts` — все существующие
golden-values тесты проходят без изменений, плюс
`features/__tests__/rating-breakdown.test.ts` — новый, целевой набор).
`calculateRatingPointsForTournament` (единый диспетчер legacy/v2) не
менялся — breakdown уже течёт через него, так как оба ветвления просто
возвращают результат расширенных функций.

## 4. Write-paths

Проверено повторно после мерджа `main`: ровно два пути пишут в `results` —
`completeTournamentFromLiveEntries` (live/paid) и `saveTournamentResults`
(вызывается из `app/api/admin/tournaments/[id]/complete-free/route.ts`,
free-режим и Google Sheets pull). Оба уже вызывают
`calculateRatingPointsForTournament` до записи — оба теперь прокидывают
breakdown-поля из результата этого вызова в payload `insertMany`. Третьего
пути в `results` нет (повторно подтверждено grep по всему репо).
Редактирование уже завершённого турнира — это повторный вызов тех же двух
функций (тот же delete+insert), поэтому автоматически получает свежий
breakdown при каждом пересохранении.

## 5. Google Sheets — не изменён

`export-sheet`/`pull-sheet`/`live-sync` не читают и не пишут
breakdown-компоненты — только сырые входные данные (place, knockouts,
boss_knockouts, mystery_bounty_points, rebuys, addons, arrived), как и до
этой задачи. `rating_points` в самой таблице — write-only отображение,
никогда не парсится обратно. Формат Sheet не менялся.

## 6. Историческая реконструкция (backfill)

### Почему не повторный вызов формулы

`fieldSize`/`entries`/`addons` для завершённых до Rating Engine v2
турниров нигде не сохранены (addons — честный placeholder `0`, не
исторический факт; `results` может включать строки неявившихся игроков, so
`COUNT(results)` ≠ исходный `fieldSize`). Повторный вызов
`calculateRatingPoints`/`calculateRatingPointsV2` с реконструированными
входами создал бы вторую, потенциально расходящуюся реализацию — прямо
запрещено условием задачи.

### Подход: вычитание из уже замороженного `rating_points`

```
arrived              = rating_points > 0
participation_points = arrived ? 2 : 0
knockout_points      = arrived && hasKnockouts(type) ? knockouts × 5 : 0
boss_bounty_points   = arrived && hasBossKnockouts(type) ? boss_knockouts × 10 : 0
mystery_bounty_points = arrived ? results.mystery_bounty_points : 0
itm_points            = arrived
  ? rating_points − participation_points − knockout_points − boss_bounty_points − mystery_bounty_points
  : 0
```

Использует только уже персистентные данные: `rating_points`, `knockouts`,
`boss_knockouts`, `mystery_bounty_points`, `tournaments.tournament_type`.
Никакого fieldSize/entries/addons не требуется.

### Повторное доказательство инварианта `arrived ⟺ rating_points > 0`

Перепроверено против **актуального** кода (не по памяти прошлого аудита),
для **обеих** версий формулы, включая Phoenix Guarantee:

- **Legacy** (`calculateRatingPoints`): `!arrived` → `return { rating_points: 0 }` безусловно, до любых других слагаемых. `arrived` → `rating_points = placePoints + knockoutPoints + bossKnockoutPoints + 2 + mysteryPoints`, где `+2` безусловна, а все остальные слагаемые ≥0 (при условии, что `knockouts`/`boss_knockouts`/`mystery_bounty_points` не отрицательны — обеспечено доменом ввода и тем, что `mystery_bounty_points` проходит `assertPositiveInteger` при формировании). Минимум для пришедшего игрока — ровно 2 → `rating_points > 0` всегда.
- **v2** (`calculateRatingPointsV2`): та же структура — `!arrived` → `natural: 0` безусловно (Phoenix top-up тоже не касается: `distributePhoenixTopUp` вызывается только для `players.filter(p => p.arrived && p.place <= ratingZoneSize)`). `arrived` → `natural = placement + knockoutPoints + bossKnockoutPoints + 2 + mysteryPoints`, минимум 2; Phoenix `topUp ≥ 0` только добавляет, никогда не уменьшает. → `rating_points > 0` всегда для пришедшего, при любом сценарии Guarantee.
- **`rating_formula_version`** ограничен CHECK-constraint'ом `IN ('legacy', 'v2')` на уровне БД — третьего значения существовать не может.

Ни одного легального сценария `arrived === true && rating_points === 0` или
`arrived === false && rating_points > 0` не найдено ни в одной из двух
формул, при разумном допущении о неотрицательности входных данных
(подкреплено CHECK `results_rating_points_check: rating_points >= 0`,
действующим с самой первой миграции — строка с отрицательным
`rating_points` физически не могла быть записана).

### Инструменты

Единая логика реконструкции (`reconstructRow`/`summarize`/`printReport`)
вынесена в `scripts/lib/rating-breakdown-reconstruct.mjs` — используется
БЕЗ изменений обоими CLI-скриптами, чтобы не завести два независимо
поддерживаемых варианта алгоритма (тот же принцип "единого калькулятора",
что и у Rating Engine, применённый к инструментарию):

- `scripts/backfill-rating-breakdown.mjs` — Supabase-вариант
  (`@supabase/supabase-js`), полезен только для локальной/dev
  Supabase-базы. **Продакшена не видит** — продакшен на Postgres, не на
  Supabase (см. уточнение архитектуры в начале документа).
- `scripts/backfill-rating-breakdown-postgres.mjs` — production-вариант,
  подключается напрямую через `drizzle-orm/postgres-js` по `DATABASE_URL`,
  тем же способом, что `lib/db/client.ts` в рантайме. Таблицы `results`/
  `tournaments` передекларированы локально (только нужные колонки), по
  тому же паттерну, что и `scripts/backfill-postgres.mjs`. Полностью
  read-only, `--apply` — намеренная заглушка с объяснением.

### Production dry-run: результат (реальный прогон, не smoke-test)

Выполнен в этом раунде против настоящей продакшен-базы на VPS
(`poker-clock-vps`, контейнер `poker-clock-db`, тот же Postgres, которым
пользуется живой `re-raise` контейнер). Способ запуска: одноразовый
`docker run` из уже существующего образа `re-raise-migrator:latest`
(готовый Node + полный `node_modules`, включая `drizzle-orm`/`postgres`),
подключённый к сети живого `re-raise` контейнера
(`--network container:re-raise`) и запущенный с `--env-file /opt/reraise/.env`
— `DATABASE_URL` читается Docker'ом напрямую с диска VPS и ни разу не
проходит через эту сессию/лог. Скрипт скопирован во временную директорию на
VPS и смонтирован только на время одного `docker run`; после прогона
временные файлы с VPS удалены (`rm -rf`), сам образ/контейнер ничего не
меняли — вызывался только SELECT.

```
total results rows checked:  594
total tournaments:            42
legacy formula rows:          516
v2 formula rows:              78
successfully reconstructed:   594
failed / needs manual review: 0
  - mismatched totals:        0
  - negative component(s):    0
  - unknown tournament_type:  0
  - unknown formula version:  0
  - missing tournament:       0
```

**100% успешная реконструкция на реальных продакшен-данных: 594 из 594
строк, 0 аномалий любого рода.** Инвариант `rating_points = participation +
knockout + boss_bounty + mystery_bounty + itm` подтверждён по каждой строке
без единого расхождения, включая обе версии формулы (516 legacy + 78 v2) —
т.е. смешанный реальный датасет, а не только гипотетические юнит-тесты.
Более ранний прогон против локальной/dev Supabase-базы (232 строки, тоже 0
аномалий) остаётся дополнительным подтверждением алгоритма на другом
наборе данных, но именно этот прогон — то, что нужно было для решения о
безопасности реального backfill.

### Как повторно прогнать production dry-run

```bash
# С машины разработчика — скопировать скрипт + shared lib на VPS:
scp scripts/backfill-rating-breakdown-postgres.mjs <vps>:/tmp/rating-breakdown-dryrun/
scp scripts/lib/rating-breakdown-reconstruct.mjs   <vps>:/tmp/rating-breakdown-dryrun/lib/

# На VPS — одноразовый read-only контейнер + очистка:
ssh <vps> '
  docker run --rm \
    --network container:re-raise \
    -v /tmp/rating-breakdown-dryrun:/app/scripts:ro \
    --env-file /opt/reraise/.env \
    re-raise-migrator:latest \
    node scripts/backfill-rating-breakdown-postgres.mjs --all
  rm -rf /tmp/rating-breakdown-dryrun
'
```

`--network container:re-raise` — разделяет сетевой namespace с уже
работающим прод-контейнером `re-raise`, поэтому резолвинг хоста БД
(`poker-clock-db`) гарантированно совпадает с тем, что использует реальное
приложение, без необходимости знать имя Docker-сети явно.
`--env-file /opt/reraise/.env` — тот же файл, из которого `docker-compose.yml`
подставляет `DATABASE_URL` для самого `re-raise`; секрет не покидает VPS и
не проходит через отдельный `cat`/вывод. Скрипт только читает, ничего не
пишет; печатает агрегированный отчёт + детали по каждой проблемной строке
(result id, tournament id, player id, rating_formula_version, tournament
type, existing rating_points, reconstructed components, причина). `--apply`
намеренно заглушка.

## 7. Что дальше (не реализовано на этом этапе)

- Реальный backfill (`--apply`) технически безопасен (доказано dry-run'ами
  до и после деплоя), но **не запущен**: ждёт отдельного явного
  подтверждения пользователя, как и было условлено.
- После подтверждения — тот же `--apply` (preflight, единая транзакция,
  post-write валидация до COMMIT — уже реализовано и закоммичено), запуск
  тем же способом, что и dry-run (раздел 6), только без флага dry-run.
- Только после успешного backfill и post-check — миграция, переводящая 5
  новых колонок в `NOT NULL` (сейчас они nullable намеренно).
- `ITMEvaluator`/сбор `itm_finishes` — сознательно не реализованы в этом
  PR, ждут доказанной корректности Rating Breakdown (доказана в разделе 6,
  но реализация ITMEvaluator — отдельная, ещё не запрошенная задача).

## 8. Деплой schema + application code в production

Выполнено в этом раунде, по отдельному явному подтверждению пользователя.

### Коммит

`c3ae484` на новой ветке `feature/rating-breakdown`, созданной ОТ `main`
(коммит `e158887`), а не от `feature/achievements`. Причина: рабочая копия
изменений жила поверх `feature/achievements`, которая уже содержит
закоммиченную, ещё не готовую к production Achievement System (новый
Evaluator engine, каталог достижений и т.д. — по решению пользователя из
более раннего этапа: "продолжим разработку достижений в отдельной ветке...
когда закончим, сделаем мердж"). Деплой всей `feature/achievements`
доставил бы Achievement System в прод как побочный эффект — нарушение
явного требования "не менять/не деплоить Achievement System" в этом
раунде. Вместо этого: patch только из 17 Rating-Breakdown-файлов
(`git diff HEAD` на уже закоммиченном состоянии `feature/achievements`)
применён поверх свежего worktree на `main` (`git apply`, оба общих файла —
`ResultRepository.ts`/`PostgresResultRepository.ts` — проверены на
неперекрывающиеся hunks с уже закоммиченным на achievements-ветке
`findKnockoutsByPlayerId`), проверен (`tsc`/`lint`/`vitest` — идентичный
существовавшему baseline, `drizzle-kit generate` → "No schema changes"),
закоммичен, запушен fast-forward'ом прямо в `origin/main`
(`e158887..c3ae484`). Локальная `feature/achievements` при этом не
трогалась — её uncommitted diff остаётся как был, доступен на будущее для
отдельного мерджа.

### Порядок применения (сознательно migration → dry-run confirm → app code)

GitHub Actions (`.github/workflows/deploy.yml`) триггерится на любой push в
`main` и автоматически пересобирает/передеплоивает контейнер `app`, но
**никогда не запускает миграции** — только `docker compose build/up` для
`app`. Значит push в `main` неизбежно означает почти немедленный передеплой
кода, который уже ожидает 5 новых колонок в каждом INSERT. Чтобы не
получить окно, где новый код уже живой, а колонок в БД ещё нет (упавший
INSERT при завершении любого турнира в этом окне), миграция 0006 применена
**до** push: смонтирована поверх уже существующего (пересобирать не
пришлось — `scripts/migrate.mjs` не менялся) образа `re-raise-migrator:latest`
одноразовым `docker run` (`--network container:re-raise`, `--env-file
/opt/reraise/.env`, `-v .../lib/db/migrations:/app/lib/db/migrations:ro`),
результат — `Migrations applied successfully`, БЕЗ `git pull`/пересборки
`app`. Только после проверки схемы (ниже) выполнен push в `main`.

### Schema post-check (сразу после migration, до push кода)

```
results columns: ..., arrived, participation_points, knockout_points, boss_bounty_points, itm_points
migrations applied: 7 -> ids: 1,2,3,4,5,6,7
counts: {
  "total_results": 594,
  "total_tournaments": 42,
  "all_breakdown_null": 594,
  "any_breakdown_populated": 0,
  "negative_rating_points": 0
}
rating_points checksum: {"sum_rating_points":"17619","n":594}
```

Все 5 колонок существуют; миграция 0006 применена ровно один раз (7-я
запись в `drizzle.__drizzle_migrations`); 594/42 — без изменений;
breakdown всех 594 строк остался полностью NULL (миграция ничего не
заполнила); 0 отрицательных `rating_points`. `ALTER TABLE ... ADD COLUMN`
без `DEFAULT` — чисто метаданная операция в Postgres, физически не может
переписать существующие строки, так что дополнительный "before/after"
diff по `rating_points` избыточен: DDL самой миграции (раздел, где
приведён текст 0006) не содержит ни одного `UPDATE`.

### Application deploy

`git push origin feature/rating-breakdown:main` → GitHub Actions `deploy.yml`
подхватил `main`, прогнал `checks` (lint + tsc на раннере), затем на VPS:
`git pull --ff-only`, `docker compose build app`, `docker compose up -d
--no-deps app`, health-poll, smoke-test `re-raise.ru`. Подтверждено
независимо (не только по логам workflow, к которому не было доступа из
этой сессии из-за сетевых ограничений на `gh`/GitHub API): `git rev-parse
HEAD` на VPS = `c3ae484`, `docker inspect re-raise` — новый image ID,
`CreatedAt` совпадает с моментом деплоя, `STATUS=running HEALTH=healthy`,
`GET https://re-raise.ru/api/health` → `{"ok":true}`, `/api/leaderboard` →
200. `poker-clock-db` (общий Postgres) и остальные контейнеры (`poker-app`,
`poker-clock`, `spb-poker*`) деплоем не затронуты — workflow трогает только
сервис `app`.

### Post-deploy dry-run (повторный, после и schema, и app-кода)

```
total results rows checked:  594
total tournaments:            42
legacy formula rows:          516
v2 formula rows:              78
successfully reconstructed:   594
failed / needs manual review: 0
```

Идентично pre-deploy прогону — за время деплоя новых турниров не
завершилось, аномалий не появилось.

## 9. Historical backfill (реальный `--apply`, выполнено)

Выполнен по отдельному явному подтверждению пользователя, тем же
`scripts/backfill-rating-breakdown-postgres.mjs`, той же
reconstruction-логикой из `scripts/lib/rating-breakdown-reconstruct.mjs` —
без нового/отдельного write-алгоритма. Запущен как одноразовый `docker run`
через уже существующий на VPS `re-raise-migrator:latest`, со скриптами,
смонтированными напрямую из `/opt/reraise/scripts` (уже часть
задеплоенного `c3ae484`, копировать отдельно не понадобилось).

```
node scripts/backfill-rating-breakdown-postgres.mjs --apply --all
```

Preflight (полная read-only реконструкция) внутри самого `--apply`
повторил проверку по всем 594 строкам заново и совпал с ожидаемым
baseline — только после этого начались UPDATE. Всё выполнено в ОДНОЙ
транзакции: 594 UPDATE (только `arrived`/`participation_points`/
`knockout_points`/`boss_bounty_points`/`itm_points` — `rating_points` и
`mystery_bounty_points` нигде не установлены в коде), post-write валидация
до COMMIT — 0 NULL, 0 нарушений инварианта, 0 отрицательных компонентов →
COMMIT.

### Независимая post-COMMIT проверка (отдельный запрос, отдельное соединение)

```
до backfill:  total_results=594 total_tournaments=42 sum_rating_points=17619 null_breakdown_rows=594
после backfill: total_results=594 total_tournaments=42 sum_rating_points=17619 null_breakdown_rows=0
               invariant_violations=0 negative_components=0
               arrived_true=594 arrived_false=0
               itm_positive=197 itm_zero=397
legacy: total=516 violations=0
v2:     total=78  violations=0
```

`sum_rating_points` идентичен до и после (`17619` = `17619`) — прямое
доказательство, что ни одна историческая `rating_points` не изменилась.
`total_results`/`total_tournaments` тоже не изменились (594/42) — во время
backfill новых турниров не завершалось. `arrived_false = 0` по всему
датасету — реальная особенность этих 594 строк (в `results` есть записи
только по игрокам, которые фактически участвовали; неявившиеся не создают
строку `results` в этой модели данных), а не ошибка реконструкции.
