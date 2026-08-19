# Architecture Overview

Система достижений в RERAISE — узкий, полностью серверный модуль без своей конфигурации в БД. Список достижений (5 штук) — это **жёстко закодированный TypeScript-объект** `ACHIEVEMENT_TARGETS` в `features/achievements.ts`. Никакого enum, JSON-конфига или таблицы "справочник достижений" не существует — есть только таблица прогресса `player_achievements`.

Вычисление устроено как **pull-модель на основе пересчёта агрегатов**, а не событийная модель с независимыми триггерами. Единственная точка входа — `syncPlayerAchievements(playerId)`, которая:
1. Заново считает статистику игрока из `results` (сыгранные турниры, победы, сумма рейтинговых очков) через `ResultRepository`;
2. Сравнивает с целевыми порогами;
3. Делает `upsertMany` в `player_achievements` через `AchievementRepository`.

Это не инкрементальная выдача ("выдать ачивку при событии X"), а **полный пересчёт прогресса по всем 5 достижениям при каждом вызове**. Единственное место, откуда вызывается пересчёт — завершение турнира (`features/tournaments.ts`), в двух функциях: `completeTournamentFromLiveEntries` и `saveTournamentResults`.

Repository Layer соблюдается: прямых обращений к Supabase/Postgres из `features/achievements.ts` нет — всё идёт через `AchievementRepository` и `ResultRepository`. Есть двойная реализация (Supabase / Postgres) с переключением через `DATABASE_PROVIDER` — это часть текущей миграции проекта с Supabase-клиента на Drizzle/Postgres.

Важный архитектурный факт: **метаданные достижений (заголовки, описания, иконки, целевые значения) продублированы во фронтенде** (`app/players/[id]/achievements/page.tsx`) — они не приходят с бэкенда, а захардкожены второй раз в UI-компоненте.

# File Map

## Бизнес-логика
- `features/achievements.ts` — единственный сервис. Содержит `ACHIEVEMENT_TARGETS` (источник истины по списку/порогам достижений), `getPlayerAchievements`, `getPlayerAchievementStats` (приватная), `syncPlayerAchievements`, `syncPlayersAchievements` (батч).
- `features/tournaments.ts` — вызывает `syncPlayersAchievements` после завершения турнира (2 места: L855, L899). Также источник статистики игрока опосредованно (пишет в `results`).
- `features/admin.ts` — вызывает `achievementRepository.deleteByPlayerId` при полном удалении вручную заведённого игрока (L43).

## Repository Layer
- `lib/repositories/achievement/AchievementRepository.ts` — интерфейс + типы `AchievementSummary`, `AchievementUpsert`.
- `lib/repositories/achievement/PostgresAchievementRepository.ts` — Drizzle-реализация (используется, если `DATABASE_PROVIDER=postgres`).
- `lib/repositories/achievement/SupabaseAchievementRepository.ts` — Supabase-реализация (текущая активная по умолчанию / legacy path).
- `lib/repositories/achievement/index.ts` — фабрика, выбирающая реализацию по env-переменной.
- `lib/repositories/index.ts` — реэкспорт `achievementRepository` в общий барабан репозиториев.
- `lib/repositories/result/*` — не про achievements напрямую, но `ResultRepository.countByPlayerId / findWinIdsByPlayerId / findRatingPointsByPlayerId` — единственный источник входных данных для пересчёта прогресса.

## БД / схема
- `lib/db/schema/achievements.ts` — Drizzle-схема таблицы `player_achievements`.
- `lib/db/migrations/0000_true_matthew_murdock.sql` — SQL создания таблицы (baseline-миграция, часть Supabase→Postgres перехода).
- `lib/db/schema/results.ts` — схема `results`, откуда берётся вся статистика для достижений.

## Типы
- `types/domain.ts` — `PlayerAchievement` (доменный тип, используется в `findByPlayerId`).
- `types/database.ts` — `PlayerAchievementRow` (сырой формат строки БД, используется в Supabase-маппере).
- Локальные типы `AchievementRow` / `AchievementView` — задублированы внутри `app/players/[id]/achievements/page.tsx`, не переиспользуют доменные типы.

## API
- `app/api/players/[id]/achievements/route.ts` — единственный API route. `GET`, отдаёт `findSummariesByPlayerId(id)` как есть (3 поля: `achievement_code`, `current_value`, `completed_at`).

## UI
- `app/players/[id]/achievements/page.tsx` — отдельная страница со списком всех 5 достижений и прогресс-барами. Дублирует `ACHIEVEMENT_TARGETS` и добавляет тексты/иконки на русском. Содержит debug `console.log`, помеченный комментарием "remove after verifying achievements display correctly" — то есть незавершённый/временный код в проде.
- `app/players/[id]/page.tsx` — профиль игрока: карточка-виджет "Достижения X/5" со ссылкой на страницу выше. Не использует данные из API напрямую для метаданных, только считает `completed_at !== null`.
- `app/page.tsx` — главный экран: показывает счётчик "Достижения: N" в шапке профиля.

## Тесты
- `features/__tests__/waitlist.test.ts`, `features/__tests__/admin-remove-participant.test.ts` — мокают `syncPlayersAchievements` как no-op, поскольку эти сценарии транзитивно тянут `features/tournaments.ts`.

# Data Flow

```
Google Sheets (live-sync / pull-sheet)
        │
        ▼
tournament_live_entries  (заполняется вручную/через sheet-синхронизацию)
        │
        ▼
POST /api/admin/tournaments/[id]/complete-live   ИЛИ   POST /api/admin/tournaments/[id]/complete-free
        │                                                      │
        ▼                                                      ▼
completeTournamentFromLiveEntries()                  saveTournamentResults()
   (features/tournaments.ts)                           (features/tournaments.ts)
        │                                                      │
        ├─ resultRepository.deleteByTournamentId + insertMany (пишет results, включая rating_points)
        ├─ registrationRepository.markAttendedBulk
        ├─ tournamentRepository.patch(status: "completed")
        │
        ▼
syncPlayersAchievements(playerIds)   ← общая точка входа из обеих веток
        │  (try/catch — ошибка синка достижений НЕ роняет завершение турнира,
        │   только логируется в консоль)
        ▼
syncPlayerAchievements(playerId)  [для каждого playerId параллельно]
        │
        ├─ resultRepository.countByPlayerId          → played count
        ├─ resultRepository.findWinIdsByPlayerId      → wins (place = 1)
        ├─ resultRepository.findRatingPointsByPlayerId → сумма rating_points
        │
        ▼
Сравнение с ACHIEVEMENT_TARGETS → payload (current_value, completed_at)
        │
        ▼
achievementRepository.upsertMany(payload)  → UPSERT в player_achievements
        (конфликт по (player_id, achievement_code))
        │
        ▼
Таблица player_achievements (БД)
        │
        ▼
GET /api/players/[id]/achievements  → achievementRepository.findSummariesByPlayerId
        │
        ▼
UI:
  - app/players/[id]/achievements/page.tsx  (полная страница прогресса)
  - app/players/[id]/page.tsx               (виджет-счётчик)
  - app/page.tsx                            (счётчик в шапке главного экрана)
```

Отдельная ветка удаления игрока:
```
deleteManualPlayer(playerId)  [features/admin.ts]
        │
        ├─ tournamentLiveStateRepository.deleteLiveEntriesByPlayerId
        ├─ achievementRepository.deleteByPlayerId   ← явное удаление достижений
        ├─ resultRepository.deleteByPlayerId
        ├─ registrationRepository.deleteByPlayerId
        └─ playerRepository.delete
```
Это явное удаление избыточно поверх `ON DELETE CASCADE` на FK `player_achievements.player_id → players.id` (см. раздел Database), но не противоречит ему — просто явный порядок в коде поверх БД-каскада.

# Database

## Таблица `player_achievements`
Определена в `lib/db/schema/achievements.ts`, создана в baseline-миграции `0000_true_matthew_murdock.sql`.

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | uuid | PK, default random |
| `player_id` | uuid | NOT NULL, FK → `players.id`, `ON DELETE CASCADE` |
| `achievement_code` | text | NOT NULL, **не enum, не CHECK-констрейнт** — свободный текст |
| `current_value` | integer | NOT NULL, default 0, CHECK `>= 0` |
| `completed_at` | timestamp with tz | nullable |
| `updated_at` | timestamp with tz | NOT NULL, default now(), auto-update |

Индексы:
- `player_achievements_player_id_achievement_code_key` — **уникальный составной** (player_id, achievement_code) — это ключ конфликта для upsert.
- `player_achievements_code_idx` — по `achievement_code`.
- Отдельного индекса только по `player_id` нет — комментарий в схеме поясняет, что он избыточен благодаря составному уникальному индексу (leftmost column).

Комментарий в самой схеме прямо говорит: `achievement_code` намеренно свободный текст, а не enum/CHECK, потому что канонический список хранится в коде (`ACHIEVEMENT_TARGETS`) и растёт — constraint потребовал бы миграцию на каждое новое достижение.

## Связанные таблицы
- `players` (`lib/db/schema/players.ts`) — родитель по FK, каскадное удаление.
- `results` (`lib/db/schema/results.ts`) — источник данных для пересчёта:
  - `place` (используется как признак победы: `place = 1` → win)
  - `rating_points` (замороженный снапшот на момент турнира, не пересчитывается ретроактивно)
  - `player_id`, `tournament_id`, `season_id`
- Никакой таблицы "справочник достижений" (`achievements_catalog` и т.п.) не существует. Только `player_achievements` — таблица прогресса, а не каталога.

# Repository Layer

Логика достижений проходит через два репозитория:

1. **AchievementRepository** (`lib/repositories/achievement/`)
   - `findByPlayerId` — полный список достижений игрока (доменный тип).
   - `findSummariesByPlayerId` — узкая проекция из 3 полей, используется API-роутом.
   - `upsertMany` — единственная точка записи прогресса.
   - `deleteByPlayerId` — используется при удалении игрока.
   - Две реализации (`SupabaseAchievementRepository`, `PostgresAchievementRepository`), выбор через `DATABASE_PROVIDER` env var в `index.ts`.

2. **ResultRepository** (`lib/repositories/result/`)
   - Не принадлежит домену achievements, но `syncPlayerAchievements` полностью зависит от трёх его методов для получения сырых цифр (`countByPlayerId`, `findWinIdsByPlayerId`, `findRatingPointsByPlayerId`).
   - Сама логика "что считать достижением" **не** живёт в репозитории — репозиторий только отдаёт сырые данные, решение принимает `features/achievements.ts`. Это прямо задокументировано в `docs/REPOSITORY_LAYER_ARCHITECTURE.md:155`.

Других репозиториев achievements не касается напрямую (registration/tournament/tournament-live-state репозитории используются в `features/tournaments.ts` до вызова синка достижений, но не самим модулем достижений).

# Current Achievement Flow

1. Админ завершает турнир (live-режим через Sheets-синк или ручной ввод результатов) → вызывается один из двух API routes (`complete-live` / `complete-free`).
2. `features/tournaments.ts` записывает `results` (места, нокауты, `rating_points`), помечает регистрации как `attended`, переводит турнир в статус `completed`.
3. **После** этого, в `try/catch`, вызывается `syncPlayersAchievements(playerIds)` — по всем участникам турнира параллельно.
4. Для каждого игрока весь прогресс **пересчитывается с нуля** по всей истории `results` этого игрока (а не инкрементально по одному турниру) — то есть каждый `syncPlayerAchievements` — это полный агрегат, не дельта.
5. Результат — `upsertMany`, который перезаписывает все 5 строк `player_achievements` для игрока (insert если не было, update если были — все поля перетираются значением из `excluded`).
6. Никакого уведомления (push, Telegram-сообщение, тост) о новом достижении не отправляется — это чисто "тихая" синхронизация данных. Единственный сигнал пользователю — то, что он увидит обновлённый прогресс при следующем открытии профиля/страницы достижений.
7. Ошибка синка достижений **не блокирует** завершение турнира — она логируется в `console.error` и проглатывается. Значит, достижения могут отставать от `results`, если синк упал (сети, БД и т.д.), и никакого повторного/фонового ретрая нет.
8. Фронтенд не полагается на "выдачу" в реальном времени — он просто дергает `GET /api/players/[id]/achievements` при каждом открытии страниц профиля/достижений и сравнивает `completed_at !== null`.

# Extension Points

- **`ACHIEVEMENT_TARGETS` в `features/achievements.ts`** — формально единственное место, где нужно добавить новый ключ + порог, чтобы завести новое достижение вычисляемого типа (по образу существующих 5 — "количество" против порога).
- **`getPlayerAchievementStats`** — если новое достижение требует новой агрегатной метрики (не "количество турниров/побед/очков"), потребуется новый метод в `ResultRepository` (или другом репозитории) и его использование здесь.
- **`AchievementRepository`** — интерфейс уже достаточно общий (upsert по коду), новых методов для простого добавления достижения не требуется.
- **UI-страница** `app/players/[id]/achievements/page.tsx` — придётся руками добавить новую карточку `AchievementView` (заголовок/описание/иконка) — это отдельный shadow-список, синхронизировать вручную с `ACHIEVEMENT_TARGETS`.

# Risks

1. **Дублирование источника истины между бэкендом и фронтендом.** `ACHIEVEMENT_TARGETS` существует в двух местах: `features/achievements.ts` (реальные пороги для вычисления) и `app/players/[id]/achievements/page.tsx` (те же 5 ключей и пороги, продублированные вручную для отображения текста/иконок). Если добавить достижение только в одном месте — сломается либо отображение (не покажется), либо логика (не посчитается). Ничего не заставляет держать их в синхронизации — ни типы, ни тесты.
2. **Захардкоженное "/5" в UI.** И `app/players/[id]/page.tsx`, и `app/page.tsx` жёстко делят на `5` при расчёте процента прогресса (`completedAchievementsCount / 5`). Добавление 6-го достижения потребует правки в трёх файлах UI отдельно от бэкенда, иначе процент будет считаться неверно.
3. **`achievement_code` — свободный текст без enum/CHECK.** Это осознанное архитектурное решение (задокументировано в самой схеме), но оно означает отсутствие защиты от опечатки в коде достижения на уровне БД — контроль полностью на стороне TypeScript-константы.
4. **Полный пересчёт вместо инкремента.** `syncPlayerAchievements` каждый раз читает всю историю `results` игрока и пересчитывает все 5 достижений заново. При росте количества достижений и истории турниров это может стать дороже, но явного event-driven/инкрементального механизма нет — расширение через события (например, "детект конкретного ачивмента конкретным обработчиком") потребует нового паттерна, а не встраивания в текущий.
5. **Отсутствие ретраев/очереди для синка.** Ошибка `syncPlayersAchievements` только логируется и проглатывается (`try/catch` в обеих функциях `features/tournaments.ts`). Нет фонового job/cron, который бы досчитал достижения, если синк не удался в моменте завершения турнира — расхождение между `results` и `player_achievements` может остаться незамеченным.
6. **Debug-код в проде.** `app/players/[id]/achievements/page.tsx` содержит `console.log` с комментарием "DEBUG: remove after verifying achievements display correctly" — указывает на незавершённую/временную вставку, оставленную в текущей версии.
7. **Единственная точка вызова синка — завершение турнира.** Нет ручного admin-инструмента "пересчитать достижения игрока/всех игроков" на случай расхождения (кроме как через повторное сохранение результатов турнира). Если понадобится ре-синк исторических данных после изменения порогов/добавления нового достижения — потребуется отдельный скрипт/эндпоинт, которого сейчас нет.
8. **Явное `deleteByPlayerId` поверх `ON DELETE CASCADE`.** В `features/admin.ts` explicit-удаление достижений при удалении игрока дублирует то, что уже обеспечивает FK-каскад в БД. Не баг, но означает, что порядок ручных удалений в коде должен и дальше поддерживаться в согласии с FK-графом — если один из репозиториев когда-то уберут из цепочки вручную, каскад БД всё равно отработает, но порядок/транзакционность резко изменится.
