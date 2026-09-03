# Архитектура Re-raise

Этот документ описывает текущую архитектуру проекта. Он рассчитан на разработчика,
который впервые открывает кодовую базу и должен понять, как всё устроено и почему,
без необходимости читать историю изменений или чаты.

> **Исправлено 2026-09.** Более ранняя версия этого документа (разделы 3 и 8 ниже)
> утверждала, что существует отдельный, независимый, живой продовый деплой
> Telegram Mini App на Vercel с Supabase в качестве базы данных. Это было
> неверно. Единственный живой продовый деплой ReRaise — контейнер `re-raise` на
> VPS, с PostgreSQL (`DATABASE_PROVIDER=postgres`) в качестве единственной живой
> продовой БД. `Supabase<Domain>Repository`-реализации остаются в коде как
> legacy/compatibility-код, но не как признак второго живого провайдера/деплоя.
> Ложное утверждение о живом Vercel-деплое ранее также встречалось в комментарии
> `docker-compose.yml` — комментарий исправлен тем же коммитом.

---

## 1. Общая архитектура

Данные проходят через три слоя:

```
Route Handler / Server Component
        ↓
      Feature            (бизнес-логика, валидация, оркестрация)
        ↓
    Repository            (тонкий доступ к данным, 1:1 с запросом)
        ↓
  PostgreSQL | Supabase    (выбирается через DATABASE_PROVIDER)
```

- **Route Handler / Server Component** — разбор запроса, HTTP-статусы, авторизационные
  проверки уровня запроса. Никогда не обращается к Repository напрямую в обход Feature
  (кроме тривиальных случаев, где Feature была бы пустой оболочкой).
- **Feature** (`features/*.ts`, `lib/*.ts`) — вся бизнес-логика: валидация, оркестрация
  нескольких Repository, каскадные операции, вызовы внешних сервисов (Google Sheets,
  Telegram, Resend). Никогда не знает, откуда физически приходят данные.
- **Repository** (`lib/repositories/*`) — единственная точка доступа к данным. Тонкая
  обёртка: без бизнес-логики, без авторизации, без агрегаций.
- **PostgreSQL / Supabase** — конкретное хранилище, выбираемое во время выполнения
  через `DATABASE_PROVIDER`.

Почему так: цель — переключать источник данных (Supabase → PostgreSQL) не трогая
бизнес-логику и API-контракты. Если бы Feature знала о конкретной БД, каждая миграция
провайдера превращалась бы в рефакторинг всего приложения. Repository Layer делает
переключение провайдера механической правкой (`DATABASE_PROVIDER=postgres`), а не
рефакторингом.

Внешние интеграции (Google Sheets, Telegram Bot API, Resend, HMAC-подпись сессии) —
не Repository. Это Service-слой: у них нет понятия "переключить провайдера", это либо
внешний API, либо чистая функция без обращения к данным.

---

## 2. Repository Layer

### Структура

Каждый домен — отдельная папка в `lib/repositories/<domain>/`:

```
lib/repositories/<domain>/
  <Domain>Repository.ts         — интерфейс (контракт)
  Supabase<Domain>Repository.ts — реализация на Supabase
  Postgres<Domain>Repository.ts — реализация на Drizzle/PostgreSQL (если есть)
  index.ts                      — какая реализация активна
```

`lib/repositories/index.ts` — корневой barrel, реэкспортирует все домены, чтобы вызывающий
код всегда импортировал из `@/lib/repositories`, не зная о структуре папок.

### Существующие Repository

| Домен | Таблица(ы) | Postgres-реализация |
|---|---|---|
| `appSettingsRepository` | `app_settings` | есть |
| `activityRepository` | `activity_events` | есть |
| `avatarStorageRepository` | Storage (не таблица) | нет — только локальная ФС |
| `emailOtpRepository` | `email_otp_codes` | есть |
| `playerRepository` | `players` | есть |
| `seasonRepository` | `seasons` | есть |
| `achievementRepository` | `player_achievements` | есть |
| `tournamentRepository` | `tournaments` | есть |
| `registrationRepository` | `registrations` | есть |
| `tournamentLiveStateRepository` | `tournament_live_entries` + `tournament_player_eliminations` | есть |
| `resultRepository` | `results` | есть |

`avatarStorageRepository` — не работает с БД вообще, это доступ к файловому хранилищу
(см. раздел 5). У него нет Postgres/Supabase развилки — сейчас единственная активная
реализация локальная, `SupabaseAvatarStorageRepository` остаётся в коде для отката.

### Переключение через `DATABASE_PROVIDER`

Каждый `index.ts` (кроме `avatar-storage`) устроен одинаково:

```ts
const usePostgres = process.env.DATABASE_PROVIDER === "postgres";

export const xxxRepository: XxxRepository = usePostgres
  ? new PostgresXxxRepository()
  : new SupabaseXxxRepository();
```

`DATABASE_PROVIDER` читается из окружения процесса на старте. Значение `"postgres"`
переключает **все** домены сразу на PostgreSQL; любое другое значение (или отсутствие
переменной) — на Supabase. Развилка на уровне всего приложения, не по доменам — нет
режима "часть таблиц на Postgres, часть на Supabase" (кроме переходного периода самой
миграции, см. `docs/MIGRATION_PROGRESS.md`).

### Почему Feature Layer никогда не обращается к БД напрямую

Если бы `features/*.ts` импортировал `@supabase/supabase-js` или Drizzle-клиент
напрямую, переключение провайдера потребовало бы находить и переписывать каждый такой
вызов. Вместо этого Feature знает только о контракте (`PlayerRepository`,
`TournamentRepository` и т.д.) — реализация подставляется через `index.ts`,
Feature-код не меняется вообще.

Единственные осознанные исключения, где прямой доступ к Supabase всё ещё есть:
- Realtime-подписки в клиентских компонентах (`app/page.tsx`, `app/tournaments/page.tsx`)
  — не CRUD-операция, WS-канал без аналога в Postgres (см. раздел 9);
- `scripts/backfill-postgres.mjs`, `scripts/migrate-local-avatars.mjs` — разовые
  миграционные инструменты, намеренно вне графа Route/Feature/Repository (см. раздел 4).

### Как добавить новый Repository

1. Спроектировать интерфейс в `lib/repositories/<domain>/<Domain>Repository.ts` —
   методы 1:1 с реальными операциями, без бизнес-логики.
2. Добавить таблицу в Drizzle-схему (`lib/db/schema/<domain>.ts`), если нужна
   PostgreSQL-реализация.
3. Реализовать `Supabase<Domain>Repository` (и `Postgres<Domain>Repository`, если БД
   уже мигрирует).
4. `index.ts` — тернарник на `DATABASE_PROVIDER`, как у остальных доменов (или простая
   инстанциация, если второй бэкенд пока не существует — не заводить переключатель
   заранее под гипотетическое будущее).
5. Добавить `export * from "./<domain>"` в `lib/repositories/index.ts`.
6. Вызывающий код (Feature) импортирует только из `@/lib/repositories`.

---

## 3. PostgreSQL

### Drizzle schema как источник истины

`lib/db/schema/*.ts` — единственное место, описывающее структуру таблиц PostgreSQL:
колонки, типы, `CHECK`-constraints, индексы, внешние ключи. Миграции генерируются из
этой схемы, а не пишутся руками. Если реальная база и `schema.ts` расходятся — это
баг, который нужно закрыть новой миграцией, а не считать нормой.

`lib/db/schema/index.ts` реэкспортирует все домены; `lib/db/client.ts` — ленивый
Drizzle-клиент поверх `postgres-js` (сырой TCP до Postgres), не бросающий исключение
до первого реального запроса — чтобы окружения без `DATABASE_URL` не падали при
простом импорте модуля.

### Миграции

- `npm run db:generate` — сравнивает `lib/db/schema/*.ts` с последним снэпшотом
  (`lib/db/migrations/meta/`) и генерирует новый `NNNN_*.sql` в `lib/db/migrations/`.
- `npm run db:migrate` — применяет ещё не применённые миграции. Это **не**
  `drizzle-kit migrate` (у него баг: реальная ошибка подключения/применения молча
  проглатывается, прогресс-бар выглядит одинаково и для успеха, и для провала).
  Вместо этого `scripts/migrate.mjs` вызывает `migrate()` из
  `drizzle-orm/postgres-js/migrator` напрямую и печатает настоящую ошибку при сбое.
- Список применённых миграций хранится в самой базе, в служебной таблице
  `drizzle.__drizzle_migrations`.

### `DATABASE_URL`

Строка подключения к PostgreSQL (`postgres://user:pass@host:5432/db`). На VPS
PostgreSQL живёт в отдельном контейнере (`poker-clock-db`, общая инфраструктура с
проектом poker-clock — см. раздел 7), хост в строке подключения — `poker-clock-db`,
резолвится только внутри Docker-сети `poker-clock_default`. Для доступа с хоста VPS
напрямую (не из контейнера) используется `127.0.0.1:5432` — этот порт также
опубликован наружу контейнера, но только на loopback.

### `DATABASE_PROVIDER`

`"postgres"` — все Repository (кроме Storage) используют PostgreSQL.
Любое другое значение/не задано — Supabase. См. раздел 2.

### Текущее состояние перехода

`re-raise` (единственный живой продовый контейнер на VPS — сайт `re-raise.ru` и
точка входа Telegram Mini App) работает с `DATABASE_PROVIDER=postgres`. Backfill
данных завершён (см. раздел 4), Repository Layer полностью реализован для
PostgreSQL по всем 11 доменам. Второго живого продового деплоя (Vercel/Supabase)
нет — см. исправление в начале документа и раздел 8.

---

## 4. Backfill

### Зачем существует

`scripts/backfill-postgres.mjs` — разовый (но безопасно переисполняемый) перенос
существующих данных из Supabase в PostgreSQL. Нужен один раз при первом заполнении
PostgreSQL реальными данными и остаётся в репозитории на случай, если понадобится
повторить перенос (например, после отката и повторного включения `DATABASE_PROVIDER`).

### Как работает

Сознательно **обходит** Repository Layer: читает через `@supabase/supabase-js`
напрямую, пишет через `drizzle-orm/postgres-js` напрямую. Таблицы Drizzle
передекларированы локально внутри скрипта, а не импортированы из `lib/db/schema` —
plain `node` не умеет резолвить относительные импорты без расширения файла так, как
это делает бандлер Next.js.

Все id при переносе сохраняются как есть (никакого ремаппинга) — поэтому все внешние
ключи между таблицами остаются согласованными автоматически, без постобработки.

### Порядок переноса (важен из-за внешних ключей)

```
app_settings → seasons → players → tournaments → registrations → results →
tournament_live_entries → tournament_player_eliminations →
activity_events → email_otp_codes → player_achievements
```

`players`/`tournaments` переносятся раньше всего, что на них ссылается.
`activity_events`/`email_otp_codes`/`player_achievements` — в конце, так как все три
имеют внешний ключ на `players`.

### Идемпотентность

Стратегия выбирается по природе таблицы:
- **Естественный бизнес-ключ есть** (`app_settings.key`, составной ключ
  `player_achievements`) — `onConflictDoUpdate`: повторный прогон просто
  переприменяет те же значения.
- **ID используется как внешний ключ из других таблиц** (`players`, `tournaments`,
  `registrations`, `results`, `tournament_live_entries`) — `onConflictDoNothing(id)`:
  id не меняется, повторная вставка той же строки — no-op.
- **Составной естественный ключ, нет суррогатного id** (`tournament_player_eliminations`)
  — `onConflictDoNothing([tournament_id, player_id])`.
- **Суррогатный uuid PK, на него никто не ссылается** (`activity_events`,
  `email_otp_codes`) — табличный guard: если в PostgreSQL уже есть хоть одна строка,
  вся таблица пропускается целиком (а не построчно), плюс постраничное чтение через
  `.range()` — обычный `select()` в Supabase/PostgREST молча режет ответ на первых
  1000 строк.

### Как запускать

```bash
npm run backfill:postgres                                 # все 11 доменов
npm run backfill:postgres -- --only=app_settings,seasons   # выбранные таблицы
```

`--only` принимает список через запятую; порядок выполнения всегда пересобирается в
FK-safe последовательность выше, независимо от того, в каком порядке таблицы
перечислены во флаге.

Требует `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` в
окружении. На VPS запускается через одноразовый `migrator`-образ (см. раздел 12).

---

## 5. Storage (аватары)

### Почему не Supabase Storage

Тот же принцип, что уже применён в поker-clock: для одного VPS с одним приложением
объектное хранилище (S3/MinIO) — избыточная инфраструктура. Обычная файловая система
VPS плюс nginx для раздачи статики полностью закрывают потребность, без лишнего
сервиса, лишнего контейнера и лишней внешней зависимости.

### Как устроено локальное хранение

`LocalAvatarStorageRepository` (`lib/repositories/avatar-storage/LocalAvatarStorageRepository.ts`)
пишет байты напрямую на диск через `fs/promises`, без сети:

```ts
upload(filePath, bytes, contentType) → mkdir + writeFile под STORAGE_ROOT/filePath
getPublicUrl(filePath) → `${NEXT_PUBLIC_APP_URL}/storage/avatars/${filePath}`
```

`filePath` строится вызывающим кодом (`lib/avatar-sync.ts`, аплоад-роут) в виде
`{playerId}/avatar.{ext}` или `{playerId}/telegram-avatar.{ext}`. Расширение
(`jpg`/`png`/`webp`) выводится из `Content-Type` через
`contentTypeToExtension()` — в отличие от Supabase Storage (которое помнит
Content-Type с момента загрузки независимо от имени объекта), nginx при раздаче
статики определяет `Content-Type` по расширению файла, поэтому оно обязано быть в
имени.

`AvatarStorageRepository` — интерфейс из двух методов (`upload`, `getPublicUrl`);
`delete`/`exists` в нём нет — приложение никогда не удаляет аватары (даже при
удалении игрока), это существующее ограничение, не следствие перехода на локальное
хранилище.

### Где физически лежат файлы на VPS

```
/opt/reraise/storage/avatars/{playerId}/avatar.{jpg|png|webp}
/opt/reraise/storage/avatars/{playerId}/telegram-avatar.{jpg|png|webp}
```

Это bind mount (`docker-compose.yml`: `./storage:/app/public/storage`), не именованный
Docker volume — файлы физически живут вне контейнера, переживают
`docker compose build`/`down`, и тот же путь на хосте одновременно пишет контейнер
приложения и читает nginx напрямую. Владелец файлов — `uid:gid 1001:1001`, тот же, под
которым в контейнере работает Next.js (`nextjs`, non-root).

### Как nginx их раздаёт

```nginx
location ^~ /storage/ {
    alias /opt/reraise/storage/;
    expires 30d;
    add_header Cache-Control "public, immutable";
    access_log off;
}
```

Раздача полностью в обход Node — nginx читает файл с диска и отдаёт напрямую.
`client_max_body_size 20m` на этом же сервере — под лимит загрузки аватара в
приложении (проверка размера файла — в самом upload-роуте).

Отдельно, без изменений, продолжают работать legacy-прокси на Supabase
(`location /supabase/{realtime,rest,auth,storage}/v1/`) — см. раздел 9.

---

## 6. Авторизация

У сайта два независимых способа установить личность пользователя.

### Email OTP

`lib/email-otp.ts` + `emailOtpRepository` — генерация одноразового кода, хранение в
`email_otp_codes` (с TTL и лимитом попыток), отправка письма через Resend
(`lib/resend.ts`). После успешной проверки кода выпускается HMAC-сессия (см. ниже).

### Telegram login

`features/auth.ts` / `features/auth-server.ts` — проверка `initData` из Telegram
WebApp SDK: HMAC-SHA256 подпись данных секретом, производным от `TELEGRAM_BOT_TOKEN`
(алгоритм Telegram, не наш). После проверки — `playerRepository.findByTelegramId` /
`create`, синхронизация аватара (`lib/avatar-sync.ts`).

### HMAC-сессия

`lib/telegram-web-session.ts` — `signSession(playerId)` / `verifySession(value)`:
HMAC-SHA256 над `playerId` с секретом `SESSION_SECRET`, формат `playerId.mac` (hex).
Хранится в cookie `reraise_session` (httpOnly). Это единственное место в проекте, где
реализован этот алгоритм — используется и обычными API-роутами (`/api/auth/me` и
т.д.), и `middleware.ts`.

### `middleware.ts` и доступ в admin

Гейт `/api/admin/:path*`. Порядок проверки:

```
если есть заголовок x-telegram-init-data
    проверить Telegram HMAC (verifyTelegramInitData)
иначе если есть cookie reraise_session
    проверить через verifySession (тот же lib/telegram-web-session.ts)
иначе
    401
```

Это строгий `if / else if`, без отката на второй способ при провале первого: если
`x-telegram-init-data` присутствует, но не проходит проверку, ответ — `401`, cookie
при этом не рассматривается вообще, даже если она валидна.

Оба способа сходятся в одну точку: `playerRepository.findByTelegramId(...)` или
`playerRepository.findById(...)`, дальше — единственная, общая для обоих путей,
проверка `player.role !== "admin"`.

**Почему middleware теперь использует Repository Layer.** До этого middleware нёс
собственный инлайновый Supabase-клиент, потому что Next.js Middleware по умолчанию
выполняется в Edge Runtime, где недоступны Node-специфичные API (`net`/`tls`,
нужные `postgres-js` для сырого TCP-подключения к PostgreSQL) и `Buffer`/`crypto` из
`node:crypto`. Это работало, но означало последнюю в проекте прямую зависимость от
Supabase Database в обход Repository Layer.

Next.js (текущая версия, 16.1.6) поддерживает **Node.js Middleware** —
`export const config = { runtime: "nodejs", matcher: [...] }` в `middleware.ts`
переключает файл на выполнение в обычном Node.js-процессе вместо Edge-изолята.
После этого `middleware.ts` свободно импортирует `playerRepository` (в том числе
`PostgresPlayerRepository`, `postgres-js`, весь Drizzle) и настоящий `verifySession` —
без собственных дублирующих реализаций. Middleware теперь так же уважает
`DATABASE_PROVIDER`, как и весь остальной код, и не является отдельным источником
правды о структуре БД.

---

## 7. Инфраструктура

### Docker

`Dockerfile` — многостадийная сборка:
- `deps` — установка зависимостей;
- `builder` — `next build` (включает статическую генерацию `/api/leaderboard` — см.
  раздел 9 про известное ограничение build-time снэпшота);
- `migrator` — расширяет `deps`, не `builder` (не требует продовых Supabase-ключей
  только чтобы прогнать Drizzle-миграции); не входит в обычный `docker build`, собирается
  только явно (`--target migrator`) и используется для разовых операционных задач
  (миграции схемы, backfill, миграция аватаров) — не запускается сам по себе, только
  вручную через `docker run` с нужными для конкретной задачи флагами (`--network`,
  `-v`);
- `runner` — финальный образ (`node server.js`, standalone-вывод Next.js,
  non-root пользователь `nextjs`, uid/gid 1001).

### docker-compose.yml

Один сервис — `app`. Ключевые моменты:
- `volumes: ./storage:/app/public/storage` — bind mount для аватаров (раздел 5);
- `networks: default: name: poker-clock_default external: true` — контейнер
  подключается к уже существующей внешней сети, где живёт PostgreSQL, вместо
  создания своей собственной сети по умолчанию;
- `environment` включает `DATABASE_PROVIDER`/`DATABASE_URL` наравне с
  Supabase/Telegram/Resend/Google-переменными — на этом деплое одновременно
  сконфигурированы оба провайдера (Postgres активен, Supabase-креды остаются, так
  как Storage/Realtime/откат всё ещё их используют);
- порт публикуется только на `127.0.0.1:3002` — не потому что это тестовый стенд, а
  потому что весь публичный трафик идёт через nginx (см. ниже), напрямую наружу
  контейнер не смотрит.

### PostgreSQL

Отдельная, не принадлежащая ни одному приложению инфраструктура —
`/opt/postgres/docker-compose.yml` на VPS. Контейнер `poker-clock-db` (имя и volume
унаследованы от проекта poker-clock, который делит эту базу с re-raise как общий
ресурс сервера). Внутри — база `reraise`, пользователь `reraise`. Слушает
`127.0.0.1:5432` (для инструментов с хоста) и доступен внутри Docker-сети
`poker-clock_default` по имени `poker-clock-db`.

### Сеть контейнеров

`poker-clock_default` — общая внешняя Docker-сеть. И `poker-clock-db`, и `app`
(re-raise), и любые одноразовые `migrator`-контейнеры подключаются к ней явно
(`--network poker-clock_default` для разовых `docker run`, `networks:` в
`docker-compose.yml` для постоянного сервиса), чтобы резолвить друг друга по имени
контейнера.

### nginx

Терминирует TLS для `re-raise.ru`/`www.re-raise.ru` и проксирует `location /` на
`127.0.0.1:3002` — этот Docker-контейнер является настоящим продовым бэкендом сайта
(не параллельный тестовый стенд). Дополнительно:
- `location ^~ /storage/` — аватары напрямую с диска (раздел 5);
- `location /supabase/{realtime,rest,auth,storage}/v1/` — прокси на реальный домен
  Supabase-проекта, для обратной совместимости старых ссылок/для Realtime
  (раздел 9).

### Деплой на VPS

```bash
cd /opt/reraise
git pull
docker compose build app
docker compose up -d app
```

Для разовых задач (миграции схемы, backfill, скрипт переноса аватаров) —
пересборка `migrator`-образа и запуск через `docker run` с нужными флагами (см.
раздел 12), без изменения `docker-compose.yml`.

---

## 8. Mini App и сайт — один деплой, не два

**Исправлено 2026-09** (см. заголовок документа): более ранняя версия этого
раздела утверждала, что сайт `re-raise.ru` и Telegram Mini App — два независимых
живых деплоя (VPS+PostgreSQL против Vercel+Supabase), и приводила в подтверждение
`getWebhookInfo`/`getChatMenuButton`, якобы указывающие на
`reraise-miniapp.vercel.app`. Продакт-оунер подтвердил, что это неверно: живого
Vercel-деплоя ReRaise нет. И сайт, и Telegram Mini App обслуживаются одним и тем
же контейнером `re-raise` на VPS с `DATABASE_PROVIDER=postgres` — общий код, общая
БД, общее окружение, без какого-либо провайдерного/деплойного разделения между
ними.

`Supabase<Domain>Repository`-реализации остаются в коде для всех доменов (см.
раздел 2) как legacy/compatibility-код — не как признак второго активного
провайдера или деплоя.

---

## 9. Что ещё зависит от Supabase

Честно, по состоянию на сейчас:

1. **Supabase Realtime** — `app/page.tsx`, `app/tournaments/page.tsx` подписываются
   на `postgres_changes` по таблицам `registrations`/`tournaments` **в Supabase**,
   напрямую через `@supabase/supabase-js` (не через Repository — WS-канал не имеет
   аналога в PostgreSQL). Поскольку сайт пишет в PostgreSQL, а не в Supabase, записи
   в Supabase этих таблиц с сайта больше не меняются — push-уведомления о
   собственных действиях пользователей сайта через Realtime не приходят (данные при
   этом корректны, просто без живого обновления без перезагрузки страницы).
2. ~~Telegram Mini App (отдельный деплой на Vercel, целиком на Supabase)~~ —
   исправлено, такого деплоя нет, см. раздел 8. Telegram Mini App обслуживается
   тем же контейнером `re-raise` на PostgreSQL, что и сайт.
3. **`SupabaseXxxRepository` реализации остаются в коде** для всех 11 доменов и для
   Storage — не удалены, доступны для отката одной правкой `index.ts`. Это не
   активная зависимость рантайма сайта, но код, который по-прежнему знает о
   Supabase API.
4. **Legacy nginx-прокси** `/supabase/{realtime,rest,auth,storage}/v1/` на
   `re-raise.ru` — не удалены; нужны Realtime (пункт 1) и как путь совместимости,
   пока не принято решение полностью отключить Supabase-сторону.
5. **Build-time генерация `/api/leaderboard`** — этот роут статический с
   `revalidate = 60`; `DATABASE_PROVIDER` передаётся в контейнер только как
   runtime-переменная (`environment:`), не как build-arg. На момент `next build`
   `process.env.DATABASE_PROVIDER` не задан → первый снэпшот страницы после каждой
   пересборки образа берётся из Supabase, а не PostgreSQL. Самоисправляется после
   первого окна ревалидации (60 секунд + один запрос), но при каждой новой сборке
   образа повторяется заново.

Данные аватаров (`players.custom_avatar_url`) на текущий момент **не** зависят от
Supabase — миграция существующих файлов в локальное хранилище завершена, все записи
указывают на `re-raise.ru/storage/...`. Supabase Storage bucket и legacy-прокси при
этом не удалены (решение сознательно отложено).

---

## 10. Известные ограничения

Собрано в одном месте, чтобы не искать по истории переписки:

1. **Realtime не переведён на PostgreSQL** — см. раздел 9, п. 1. Нет polling/LISTEN-NOTIFY
   замены, живые обновления UI зависят от Supabase.
2. **Build-time снэпшот `/api/leaderboard`** — см. раздел 9, п. 5. `DATABASE_PROVIDER`
   не проброшен как Docker build-arg.
3. **Пул соединений `lib/db/client.ts`** — `postgres-js` создаётся без явного `max`
   (библиотечный дефолт — 10 на инстанс). Не проблема для одного долгоживущего
   контейнера на VPS; при повторном переходе на serverless/много-инстансный хостинг
   для Postgres-пути это нужно будет явно ограничить.
4. **`AvatarStorageRepository` не имеет DATABASE_PROVIDER-подобного переключателя** —
   Storage всегда был отдельной осью от выбора БД; переключение между локальной ФС и
   Supabase — правка одной строки в `index.ts`, не env-переменная.
5. **Нет автоматического резервного копирования** `/opt/reraise/storage/` — та же
   нерешённая задача, что и в референсном проекте poker-clock; нужен отдельный
   cron/скрипт, если он появится.
6. **Три vitest-сьюта не запускаются** (`admin-delete-player`,
   `admin-remove-participant`, `waitlist` — тесты в `features/__tests__/`) —
   мокают `@/lib/supabase` напрямую, хотя код давно ходит через `@/lib/repositories`;
   `server-only` не резолвится в текущей vitest-конфигурации. Нет regression-покрытия
   именно на этой логике.
7. **`docker-compose.postgres.yml` в репозитории описывает устаревшую топологию**
   (собственный `db`-сервис на порту 5433) — реальный PostgreSQL живёт в
   `/opt/postgres`, отдельно от этого файла. Разовые инструменты (миграции, backfill,
   перенос аватаров) запускаются через `docker build --target migrator` +
   ручной `docker run` с явными `--network`/`-v`, не через этот compose-файл.
   Актуальная документация по PostgreSQL-инфраструктуре — раздел 7 этого документа,
   не комментарии внутри `docker-compose.postgres.yml`.
8. **`avatarStorageRepository.delete()`/`exists()` не существует** — приложение
   никогда не удаляет файлы аватаров, даже при удалении игрока. Не баг локального
   хранилища, унаследовано от прежнего поведения на Supabase Storage.
9. **Миграционные скрипты (`scripts/backfill-postgres.mjs`,
   `scripts/migrate-local-avatars.mjs`) намеренно не используют Repository Layer** и
   держат собственные копии структуры таблиц/маппинга content-type → расширение.
   При изменении соответствующих частей `lib/db/schema/*.ts` или
   `lib/repositories/avatar-storage/contentTypeToExtension.ts` эти копии нужно
   обновлять вручную — они не подхватят изменение автоматически.

---

## 11. Как правильно развивать проект дальше

- **Новая таблица** — сначала описать в `lib/db/schema/<domain>.ts` (источник
  истины), затем `npm run db:generate`, проверить сгенерированный SQL, только потом
  применять миграцию на VPS.
- **Новый Repository** — см. раздел 2. Интерфейс — контракт, реализация — тонкая,
  бизнес-логика остаётся в Feature. Не создавать `DATABASE_PROVIDER`-развилку заранее,
  если второй backend ещё не существует физически — это мёртвый код.
- **Новая миграция схемы** — только через `drizzle-kit generate`, не руками. Одна
  миграция — одно осмысленное изменение (не смешивать несвязанные правки в одном
  файле). Применять на VPS через `migrator`-образ, не подключаться к продовой базе
  вручную для DDL.
- **Расширение backfill** — если добавляется новый домен, обязательно продумать его
  место в FK-порядке (раздел 4) и выбрать стратегию идемпотентности исходя из того,
  ссылается ли что-то на его id извне.
- **Новый домен целиком** (таблица + Repository + Feature + API) — паттерн:
  маленький, изолированный домен без внешних зависимостей — самый безопасный
  первый шаг; домены с широким blast radius (как `players`) переводить на новую
  инфраструктуру последними, когда паттерн уже обкатан.
- Общий принцип на всех уровнях: **не менять архитектуру ради одной задачи**. Если
  Route Handler может обойтись без Feature — это подозрительно, а не повод пропустить
  слой; если Repository начинает решать, что можно/нельзя — это бизнес-логика,
  которая утекла не на свой уровень.

---

## 12. Полезные команды

### Разработка

```bash
npm run dev              # локальный сервер разработки
npm run build             # продакшн-сборка
npm run lint               # eslint
npm run test                # vitest
```

### PostgreSQL / Drizzle

```bash
npm run db:generate                         # сгенерировать миграцию из schema.ts
npm run db:migrate                           # применить непринятые миграции
npm run db:push                              # прямой push схемы (без миграций, для локальной разработки)
npm run db:studio                            # Drizzle Studio
```

### Backfill (перенос данных Supabase → PostgreSQL)

```bash
npm run backfill:postgres                                   # все домены
npm run backfill:postgres -- --only=app_settings,seasons     # выбранные домены
```

### Миграция аватаров (Supabase Storage → локальная ФС)

```bash
node scripts/migrate-local-avatars.mjs --dry-run              # без записи, только отчёт
node scripts/migrate-local-avatars.mjs --only=<playerId>       # один игрок
node scripts/migrate-local-avatars.mjs                          # все игроки
```

### На VPS (через одноразовый migrator-образ)

```bash
# Пересборка migrator-образа после git pull
docker build --target migrator -t re-raise-migrator:latest .

# Применить миграции схемы
docker run --rm --network poker-clock_default --env-file .env.postgres \
  re-raise-migrator:latest npm run db:migrate

# Backfill / перенос аватаров — тот же образ, нужный скрипт вместо CMD;
# перенос аватаров дополнительно требует bind mount на реальное хранилище:
docker run --rm --network poker-clock_default -v /opt/reraise/storage:/app/storage \
  --env-file .env.postgres re-raise-migrator:latest node scripts/migrate-local-avatars.mjs --dry-run
```

### Деплой сайта

```bash
cd /opt/reraise
git pull
docker compose build app
docker compose up -d app
```
