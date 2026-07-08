# Repository Layer — прогресс миграции

См. архитектуру: [docs/REPOSITORY_LAYER_ARCHITECTURE.md](./REPOSITORY_LAYER_ARCHITECTURE.md).

## Статус по доменам

- ✅ AppSettings
- ✅ EmailOtp
- ✅ Activity
- ✅ AvatarStorage
- ✅ Player
- ✅ Season
- ✅ Achievement
- ✅ Tournament
- ✅ Registration
- ✅ TournamentLiveState
- ✅ Result
- ⬜ Leaderboard *(нет отдельного Repository — леерборд всегда был агрегацией над Result, см. Фазу 4)*

## Правила миграции

- Repository Layer мигрируется по доменам (по одной таблице/агрегату за фазу), а не по файлам целиком — один и тот же файл (например, `features/tournaments.ts`) может быть частично мигрирован в разные фазы.
- Публичный контракт приложения (HTTP-ответы, экспортируемые сигнатуры функций) после каждой фазы не должен меняться.
- Repository — тонкая 1:1 обёртка над Supabase-запросами: без валидации, авторизации, оркестрации, каскадных операций, агрегаций и бизнес-решений. Всё это остаётся в `features/*.ts` / `lib/*.ts` / route handler'ах.
- PostgreSQL, Drizzle и `DATABASE_PROVIDER` появятся только после того, как весь Supabase-слой репозиториев будет завершён — не раньше.

## Журнал фаз

### Фаза 1 — AppSettings
`lib/repositories/app-settings/`. Перевёл `lib/app-settings.ts`.

### Фаза 2 — EmailOtp, Activity, AvatarStorage
Реорганизация в доменные папки (`lib/repositories/<domain>/{Interface,SupabaseImpl,index}.ts`).
`lib/repositories/email-otp/`, `lib/repositories/activity/`, `lib/repositories/avatar-storage/`.
Перевёл `lib/email-otp.ts`, `lib/activity-logger.ts`, `app/api/admin/activity/route.ts` (частично), `lib/avatar-sync.ts` (частично), `app/api/players/[id]/avatar/route.ts` (частично).

### Фаза 3 — Player
`lib/repositories/player/`. Перевёл players-операции в `features/auth.ts`, `features/auth-server.ts`, `features/admin.ts`, `features/tournaments.ts` (только 2 players-операции), `lib/avatar-sync.ts` (players-часть), `app/api/players/[id]/avatar/route.ts` (players-часть), `app/api/activity/route.ts`, `app/api/admin/activity/route.ts` (players-часть).

`middleware.ts` намеренно **не переведён** — работает в Edge Runtime и сознательно избегает `server-only`-зависимостей (Web Crypto вместо Node `crypto`, свой inline anon-key клиент). Каждый файл-репозиторий несёт собственный `import "server-only"`, который ломает Edge-сборку. Осталась собственная inline-реализация, как и было.

`scripts/migrate-telegram-avatars.ts` — не переведён, отдельный одноразовый скрипт вне route/feature-графа (тот же принцип, что и в Фазе 2).

### Фаза 3.5 — Database Client Layer
Новый слой между Repository и Supabase: `lib/database/supabase/{server,browser,index}.ts` + `lib/database/index.ts`.

- `server.ts` — service-role клиент (бывший `lib/supabase-server.ts`)
- `browser.ts` — anon-key клиент, безопасный и для сервера, и для браузера (бывший `lib/supabase.ts`)
- `lib/supabase-server.ts` и `lib/supabase.ts` стали тонкими re-export shim'ами — не удалены на тот момент, чтобы не трогать ещё не мигрированные файлы (`features/achievements.ts`, `features/admin.ts` (не-players часть), `features/tournaments.ts` (не-players часть), `app/page.tsx`, `app/tournaments/page.tsx`, `app/api/leaderboard/route.ts`, `app/api/admin/tournaments/route.ts`, `app/api/players/[id]/achievements/route.ts`)
- Все 5 существующих репозиториев (`AppSettings`, `Activity`, `AvatarStorage`, `EmailOtp`, `Player`) переключены на импорт из `@/lib/database` напрямую, минуя shim.
- Не вводили отдельный `admin.ts` (как в примере из задачи) — сегодня есть ровно один server-side уровень доверия (service-role), а не два; отдельный `admin.ts` дублировал бы `server.ts` без причины.

### Фаза 4 — Season, Achievement, Tournament, Registration, TournamentLiveState, Result (завершение Supabase Repository Layer)

Все шесть оставшихся доменов реализованы разом:

- `lib/repositories/season/` — `findActive()`, единственная операция (сезоны только читаются приложением).
- `lib/repositories/achievement/` — `findByPlayerId`, `findSummariesByPlayerId`, `upsertMany`, `deleteByPlayerId`.
- `lib/repositories/tournament/` — `findById`, `findSeasonIdById`, `listOpen/listCompleted/listExcludingStatus/listByStatuses`, `create/update/patch/delete`.
- `lib/repositories/registration/` — самый большой интерфейс (19 методов): каждый JOIN-запрос с `players`/`tournaments` смоделирован отдельным методом 1:1 с текущим select-списком, а не унифицирован — списки колонок в разных вызовах различаются (где-то есть `id`/`username`, где-то нет), унификация означала бы либо over-fetch, либо параметризацию колонок, а это уже не «тонкая обёртка».
- `lib/repositories/tournament-live-state/` — объединяет `tournament_live_entries` + `tournament_player_eliminations` одним интерфейсом, как согласовано ранее.
- `lib/repositories/result/` — `results`, включая JOIN-запросы для лидерборда и истории турниров игрока.

Полностью переписаны: `features/tournaments.ts` (все супабейз-запросы, кроме уже мигрированных Player-операций), `features/achievements.ts`, `features/admin.ts` (4 каскадных удаления в `deleteManualPlayer`), `app/api/leaderboard/route.ts`, `app/api/admin/tournaments/route.ts`, `app/api/players/[id]/achievements/route.ts`.

`lib/supabase-server.ts` — **удалён**. После этой фазы у него не осталось ни одного импортёра (все переведены на репозитории), поэтому shim убран как мёртвый код, а не оставлен «на всякий случай». `lib/supabase.ts` (anon-key) остался — его по-прежнему используют `app/page.tsx` и `app/tournaments/page.tsx` для Realtime-подписок (сознательное исключение, см. `docs/REPOSITORY_LAYER_ARCHITECTURE.md`, раздел 1.1).

**Результат:** ни один файл в проекте, кроме реализаций внутри `lib/repositories/*/Supabase*.ts`, не делает прямых вызовов `.from(...)`/`.storage.from(...)` — за исключением трёх заранее согласованных исключений: `middleware.ts` (Edge Runtime), `scripts/migrate-telegram-avatars.ts` (одноразовый скрипт вне графа route/feature), Realtime-подписки в двух client component'ах.
