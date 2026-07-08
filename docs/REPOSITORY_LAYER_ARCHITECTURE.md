# Repository Layer — архитектура для Re-raise

Статус: **черновик на утверждение**. Кода нет и не будет, пока этот документ не согласован.

Цель этапа — спроектировать переход:

```
Route / Server Component → Supabase (напрямую)
```

к:

```
Route / Server Component → Feature → Repository → Supabase
```

**без единого изменения поведения**, так, чтобы позже добавление `PostgresRepository` + `DATABASE_PROVIDER` было механическим переключением, а не рефакторингом.

---

## 0. Отличие от целевой схемы, которую вы предложили

Вы описали цель как:

```
Route → Repository → Supabase
```

Это буквально то, что сделано в Poker Clock — и это правильно **для него**, потому что там нет отдельного слоя бизнес-логики: вся валидация и расчёты (prize pool, PIN-хэши, дефолтные уровни блайндов) живут прямо в route handler'е, а сам проект — один домен (турниры).

Re-raise — другой масштаб. У него уже есть `features/*.ts` (auth, tournaments, admin, achievements, rating) и `lib/*.ts` (activity-logger, avatar-sync, app-settings, email-otp), которые играют ровно ту роль, которую в Poker Clock играет код внутри route handler'а — только вынесенную в переиспользуемый слой, потому что:

- Server Components (`app/page.tsx`, `app/tournaments/page.tsx`) тоже обращаются к данным, а не только route handlers;
- одна и та же операция (например, регистрация игрока на турнир) нужна в нескольких местах;
- некоторые фичи (turnaments.ts) — 1700+ строк бизнес-логики, которую в route handler не засунешь без дублирования.

Поэтому реальная целевая схема для Re-raise:

```
Route / Server Component
        ↓
     Feature   (бизнес-логика, валидация, оркестрация — то, что в Poker Clock лежит в route handler'е)
        ↓
   Repository  (тонкий доступ к данным — 1:1 с сегодняшними Supabase-запросами)
        ↓
    Supabase
```

Это не отклонение от вашей идеи, а её адаптация под масштаб проекта — Repository остаётся ровно тем же тонким слоем, что и в Poker Clock, просто над ним уже есть (и должен остаться) `Feature`-слой, который у Poker Clock просто не понадобился.

---

## 1. Карта текущей архитектуры

### 1.1 Как данные сейчас достаются (3 разных паттерна)

| Паттерн | Где | Пример |
|---|---|---|
| Route → Feature → Supabase | Большинство API-роутов | `app/api/admin/referral/route.ts` → `features/admin.ts` → `supabase` |
| Route → Supabase напрямую | 5 роутов | `app/api/leaderboard/route.ts`, `app/api/admin/activity/route.ts`, `app/api/activity/route.ts`, `app/api/admin/tournaments/route.ts` (GET), `app/api/players/[id]/achievements/route.ts` |
| Server Component → Feature → Supabase | `app/page.tsx`, `app/tournaments/page.tsx`, `app/players/[id]/page.tsx` | те же `features/auth.ts`, `features/tournaments.ts` |
| Client Component → Supabase Realtime напрямую | `app/page.tsx`, `app/tournaments/page.tsx` | `supabase.channel(...).on("postgres_changes", ...)` |

Вывод: Repository Layer должен одинаково работать и из route handler'ов, и из Server Components (это не проблема — и то, и другое выполняется на сервере в Node.js-рантайме) — просто как обычный async-импорт, без какого-либо DI-контейнера, точно как в Poker Clock.

**Realtime-подписки — отдельный случай.** Это не CRUD-запрос, а долгоживущий WebSocket-канал на Supabase-специфичном API (`postgres_changes`). У будущего `PostgresRepository` не будет прямого аналога — потребуется что-то вроде отдельного WS-сервера или polling. Поэтому Realtime **сознательно не входит** в Repository Layer на этом этапе — остаётся прямым использованием `lib/supabase.ts` в клиентских компонентах, как сейчас. Это фиксируется как известное ограничение, не блокер.

### 1.2 Таблицы и кто их трогает

| Таблица | RLS | Основные потребители |
|---|---|---|
| `players` | ❌ отключён | `features/auth.ts`, `features/auth-server.ts`, `features/admin.ts`, `middleware.ts`, `lib/avatar-sync.ts`, `lib/current-player.ts` (косвенно) |
| `tournaments` | ❌ отключён | `features/tournaments.ts`, `app/api/admin/tournaments/route.ts` |
| `registrations` | ❌ отключён | `features/tournaments.ts` |
| `results` | ❌ отключён | `features/tournaments.ts`, `features/achievements.ts`, `app/api/leaderboard/route.ts` |
| `tournament_player_eliminations` | ❌ отключён | `features/tournaments.ts` |
| `seasons` | ✅ (без политик) | `features/tournaments.ts`, `app/api/admin/tournaments/route.ts`, `app/api/leaderboard/route.ts` |
| `tournament_live_entries` | ✅ (без политик) | `features/tournaments.ts`, `features/admin.ts` |
| `player_achievements` | ✅ (без политик) | `features/achievements.ts`, `features/admin.ts`, `app/api/players/[id]/achievements/route.ts` |
| `activity_events` | ✅ (без политик) | `lib/activity-logger.ts`, `app/api/activity/route.ts`, `app/api/admin/activity/route.ts` |
| `app_settings` | ✅ (без политик) | `lib/app-settings.ts` |
| `email_otp_codes` | ✅ (без политик) | `lib/email-otp.ts` |
| Storage bucket `avatars` | ⚠️ публичный listing | `lib/avatar-sync.ts`, `app/api/players/[id]/avatar/route.ts` |

Поскольку RLS сейчас либо отключён, либо включён без политик (== deny-all для anon/authenticated, доступ только через service-role), **разницы в правах доступа между anon-key клиентом (`lib/supabase.ts`) и service-role клиентом (`lib/supabase-server.ts`) сегодня фактически нет**. Это значит, что каждый Repository может иметь **одну** реализацию (на service-role), не пытаясь сохранить несуществующую сейчас границу привилегий.

---

## 2. Домены и Repository

Двенадцать таблиц группируются в **9 Repository**, а не в 12 — там, где несколько таблиц образуют один агрегат (например, `tournament_live_entries` + `tournament_player_eliminations` — обе описывают состояние *идущего сейчас* турнира), они живут за одним интерфейсом, ровно как в Poker Clock `TournamentRepository` покрывает `tournaments` + `blind_levels` + `tournament_events` одним интерфейсом.

### 2.1 `PlayerRepository`

**За что отвечает:** всё чтение/запись таблицы `players` — идентификация (по telegram_id/email/id), профиль, модерация ников, флаги доступа (`can_access_*`), реферальные счётчики.

**Операции (пример состава):**
- `findById`, `findByTelegramId`, `findByEmail`
- `create` (из Telegram-профиля, из email)
- `updateProfile` (display_name, avatar-поля, completed_at)
- `updateAdminDisplayName`, `updateTournamentAccess`, `updateReferralData`
- `listForAccessManagement`, `listForNicknameDirectory`, `listForReferral` (те же select-запросы, что и сегодня, включая сортировку)
- `delete`

**Чего быть не должно:** проверки роли/прав (это middleware/Feature), решение "принять ли никнейм" (это Feature — `submitNicknameForModeration`/`approveNickname` в `features/auth.ts` остаются как оркестрация, репозиторий только делает `update`), удаление игрока целиком (`deleteManualPlayer` в `admin.ts` трогает 5 таблиц — это оркестрация в Feature, каждый шаг — вызов своего репозитория).

### 2.2 `SeasonRepository`

**За что отвечает:** `seasons` — маленькая, стабильная таблица.

**Операции:** `getActive`, `findById`, `list`.

**Чего не должно быть:** расчёт лидерборда (это `ResultRepository` + Feature).

### 2.3 `TournamentRepository`

**За что отвечает:** CRUD турниров + типовые выборки (открытые/завершённые/видимые игроку).

**Операции:** `findById`, `create`, `update`, `delete`, `listOpen`, `listCompleted`, `listBySeasonId`, `getRegistrationCounts` *(этот метод сегодня считает по `registrations`, а не по `tournaments` — см. 2.4, решить при миграции: либо остаётся здесь как «сколько мест занято в турнире», либо переезжает в `RegistrationRepository` — рекомендация: в `RegistrationRepository`, раз данные оттуда)*.

**Чего не должно быть:** проверка вместимости (`registeredCount < max_players` — это Feature, `registerPlayerForTournament`), генерация admin/display токенов (уже отдельно в `lib/tokens`-подобном месте, не трогаем).

### 2.4 `RegistrationRepository`

**За что отвечает:** `registrations` — кто на что записан.

**Операции:** `findByPlayerAndTournament`, `findByPlayerId`, `findByTournamentId`, `create`, `updateStatus`, `delete`, `countByTournamentId` (группированный count, как сегодня в `getTournamentRegistrationCounts`).

**Чего не должно быть:** решение registered/waitlist (это Feature — `registerPlayerForTournament` уже сегодня именно так устроен: читает count, читает tournament.max_players, сам решает статус, потом пишет).

### 2.5 `TournamentLiveStateRepository`

Объединяет `tournament_live_entries` + `tournament_player_eliminations` — обе таблицы существуют только для *живого* турнира прямо сейчас (rebuys/addons/arrived и elimination-статус пишутся вместе во время игры, обе участвуют в Google Sheets live-sync).

**Операции:** `ensureLiveEntries`, `getLiveEntries`, `updateLiveEntries` (bulk), `getEliminations`, `setElimination`.

**Альтернатива (если не нравится объединение):** два отдельных репозитория `TournamentLiveEntryRepository` + `TournamentEliminationRepository`. Технически обе таблицы — разные сущности с разным жизненным циклом, так что разделение тоже обосновано; я предлагаю объединение ради меньшей фрагментации, но это осознанный компромисс, а не единственно верный вариант — если решите разделить, ничего в остальном плане не меняется.

**Чего не должно быть:** синхронизация с Google Sheets (это `GoogleSheetsService`, вызывается из Feature отдельно), решение "завершать ли турнир" (`completeTournamentFromLiveEntries` — Feature-оркестрация: читает live entries отсюда, пишет `results` через `ResultRepository`, обновляет статус турнира через `TournamentRepository`).

### 2.6 `ResultRepository`

**За что отвечает:** `results` — финальные, settled итоги турнира. Самый "публичный" и высоконагруженный (лидерборд).

**Операции:** `findByTournamentId` (с join на `players` — мирroring сегодняшнего embedded `select` с вложенным `players(username, display_name)` — **join остаётся внутри репозитория**, не разбивается на два запроса, чтобы не менять поведение/производительность), `findBySeasonId` (то же для `getSeasonLeaderboard`), `bulkInsert`/`bulkUpsert` (для `saveTournamentResults`), `getPlayerRating`.

**Чего не должно быть:** агрегация лидерборда (`Map` + суммирование `rating_points` в `getSeasonLeaderboard`) — репозиторий отдаёт сырые (но уже join-нутые) строки, суммирование и сортировка остаются в Feature/route, как сейчас в `app/api/leaderboard/route.ts` и `features/tournaments.ts`.

### 2.7 `AchievementRepository`

**За что отвечает:** `player_achievements`.

**Операции:** `findByPlayerId`, `upsert`, `bulkUpsert`.

**Чего не должно быть:** сама логика "какие достижения засчитывать" (`syncPlayerAchievements` читает `results` и решает, что защитывать — это остаётся в `features/achievements.ts`, вызывая `ResultRepository` для чтения и `AchievementRepository` для записи).

### 2.8 `ActivityRepository`

**За что отвечает:** `activity_events` — лог событий (analytics/audit).

**Операции:** `log` (insert одного события), `findByPlayerId`, `findSince` (диапазон по дате, как в `admin/activity`).

**Чего не должно быть:** подсчёт KPI (active_today/active_7d, фильтрация админов, группировка по игрокам) — это чистая агрегация в route handler'е (`app/api/admin/activity/route.ts`), репозиторий просто отдаёт сырые события.

### 2.9 `AppSettingsRepository`

**За что отвечает:** `app_settings` — generic key-value.

**Операции:** `get(key)`, `set(key, value)`.

Тривиальный, 1:1 с сегодняшним `lib/app-settings.ts`.

### 2.10 `EmailOtpRepository`

**За что отвечает:** `email_otp_codes`.

**Операции:** `create`, `findLatestActive`, `markConsumed`/`delete`.

**Чего не должно быть:** генерация кода, отправка письма (Resend — отдельный Service), валидация формата email (`isValidEmail`/`normalizeEmail` в `lib/email-otp.ts` — чистые функции, никакого отношения к данным, остаются как есть).

### 2.11 `AvatarStorageRepository`

**За что отвечает:** Supabase Storage bucket `avatars` — не таблица, а файловое хранилище. Аналог `StorageRepository` из Poker Clock, но реализация не «локальный диск», а Supabase Storage (что логично — Storage продолжает работать через Supabase на этом этапе, PostgreSQL не подключаем).

**Операции:** `upload(playerId, filename, bytes, contentType)`, `getPublicUrl(playerId, filename)`, `exists`.

**Чего не должно быть:** решение "скачивать ли аватар из Telegram" (`syncTelegramAvatar` — Feature/Service-оркестрация: фетчит из Telegram напрямую через `fetch`, потом вызывает `AvatarStorageRepository.upload`, потом `PlayerRepository.updateAvatarUrl`).

---

## 3. Что НЕ должно быть Repository

| Сущность | Тип | Почему не Repository |
|---|---|---|
| **Google Sheets** (`lib/google-sheets.ts`) | `GoogleSheetsService` | Это внешний API (Google), не наша БД. Нет понятия "переключить провайдера" — Google Sheets либо есть, либо нет. |
| **Telegram** (bot API, webhook, WebApp initData, Login Widget) | `TelegramIntegrationService` (уже частично `lib/telegram.ts`) | Внешняя интеграция с side-effects (отправка сообщений), а не хранилище данных. |
| **Resend / email** (`lib/resend.ts`) | `EmailService` | Внешний провайдер отправки писем, не данные. |
| **Realtime-подписки** (`supabase.channel(...)`) | Остаётся прямым Supabase-вызовом | Долгоживущий WS-канал, Supabase-специфичный API, нет CRUD-аналога — см. 1.1. |
| **Rating calculation** (`features/rating.ts`) | Чистая функция | Нет обращения к данным вообще — просто математика. |
| **Session signing** (`lib/telegram-web-session.ts`) | Чистая функция (крипто) | Нет обращения к данным. |
| **Admin** (`features/admin.ts`) | Не отдельный домен вообще | Это набор привилегированных операций, которые веерно дёргают `PlayerRepository` + `TournamentLiveStateRepository` + `AchievementRepository` + `ResultRepository` + `RegistrationRepository`. Если сделать `AdminRepository` — это и есть тот самый God Object, которого вы просили избежать. |

---

## 4. Где остаётся бизнес-логика

**В Repository — только:**
- Фильтры/сортировки/join'ы, которые Supabase-запрос делает сегодня (1:1 копия).
- Маппинг `*Row` (из `types/database.ts`) → доменный тип (из `types/domain.ts`) — эта функция (`mapPlayerRowToDomain` и аналоги) уже существует в коде и должна **переехать внутрь** Repository-реализации, а не остаться в Feature.
- Обработка ошибок в единый `RepositoryError` (как в Poker Clock).

**В Feature (`features/*.ts`) — всё остальное, без изменений:**
- Валидация входных данных.
- Оркестрация нескольких репозиториев (например, `registerPlayerForTournament`: читает Registration + Tournament + Registration-counts, сам решает `registered` vs `waitlist`, потом пишет).
- Каскадные операции (`deleteManualPlayer`: 5 репозиториев подряд).
- Вызов Service-слоя (Google Sheets, Telegram, Email) там, где это нужно.
- Любые вычисления (prize pool-аналоги, агрегация лидерборда, KPI активности).

**В Route handler / Server Component — как и сейчас:**
- Разбор запроса, HTTP-статусы, авторизационные проверки на уровне запроса.
- Прямой вызов Feature (не Repository напрямую — это осталось бы нарушением слоя).

---

## 5. `DATABASE_PROVIDER` — когда вводить

**Согласен с вашим предположением: не сейчас.**

Причина не только "рано", а конкретно: `DATABASE_PROVIDER`-ветвление в Poker Clock (`usePostgres ? new Postgres... : new Supabase...`) имеет смысл только когда существуют **обе** реализации. Если завести этот флаг сейчас, когда `PostgresXxxRepository` не существует физически, — это будет мёртвый код и признак преждевременного проектирования под гипотетическое будущее, а не защита от него.

**Что делать вместо этого:** `lib/repositories/index.ts` на этом этапе просто:

```ts
export const playerRepository: PlayerRepository = new SupabasePlayerRepository()
export const seasonRepository: SeasonRepository = new SupabaseSeasonRepository()
// ...и т.д., без единого if/ternary
```

Когда появится Drizzle — добавление `DATABASE_PROVIDER` станет **механической** правкой одного файла (`index.ts`), по одной строке на репозиторий, ровно как в Poker Clock. Интерфейсы (`XxxRepository` типы) при этом не поменяются вообще — именно они и есть тот контракт, который делает переключение провайдера безопасным позже.

---

## 6. План миграции

Одиннадцать репозиториев — одиннадцать доменов, но **не одиннадцать одинаковых по риску шагов**. Порядок построен по возрастанию blast radius, а не по вашему примеру "Players → Seasons → Registrations..." — потому что Players используется практически везде (auth, middleware, avatar-sync) и лучше отработать паттерн на маленьких, изолированных доменах первым.

**Важно:** `features/tournaments.ts` (1700+ строк) сегодня смешивает Tournament + Registration + Result + Season + LiveState в одном файле. Он будет затронут в **нескольких** фазах (5, 8, 9, 10, 11) — по одному домену за раз, а не переписан целиком. `features/registrations.ts` уже существует как пустая заготовка (1 строка) — похоже, кто-то уже планировал этот файл; фаза 9 должна его реально наполнить.

| # | Фаза | Почему в этом месте |
|---|---|---|
| 1 | **AppSettings** | Самый маленький возможный домен (2 функции, 1 файл, 0 бизнес-логики). Идеальный "hello world" — обкатать паттерн `interface → Supabase-impl → index.ts export`, ничего не сломав. |
| 2 | **EmailOtp** | Маленький, самодостаточный (1 файл), не завязан ни на что другое. |
| 3 | **Activity** | Малый/средний, но уже 2 разных потребителя (клиентский логгер + admin-дашборд) — проверяет, что один репозиторий нормально обслуживает разные сценарии чтения. |
| 4 | **AvatarStorage** | Изолированный, НЕ таблица — проверяет, что Storage-репозиторий (не Postgres/Supabase DB, а Supabase Storage) вписывается в тот же паттерн интерфейсов. Разблокирует Player-фазу. |
| 5 | **Season** | Тривиальный по объёму, но первый "срез" из `features/tournaments.ts` — проверяет, что можно безопасно вынести один домен из большого файла, не трогая остальное. |
| 6 | **Achievement** | Средний, в основном читает `results` (ещё не мигрированную на этом шаге) напрямую — нормально, миграция идёт по таблицам, а не по файлам целиком (см. врезку ниже). |
| 7 | **Player** | Фундаментальный домен, но высокий blast radius (auth.ts, auth-server.ts, admin.ts, middleware.ts, avatar-sync.ts, current-player.ts). Делается после того, как паттерн обкатан на 6 меньших доменах. |
| 8 | **Tournament** | Второй "срез" из `features/tournaments.ts` — CRUD-ядро. |
| 9 | **Registration** | Третий срез; заодно физически наполняется `features/registrations.ts`. |
| 10 | **TournamentLiveState** (live entries + eliminations) | Операционное состояние живого турнира — сложнее по сценариям (bulk update, Google Sheets round-trip), поэтому после Tournament/Registration. |
| 11 | **Result** | Последний и самый ответственный — питает публичный лидерборд (самый высоконагруженный read-путь) и Achievements-sync. Делается последним, когда всё остальное уже стабильно. |

> **Про порядок "по таблице, а не по файлу":** на фазе 6 (Achievement) `features/achievements.ts` содержит 3 сырых вызова `.from("results")` — они **не** переезжают в `ResultRepository` на этой фазе (Result ещё не мигрирован), а остаются прямыми Supabase-вызовами до фазы 11. Это нормально и ожидаемо: один и тот же файл может быть частично мигрирован, частично — нет, в разные моменты времени. Каждая фаза закрывает ровно один Repository, а не один файл.

---

## 7. Риски и откат — по каждой фазе

Общий принцип отката: поскольку `DATABASE_PROVIDER` не вводится, "откат" — это не переключение провайдера, а **git revert** конкретного коммита фазы (репозиторий — 1:1 обёртка, так что откат тривиален и локален). Проверка — сравнение поведения "до/после" на тех же входных данных (ручной smoke-тест + существующие vitest-тесты, где есть).

| Фаза | Затронутые файлы | Как проверить | Как откатить |
|---|---|---|---|
| 1. AppSettings | `lib/app-settings.ts`, новый `lib/repositories/app-settings-repository.ts` + `supabase-app-settings-repository.ts` | `GET/POST /api/admin/settings`, `GET/POST /api/settings` — сравнить ответы до/после | revert коммита фазы, `lib/app-settings.ts` возвращается к прямым вызовам |
| 2. EmailOtp | `lib/email-otp.ts` | Пройти email-логин руками (`/api/auth/email/request-code`, `/verify-code`) | revert коммита |
| 3. Activity | `lib/activity-logger.ts`, `app/api/activity/route.ts`, `app/api/admin/activity/route.ts` | Открыть админ-дашборд активности, сверить цифры с продовыми до изменения | revert коммита |
| 4. AvatarStorage | `lib/avatar-sync.ts`, `app/api/players/[id]/avatar/route.ts` | Загрузить аватар вручную + проверить авто-синк Telegram-аватара при логине | revert коммита |
| 5. Season | `features/tournaments.ts` (только функции `getActiveSeason` и связанные) | Открыть лидерборд/список турниров, сверить активный сезон | revert коммита |
| 6. Achievement | `features/achievements.ts`, `app/api/players/[id]/achievements/route.ts` | Открыть страницу достижений игрока, сверить прогресс | revert коммита |
| 7. Player | `features/auth.ts`, `features/auth-server.ts`, `features/admin.ts` (частично), `middleware.ts`, `lib/current-player.ts` | Полный прогон логина (Telegram + email), проверка admin-гейта в middleware, нескольких admin-страниц игроков | revert коммита; это самая рискованная фаза — тестировать на staging/Docker-инстансе перед прод-веткой, **не** сразу на `re-raise.ru` |
| 8. Tournament | `features/tournaments.ts` (CRUD-функции) | Создание/редактирование/удаление турнира вручную в админке | revert коммита |
| 9. Registration | `features/tournaments.ts`, физическое наполнение `features/registrations.ts` | Регистрация/отмена регистрации, проверка waitlist-логики на заполненном турнире | revert коммита |
| 10. TournamentLiveState | `features/tournaments.ts` (live-функции), `features/admin.ts` (частично) | Полный прогон live-турнира: rebuy/addon/elimination + Google Sheets sync туда-обратно | revert коммита; проверять на тестовом турнире, не на реальном live-событии |
| 11. Result | `features/tournaments.ts`, `features/achievements.ts` (обновить 3 вызова), `app/api/leaderboard/route.ts` | Сверить лидерборд и результаты конкретного завершённого турнира до/после побайтово (JSON diff) | revert коммита; лидерборд — самый публичный экран, проверять первым делом после деплоя |

---

## 8. Открытые вопросы перед стартом Фазы 1

1. **`TournamentLiveStateRepository`: объединять `live_entries` + `eliminations` в один интерфейс или делать два?** (см. 2.5) — нужно ваше решение, дальше по плану не влияет.
2. **`getTournamentRegistrationCounts`** — метод `TournamentRepository` или `RegistrationRepository`? Рекомендую `RegistrationRepository` (данные оттуда), но название historically намекает на Tournament — уточнить при Фазе 4/9.
3. **RLS отключён на 5 таблицах** (раздел выше) — отдельное решение, не блокирует Repository Layer, но крайне рекомендую заняться параллельно/после.
4. Нужно ли для каждой фазы писать новый vitest-тест на репозиторий, или существующих features-тестов (`features/__tests__/*`) достаточно как regression-сети? Предлагаю: там, где тест уже есть — он и есть проверка; там где нет (Activity, AppSettings, AvatarStorage) — минимальный smoke-тест не обязателен, но приветствуется.

---

Документ готов к обсуждению. После утверждения — начинаем с Фазы 1 (AppSettings) отдельным шагом, тоже без спешки: сначала интерфейс + Supabase-реализация, потом переключение `lib/app-settings.ts` на неё, потом проверка.
