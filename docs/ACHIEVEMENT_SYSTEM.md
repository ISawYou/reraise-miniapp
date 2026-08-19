# Achievement System — архитектура

Этот документ описывает архитектуру движка достижений RERAISE. Актуализирован
после этапа Final Tables cleanup / Terminator-Boss Hunter-Headhunter-
Tournament Streak-Marco Reus / Manual admin moderation / tier metadata — см.
разделы ниже для деталей каждого направления.

## Архитектура

```
Achievement Catalog          config/achievements.ts
        │                    (ACHIEVEMENTS_CATALOG — единственный источник истины)
        ▼
Player Metrics                features/achievements.ts::getPlayerAchievementMetrics
        │                     (ResultRepository/TournamentRepository → PlayerAchievementMetrics)
        ▼
Achievement Engine             lib/achievement-engine/engine.ts::runAchievementEngine
        │                     (definitions + metrics → AchievementProgress[], без I/O)
        ▼
Evaluator Registry              lib/achievement-engine/evaluators/registry.ts::evaluatorRegistry
        │                     (по definition находит подходящий evaluator)
        ▼
Evaluators                      lib/achievement-engine/evaluators/*.ts
        │                     (см. полный список ниже)
        ▼
Achievement Progress            AchievementProgress[] = { code, currentValue, completed }
        │
        ▼
Repository                      lib/repositories/achievement/AchievementRepository.ts
        │                     (achievementRepository.upsertMany — единственная точка записи)
        ▼
Database                        player_achievements (Postgres, без изменений схемы)
        │
        ▼
API                              app/api/players/[id]/achievements/route.ts (GET),
                                 app/api/admin/achievements/manual/route.ts (manual grant/revoke),
                                 app/api/admin/achievements/resync/route.ts (dry-run / apply resync),
                                 app/api/admin/seasons/route.ts (list),
                                 app/api/admin/seasons/[id]/close/route.ts (season finalization → Number One)
        │
        ▼
UI                               app/players/[id]/achievements/page.tsx,
                                 app/players/[id]/page.tsx, app/page.tsx,
                                 app/admin/achievements/page.tsx (manual moderation + season finalization)
```

## Что делает каждый слой

**Achievement Catalog** (`config/achievements.ts`)
Единственный источник истины обо всех достижениях: id, code, name, description,
category, icon, type, source, metric, target, sortOrder + зарезервированные
tiers/reward/hidden. Ничего не вычисляет и не знает про Repository/БД/UI —
чистые данные плюс производные типы (`AchievementCode`, `AchievementType`,
`AchievementMetric`, `AchievementCategory`, `AchievementSource`,
`AchievementIconKey`).

**Player Metrics** (`features/achievements.ts::getPlayerAchievementMetrics`)
Единственное место, которое обращается к `ResultRepository` за сырыми данными
игрока и сводит их к `PlayerAchievementMetrics` (`Record<AchievementMetric,
number>`). Это единственный слой, который знает о Repository Layer со стороны
достижений — Engine и Evaluators о нём не знают.

**Achievement Engine** (`lib/achievement-engine/engine.ts`)
`runAchievementEngine(definitions, metrics): AchievementProgress[]`. Берёт
список определений + метрики игрока, для каждого определения находит
evaluator через реестр и вызывает его. Не делает I/O, не знает про
Repository/БД/API/UI. Не меняется при добавлении новой категории достижений —
меняется только реестр.

**Evaluator Registry** (`lib/achievement-engine/evaluators/registry.ts`)
`evaluatorRegistry` — маленький класс с `register()`/`resolve()`/`list()`.
Хранит упорядоченный список evaluator'ов и находит первый, чей `supports()`
подходит под определение. Добавление новой категории — это `.register(...)`
здесь, а не правка `engine.ts`.

**Evaluators** (`lib/achievement-engine/evaluators/*.ts`)
Каждый evaluator отвечает только за свою категорию:
- `PlayedEvaluator` — метрика `tournaments_played`.
- `WinsEvaluator` — метрика `tournaments_won`.
- `RatingEvaluator` — метрика `rating_points`.
- `ReferralEvaluator` — метрика `referrals`.
- `KnockoutsEvaluator` — метрика `knockouts` (обычные, не boss). Продуктовое
  название линейки — Terminator (10/50/100/250, display-tier Bronze/
  Silver/Gold/Platinum через `AchievementDefinition.tier`/`family`, без
  изменений в самом evaluator'е).
- `ITMEvaluator` — метрика `itm_finishes` = `results.itm_points > 0`
  (Rating Breakdown), см. `ResultRepository.countItmFinishesByPlayerId`.
- `BossKnockoutsEvaluator` — метрика `boss_knockouts` (Boss Hunter,
  5/25/50/100). Отдельный, не пересекающийся счётчик от `knockouts`.
- `HeadhunterEvaluator` — метрика `max_knockouts_single_tournament`.
  НЕ кумулятивная: максимум обычных knockouts за один турнир, не сумма.
- `TournamentStreakEvaluator` — метрика `max_tournament_streak`. Максимальная
  серия завершённых турниров клуба подряд с участием игрока (не календарные
  недели). См. `lib/tournament-streak.ts::computeMaxTournamentStreak`.
- `MarcoReusEvaluator` — метрика `bubble_count`. Сколько раз игрок занимал
  место сразу после рейтинговой зоны турнира (см. раздел «Marco Reus» ниже).
- `ManualEvaluator` — заглушка для `type: "manual"`, никогда не вызывается
  из `syncPlayerAchievements` (см. раздел «Manual achievements» ниже —
  выдача/снятие идёт отдельным путём, не через Engine).

Evaluator получает `(definition, metrics)` и возвращает `AchievementProgress`.
Не знает ничего о Repository, БД, API или UI.

**Achievement Progress** (`lib/achievement-engine/types.ts`)
`{ code, currentValue, completed }` — узкий, "неперсистентный" результат.
Прикрутить к нему `player_id`/`completed_at`/`updated_at` — задача вызывающего
кода (`features/achievements.ts`), а не движка.

**Repository** (`lib/repositories/achievement/AchievementRepository.ts`)
Единственная точка записи — `upsertMany`. Не изменялся ни на одном из трёх
этапов рефакторинга. Реализации (`Supabase`/`Postgres`) переключаются через
`DATABASE_PROVIDER`, как и раньше.

**Database** (`player_achievements`)
Без изменений: одна строка на `(player_id, achievement_code)`,
`achievement_code` — намеренно свободный текст (см. комментарий в
`lib/db/schema/achievements.ts`).

**API / UI**
`GET /api/players/[id]/achievements` отдаёт `AchievementSummary[]` как и
раньше. UI (`app/players/[id]/achievements/page.tsx`,
`app/players/[id]/page.tsx`, `app/page.tsx`) читает каталог напрямую
(`getAchievementsSorted()`, `ACHIEVEMENTS_CATALOG.length`) и иконки — через
`getAchievementIcon()` (`components/achievements/achievement-icons.tsx`).
Никогда не хранит копию названий/порогов/иконок.

## Как добавить новое достижение

Если новое достижение считается по уже существующей метрике
(`tournaments_played` / `tournaments_won` / `rating_points`):

1. Добавить объект в `ACHIEVEMENTS_CATALOG` (`config/achievements.ts`):
   `id`, `code`, `name`, `description`, `category` (использовать существующее
   значение `ACHIEVEMENT_CATEGORY.*` или добавить новое), `icon` (см. ниже),
   `type: ACHIEVEMENT_TYPE.AUTOMATIC`, `source: ACHIEVEMENT_SOURCE.RESULTS`,
   `metric` — один из `ACHIEVEMENT_METRIC.*`, `target`, `sortOrder`.
2. Если нужна новая иконка — добавить ключ в `ACHIEVEMENT_ICON`
   (`config/achievements.ts`) и сразу же компонент в
   `ACHIEVEMENT_ICON_REGISTRY` (`components/achievements/achievement-icons.tsx`) —
   без этого TypeScript не скомпилируется (реестр типизирован как
   `Record<AchievementIconKey, ReactNode>`, то есть исчерпывающий).
3. Больше ничего трогать не нужно: `AchievementCode` расширится сам
   (выводится из каталога), Engine/Evaluators/Repository/API/UI не меняются.

Если нужна новая метрика — см. следующий раздел.

## Как добавить новую категорию достижений

Категория в смысле "новая метрика игрока, а не просто новое поле `category`":

1. Добавить значение в `ACHIEVEMENT_METRIC` и, если нужно, в
   `ACHIEVEMENT_CATEGORY` (`config/achievements.ts`).
2. Посчитать эту метрику в `getPlayerAchievementMetrics`
   (`features/achievements.ts`) — обычно новый вызов Repository-метода плюс
   агрегация, как для `tournaments_played`/`tournaments_won`/`rating_points`.
3. Написать evaluator под эту метрику (см. следующий раздел) и
   зарегистрировать его.
4. Добавить достижения в каталог с этой метрикой (см. предыдущий раздел).

`runAchievementEngine` и `evaluatorRegistry`-класс не меняются ни на одном из
шагов.

## Как добавить новый evaluator

1. Создать файл `lib/achievement-engine/evaluators/<name>-evaluator.ts`,
   экспортирующий объект, реализующий `AchievementEvaluator`
   (`supports(definition)`, `evaluate(definition, metrics)`).
   - `supports` обычно проверяет `definition.type` и `definition.metric`
     через константы `ACHIEVEMENT_TYPE`/`ACHIEVEMENT_METRIC` — не через
     строковые литералы.
   - Если правило прогресса — "текущее значение метрики, capped на target" —
     можно переиспользовать `evaluateCappedMetric` из
     `lib/achievement-engine/evaluators/helpers.ts`. Если правило другое —
     писать свою логику внутри `evaluate`.
2. Зарегистрировать: `evaluatorRegistry.register(NewEvaluator)` в
   `lib/achievement-engine/evaluators/registry.ts`.
3. `engine.ts`, `types.ts` и остальные evaluator'ы не трогать.

## Manual Achievement — реализовано

Реализовано: `features/achievements.ts::grantManualAchievement` /
`revokeManualAchievement` / `getManualAchievementsForPlayer`, admin route
`app/api/admin/achievements/manual/route.ts` (GET/POST/DELETE, защищён
бланкетным admin-гейтом `middleware.ts` на `/api/admin/:path*`), минимальный
UI `app/admin/achievements/page.tsx`.

Ключевые решения:

1. `ManualEvaluator` по-прежнему зарегистрирован, но по-прежнему никогда не
   вызывается из `syncPlayerAchievements` (фильтр `type === AUTOMATIC` перед
   `runAchievementEngine`) — выдача/снятие идёт полностью в обход Engine.
2. Backend-проверка типа — не UI-only: `assertManualAchievement(code)`
   (`features/achievements.ts`) проверяет `getAchievementDefinition(code)
   .type === ACHIEVEMENT_TYPE.MANUAL` и бросает ошибку для automatic-кода —
   даже если запрос пришёл напрямую в API, минуя UI.
3. Grant/revoke — оба через уже существующий `achievementRepository
   .upsertMany`, НИКОГДА не hard-DELETE: automatic-достижения и так всегда
   имеют строку в `player_achievements` для каждого игрока (completed или
   нет) — manual теперь следует той же модели вместо особого случая.
   "Revoked" = `{ current_value: 0, completed_at: null }`, ровно как
   "ещё не выполнено" уже выглядит для automatic.
4. Идемпотентность: повторный grant сохраняет исходный `completed_at` (тот
   же паттерн preserve-on-conflict, что и `syncPlayerAchievements` — читает
   текущее значение через `findSummariesByPlayerId` перед upsert).
5. Никакой новой таблицы/схемы/audit-истории не добавлено — минимальный
   вариант первой версии, сознательно.

## Bronze/Silver/Gold/Platinum — реализовано (Вариант А)

Решение принято: каждый порог остаётся отдельным `achievement_code` (ровно
"Вариант А" из более ранней версии этого раздела) — `player_achievements`
не менялась, никакой DB-миграции ради tier не понадобилось.

Что добавлено в `AchievementDefinition` (`config/achievements.ts`):
`tier?: AchievementTierLevel` (`ACHIEVEMENT_TIER.BRONZE/SILVER/GOLD/
PLATINUM`) и `family?: AchievementFamily` (`ACHIEVEMENT_FAMILY.TERMINATOR/
BOSS_HUNTER/TOURNAMENT_STREAK`) — оба чисто описательные, как `category`;
ни Engine, ни evaluator'ы их не читают, только будущий UI. Три текущие
progression-семьи:

| Family | Codes (Bronze→Platinum) | Metric | Thresholds |
|---|---|---|---|
| `terminator` | `ten_knockouts` / `fifty_knockouts` / `hundred_knockouts` / `two_hundred_fifty_knockouts` | `knockouts` | 10 / 50 / 100 / 250 |
| `boss_hunter` | `five_boss_knockouts` / `twenty_five_boss_knockouts` / `fifty_boss_knockouts` / `hundred_boss_knockouts` | `boss_knockouts` | 5 / 25 / 50 / 100 |
| `tournament_streak` | `tournament_streak_bronze` / `_silver` / `_gold` / `_platinum` | `max_tournament_streak` | 3 / 5 / 10 / 20 |

Старый зарезервированный `AchievementTier` тип (`{ code, name, target }[]`
на `tiers?`) остался нетронутым и по-прежнему не используется — это другая,
более сложная модель (несколько порогов внутри ОДНОГО определения), не
понадобившаяся для текущего решения.

## Incremental implementation

Каталог (`config/achievements.ts`) и Achievement Engine
(`lib/achievement-engine/`) развиваются независимо друг от друга — это
осознанное свойство архитектуры, а не временная нестыковка:

- Каталог может содержать достижения, для метрики которых ещё не написан
  evaluator. На момент этого раздела — только `number_one` (см. раздел
  «Number One» ниже; остаётся `type: MANUAL` до появления надёжного сигнала
  "сезон завершён" в данных). Final Tables и `consecutive_weeks` (старая
  метрика на календарных неделях) удалены из каталога полностью, а не
  оставлены недоделанными — они больше не часть продукта. `knockouts`,
  `itm_finishes`, `referrals`, `boss_knockouts`,
  `max_knockouts_single_tournament`, `max_tournament_streak`, `bubble_count`
  — у всех есть evaluator и сборщик метрики.
- Это нормальное, ожидаемое состояние системы на промежуточных этапах
  разработки, а не баг и не забытый код.
- `runAchievementEngine` (`lib/achievement-engine/engine.ts`) при пересчёте
  просто пропускает те достижения, для которых `evaluatorRegistry.resolve()`
  не находит подходящий evaluator — молча, без предупреждений в консоль.
  Причина отсутствия логирования: как только каталог полностью заполнен, для
  каждого ещё не реализованного направления это ожидаемое поведение при
  каждом пересчёте, а не единичная аномалия — логировать его означало бы
  постоянный шум в проде вместо сигнала о реальной проблеме.
- Как только для достижения появляется evaluator (написан и
  зарегистрирован в `evaluatorRegistry`, см. «Как добавить новый
  evaluator» выше), оно автоматически начинает вычисляться при следующем
  вызове `syncPlayerAchievements` — никаких изменений в каталоге, Engine
  или реестре сверх добавления самого evaluator'а не требуется.
- Благодаря этому продуктовая часть (какие достижения существуют, их
  названия/пороги/иконки) и инженерная часть (как их считать) могут
  двигаться в разном темпе: каталог можно наполнить полностью заранее, а
  evaluator'ы — реализовывать по одному, в любом порядке, без блокировки
  друг другом.

## Marco Reus — реализовано

"Bubble": игрок занял место сразу за рейтинговой зоной конкретного турнира
(zone 1-6, place 7 → bubble). Изначально считался потенциально
невосстановимым исторически (та же проблема, что блокировала ITM до Rating
Breakdown — historical field size нигде не хранился напрямую) — но Rating
Breakdown уже решил именно эту проблему: `results.arrived` теперь
достоверно заполнен (backfill) для каждой строки, каждого турнира, обеих
версий формулы.

Формула переиспользуется, а не изобретается заново:
`ratingZoneSize = getExpectedPrizePlaces(fieldSize)` — та же функция
(`lib/tournament-helpers.ts`), которую уже вызывают и `features/rating.ts`,
и `features/rating-v2.ts`; `fieldSize` = `count(*) FROM results WHERE
tournament_id = X AND arrived = true` — определение, идентичное тому, что
использовалось при заморозке `rating_points`/`itm_points` для этой же
строки (оба вычисляются из одного и того же state за один вызов
`calculateRatingPoints[V2]`, так что field size не может разойтись с уже
сохранённым breakdown). Bubble = `place === ratingZoneSize + 1`.

`ResultRepository.findArrivedPlacementsByPlayerId` — единственное место,
которое читает `place`/field size (чистые данные, без бизнес-логики
внутри Repository); `getExpectedPrizePlaces` вызывается в
`features/achievements.ts`'s `getPlayerAchievementMetrics`, не в
Repository и не в evaluator'е. `MarcoReusEvaluator` — обычный
`evaluateCappedMetric` поверх метрики `bubble_count` (target 1).

## Три вида достижений: metric-based / event-based / manual

Ранее эта архитектура знала только про два измерения (`type`:
automatic/manual). После Number One появилось третье, отдельное измерение
— КАК начисляется прогресс, а не КОМУ разрешено видеть достижение:

| | Metric-based automatic | Event-based automatic | Manual |
|---|---|---|---|
| `type` | `AUTOMATIC` | `AUTOMATIC` | `MANUAL` |
| `metric` в каталоге | задан (`ACHIEVEMENT_METRIC.*`) | **отсутствует** | отсутствует |
| Кто вычисляет | `evaluatorRegistry` → конкретный evaluator | feature-level триггер события (например `closeSeason`) | admin вручную |
| Когда пересчитывается | на каждый `syncPlayerAchievements` | один раз, при наступлении события | никогда автоматически |
| Пример | `ten_itm`, Terminator, Boss Hunter, Headhunter, Marco Reus | `number_one` | `royal_flush` |
| Функция выдачи | `runAchievementEngine` → `upsertMany` | `grantEventAutomaticAchievement` (`features/achievements.ts`) | `grantManualAchievement`/`revokeManualAchievement` |

Ключевое отличие event-based от manual — event-based НЕЛЬЗЯ выдать/снять
через `app/api/admin/achievements/manual` (тот роут вызывает
`assertManualAchievement`, который требует `type === MANUAL` и бросает
ошибку для `number_one`); выдаётся только конкретным доменным событием
(`features/seasons.ts::closeSeason`), через отдельный, не-публичный путь
(`grantEventAutomaticAchievement`, не экспортируемый ни в один admin API
кроме season finalization).

Почему обычный resync никогда не трогает ни event-based, ни manual: оба
никогда не попадают в `progress[]`, который строит
`runAchievementEngine` — manual отфильтровывается ДО вызова Engine
(`type !== AUTOMATIC`), event-based ДОХОДИТ до Engine (он `type ===
AUTOMATIC`), но ни один evaluator не заявляет `supports()` для
определения без `metric` — значит `evaluatorRegistry.resolve()` возвращает
`undefined`, и `engine.ts` молча пропускает его (тот же путь, что раньше
пропускал ещё не реализованные метрики, см. «Incremental implementation»).
Оба варианта сходятся в одном: код никогда не появляется в payload
`upsertMany`, значит их строка в `player_achievements` никогда не
переписывается обычным resync'ом.

## Number One — реализовано (event-based automatic)

Условие продукта: игрок хотя бы раз ЗАВЕРШИЛ сезон как #1 рейтинга — не
"сейчас лидирует", а официальный, окончательный результат сезона,
зафиксированный один раз и навсегда.

### Season lifecycle — что фактически было и что добавлено

До этого этапа `SeasonRepository` имел ровно три метода: `findActive`,
`listAll`, `create` — **никакого способа изменить `is_active` через
приложение не существовало вообще**; сезоны управлялись исключительно вне
кода (see the repository's own header comment). "Сезон завершён" не имело
никакого технического определения в этом кодбейзе.

Добавлено:

- `SeasonRepository.setActive(seasonId, isActive)` — узкий, единственного
  назначения метод (обе реализации). Не миграция схемы — колонка
  `is_active` уже существовала, просто не было пути её поменять из
  приложения.
- `features/seasons.ts::closeSeason(seasonId)` — единственное место,
  которое теперь ставит `is_active = false`. Явное, разовое,
  admin-инициированное действие через `POST
  /api/admin/seasons/[id]/close` — НЕ cron, НЕ `Date.now() > end_date`, НЕ
  часть обычного achievement resync.
- Отклоняет повторное закрытие уже закрытого сезона (`is_active === false`
  → бросает ошибку, ничего не пересчитывает) — финализация одноразовая,
  не идемпотентно-перезапускаемая операция сама по себе (хотя
  единичный неудачный вызов безопасно повторить — см. ниже).

### Canonical leaderboard — переиспользован, не продублирован

`features/leaderboard.ts::getSeasonLeaderboard(seasonId)` — вынесенный
без изменений расчёт из `app/api/leaderboard/route.ts` (`SUM(rating_points)
GROUP BY player_id`, сортировка по убыванию). `app/api/leaderboard/route.ts`
теперь сам вызывает эту функцию вместо inline-подсчёта — один источник
истины для активного отображения И для финализации сезона. Формула самого
рейтинга (`features/rating.ts`/`features/rating-v2.ts`) не менялась.

### Tie handling — не придумано, обнаружено и обработано честно

Ни `PostgresResultRepository`, ни `SupabaseResultRepository`'s
`findWithPlayerBySeasonId` не имеют `ORDER BY`/`.order()` — то есть при
равном суммарном `rating_points` порядок между такими игроками
недетерминирован на уровне БД (JS-сортировка стабильна, но входной
порядок — нет). Для публичного leaderboard это не важно (косметика), но
для одноразового постоянного присвоения Number One недопустимо.

`closeSeason` проверяет именно и только 1-е место: если у `leaderboard[0]`
и `leaderboard[1]` совпадает `rating` — возвращает `{ status: "tie",
tiedPlayerIds, rating }`, НЕ выдаёт достижение, НЕ закрывает сезон. Ничья
ниже 1-го места (например, за 2-е) финализации не мешает. Никакого нового
tie-breaker'а не изобретено — вместо этого честно сообщается о
неоднозначности для решения человеком.

### Idempotency и permanence

`grantEventAutomaticAchievement` использует тот же `upsertGrantedAchievement`
helper, что и `grantManualAchievement` — читает существующий `completed_at`
перед `upsertMany` и сохраняет его, если он уже есть. Грант выполняется
ДО `setActive(seasonId, false)`: если `setActive` упадёт, сезон остаётся
активным и всю операцию безопасно повторить (пересчитает тот же leaderboard,
грант идемпотентен). Перманентность обеспечена архитектурно (см. раздел
выше про event-based) — не специальным исключением внутри
`syncPlayerAchievements`.

### Production

Текущий единственный production-сезон **НЕ закрывался** и **НЕ будет**
закрыт в рамках этого этапа — механика подготовлена и покрыта тестами;
закрытие — отдельное, осознанное действие администратора позже.

## Основные принципы системы

- **Repository Layer не нарушается.** Прямых обращений к Supabase/Postgres
  вне существующих Repository не появилось ни на одном этапе.
- **Achievement Engine не знает про БД, Repository, API или UI.**
  `runAchievementEngine` — чистая функция `(definitions, metrics) →
  AchievementProgress[]`.
- **Evaluator ничего не знает про Repository.** Только `AchievementDefinition`
  и `PlayerAchievementMetrics` на входе, `AchievementProgress` на выходе.
- **Каталог — единственный источник истины.** Название, описание, иконка,
  порог, метрика, тип — всё из `config/achievements.ts`. UI никогда не
  дублирует эти данные (см. `app/players/[id]/achievements/page.tsx`,
  которая читает `getAchievementsSorted()`, а не хранит свой список).
- **Иконки — тоже через единый реестр.** Каталог хранит только
  `AchievementIconKey`; `components/achievements/achievement-icons.tsx`
  резолвит его в компонент через исчерпывающий
  `Record<AchievementIconKey, ReactNode>`.
- **Магические строки заменены типизированными константами.** `type`,
  `metric`, `category`, `source`, `icon` — везде `as const`-объект +
  производный union-тип (`ACHIEVEMENT_TYPE`/`AchievementType` и т.д.), в
  стиле, уже принятом в проекте для `RegistrationStatus`/`TournamentKind`
  (плейн string-literal union), но с именованными константами вместо
  ручного набора литералов на каждом месте использования. Настоящий
  TypeScript `enum` нигде не используется.
- **`AchievementCode` выводится из каталога, а не поддерживается вручную.**
  `(typeof ACHIEVEMENTS_CATALOG)[number]["code"]` — добавление записи в
  каталог автоматически расширяет тип.
- **Все автоматические достижения пересчитываются полностью.** Каждый вызов
  `syncPlayerAchievements` заново считает прогресс по всем `automatic`
  достижениям из полной истории `results` игрока — не инкрементально.
- **Manual-достижения не участвуют в автоматическом пересчёте.**
  `syncPlayerAchievements` фильтрует каталог до `type ===
  ACHIEVEMENT_TYPE.AUTOMATIC` перед вызовом Engine — `ManualEvaluator`
  зарегистрирован, но не вызывается в этом потоке.

## Возможные улучшения будущих версий

Ничего из перечисленного не является блокером для реализации новых
достижений — это заметки на будущее, не критичные проблемы:

- **Модульные тесты для Engine/Evaluators отсутствуют.** Каждый evaluator —
  чистая функция без I/O, тестируется тривиально в изоляции; тестов пока нет.
- **Пропуск достижений без evaluator в `runAchievementEngine` никак не
  логируется** (см. «Incremental implementation» выше) — осознанный выбор,
  чтобы не спамить консоль на каждый пересчёт, пока часть каталога ещё не
  реализована. Если понадобится видимость (например, метрика "сколько
  достижений в каталоге ещё не вычисляются") — это стоит собирать отдельно
  (агрегированной проверкой каталога против реестра evaluator'ов), а не
  логированием на каждый вызов `syncPlayerAchievements`.
- **`docs/ACHIEVEMENTS_ARCHITECTURE.md`** (документ с прошлого этапа) описывает
  систему ДО появления Engine/Evaluators/типизированных констант — он не
  обновлялся в рамках этого этапа и частично устарел; при следующей
  правке документации стоит либо обновить его, либо заменить ссылкой на
  этот файл.
- **`app/players/[id]/achievements/page.tsx`** по-прежнему содержит debug
  `console.log`, помеченный комментарием "remove after verifying achievements
  display correctly" — не тронут ни на одном этапе рефакторинга, остаётся вне
  рамок этой архитектурной работы.
