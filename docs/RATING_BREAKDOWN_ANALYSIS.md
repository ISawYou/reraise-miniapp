# Rating Breakdown — анализ и migration plan

**Дата:** 2026-08-18
**Статус:** schema migration + calculator breakdown + write-path threading реализованы. Production dry-run выполнен успешно против реального VPS Postgres (594/594 rows, 0 аномалий) — см. раздел 6. Реальная запись (backfill `--apply`) НЕ выполнялась, ждёт отдельного явного подтверждения.

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

- Production dry-run выполнен и чист (594/594, 0 аномалий, раздел 6) —
  реальный backfill (`--apply`) технически безопасен, но **не запущен**:
  ждёт отдельного явного подтверждения пользователя, как и было условлено.
- После подтверждения — отдельный, явно запрашиваемый write-путь (не эти
  read-only скрипты) для реальной записи backfill-значений, с повторной
  проверкой инвариантов перед каждым UPDATE и обновлением только строк,
  прошедших проверку.
- Только после успешного backfill и post-check — миграция, переводящая 5
  новых колонок в `NOT NULL` (сейчас они nullable намеренно).
- `ITMEvaluator`/сбор `itm_finishes` — сознательно не реализованы в этом
  PR, ждут доказанной корректности Rating Breakdown (доказана в разделе 6,
  но реализация ITMEvaluator — отдельная, ещё не запрошенная задача).
