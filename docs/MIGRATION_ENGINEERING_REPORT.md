# Poker App: развёртывание как второго проекта на существующей VPS-инфраструктуре ReRaise

**Редакция 2.** Первая редакция этого документа описывала миграцию ReRaise на VPS как обобщённый процесс «с нуля» (подготовка сервера, установка Docker, PostgreSQL, nginx, GitHub Actions). После её прочтения стало ясно, что для Poker App это неверная постановка задачи — VPS, Docker, PostgreSQL, nginx и CI/CD **уже существуют и уже работают** (на них сейчас крутится ReRaise). Poker App не мигрирует на VPS — он **разворачивается вторым, независимым проектом** на уже готовой инфраструктуре.

## Главный принцип

> ReRaise — эталонная (референсная) реализация. Задача этого документа — ответить на вопрос «как максимально повторить инфраструктуру ReRaise для Poker App», а не «как построить инфраструктуру VPS с нуля».

Следствия этого принципа, действующие на всём протяжении документа:

- Если что-то у ReRaise уже решено и работает — используется как есть, без переосмысления.
- Любое отличие Poker App от инфраструктуры ReRaise должно быть **осознанным** и иметь **явное техническое обоснование**, зафиксированное в этом документе или в коде.
- Poker App добавляется на сервер **как второй независимый проект**. Ничего в существующей инфраструктуре ReRaise не меняется, не трогается и не рискуется ради удобства Poker App.

Смежные документы этого же репозитория, описывающие саму эталонную реализацию в деталях: [`docs/architecture.md`](./architecture.md), [`docs/MIGRATION_PROGRESS.md`](./MIGRATION_PROGRESS.md), [`docs/POSTGRES_MIGRATION_AUDIT.md`](./POSTGRES_MIGRATION_AUDIT.md), [`docs/REPOSITORY_LAYER_ARCHITECTURE.md`](./REPOSITORY_LAYER_ARCHITECTURE.md), [`docs/ARCHITECTURE_RULES.md`](./ARCHITECTURE_RULES.md). Этот документ не дублирует их содержание — он показывает, что из уже построенного переиспользуется буквально, а что требует адаптации под второй проект на том же сервере.

---

## Что запрещено на протяжении всего развёртывания

Явный список, повторяемый здесь один раз, но действующий на каждом этапе ниже:

- ❌ Ломать ReRaise — ни один шаг разворачивания Poker App не должен вызвать простой или деградацию `re-raise.ru`.
- ❌ Менять PostgreSQL ReRaise — ни схему `reraise`, ни сам контейнер `poker-clock-db` как сервис.
- ❌ Менять `deploy.yml`/`maintenance.yml` ReRaise.
- ❌ Менять `docker-compose.yml` ReRaise.
- ❌ Менять существующую конфигурацию nginx для `re-raise.ru`.

Всё, что нужно для Poker App — **новые** файлы/сервисы/базы/`server`-блоки рядом с существующими, никогда не правки существующих.

---

## 1. Анализ Poker App — обязателен до начала любых работ

**Это ещё не выполнено.** Раздел ниже — чек-лист аудита, который нужно провести на реальном коде `C:\Users\KRESTALL\poker-app`, прежде чем начинать что-либо из этапов 2–8. Каждый пункт сравнивает Poker App с ReRaise как эталоном; результат аудита определяет, какие адаптации на следующих этапах будут не «максимальным повторением ReRaise», а обоснованным отличием.

### 1.1 Repository Layer

- Есть ли в Poker App вообще разделение Route/Feature/Repository, или доступ к Supabase раскидан по коду напрямую (как это было у ReRaise до миграции, см. `docs/REPOSITORY_LAYER_ARCHITECTURE.md`, раздел 1.1)?
- Если Repository Layer есть (например, унаследован при форке от общего кода с ReRaise) — насколько его структура совпадает: та же ли форма `lib/repositories/<domain>/{Interface,SupabaseImpl,Postgres?,index}.ts`?
- Если Repository Layer отсутствует — это **отдельный, предшествующий этой миграции этап** (полностью аналогичный тому, что ReRaise проходил до появления Postgres, раздел 5.2 в референсном материале ниже), не часть развёртывания инфраструктуры. Разворачивать VPS-инфраструктуру под проект без Repository Layer можно, но переключение на PostgreSQL (`DATABASE_PROVIDER`) для него нельзя.

### 1.2 Docker / сборка

- Есть ли в Poker App `Dockerfile`, `docker-compose.yml`, `.dockerignore` вообще? Если да — сравнить построчно со стадиями ReRaise (раздел 2.2 ниже): совпадает ли базовый образ (`node:20-alpine`), стратегия standalone-вывода Next.js, non-root пользователь.
- Использует ли Poker App `output: "standalone"` в `next.config.ts`? Если нет — потребуется добавить (иначе Dockerfile ReRaise неприменим напрямую).
- Есть ли в Poker App роуты со статической генерацией (ISR/`revalidate`), реально исполняющиеся во время `next build` и требующие прод-кредов на этапе сборки (как `/api/leaderboard` у ReRaise, из-за чего у ReRaise появилась отдельная `migrator`-стадия, наследующая `deps`, а не `builder`)? Если таких роутов нет — `migrator`-стадия Poker App может быть проще, без этого разделения.

### 1.3 База данных

- Какая версия Supabase-схемы у Poker App? Сколько таблиц, какие домены?
- Есть ли уже Drizzle-схема (`lib/db/schema/*.ts`)? Если Poker App — форк ReRaise до Postgres-миграции, схема может частично совпадать по структуре доменов (`players`, `tournaments`, `registrations`...), но её всё равно нужно сверить 1:1 с реальными таблицами Poker App, а не считать идентичной ReRaise бездоказательно.
- Отличается ли набор полей/таблиц от ReRaise — какие есть только у Poker App, каких из ReRaise у него нет?

### 1.4 Storage / файлы

- Использует ли Poker App Supabase Storage? Для чего именно (аватары, как у ReRaise, или что-то ещё — например, другие медиа-файлы)?
- Есть ли уже `AvatarStorageRepository`-подобный интерфейс, или доступ к Storage раскидан по коду?

### 1.5 Middleware / авторизация

- В каком Runtime выполняется `middleware.ts` у Poker App — Edge (дефолт) или уже Node.js?
- Какой механизм подтверждения личности используется — Telegram initData, email OTP, что-то ещё? Совпадает ли с ReRaise хотя бы по форме (HMAC-сессия в cookie), или это принципиально другой механизм?

### 1.6 CI/CD

- Есть ли у Poker App вообще какой-либо CI (GitHub Actions или другой)? Если да — что именно он проверяет.
- Какой хостинг сейчас использует Poker App для деплоя (подтверждено: Vercel + Supabase, согласно вводным) — есть ли зависимости от Vercel-специфичных фич (Vercel Cron, Vercel KV, Edge Config), которых не будет на VPS?

### 1.7 Telegram / внешние интеграции

- Есть ли у Poker App Telegram-бот с собственным меню/webhook — если да, на каком домене он сейчас настроен, и (см. раздел 8 референсного материала, «BotFather») — не забыть впоследствии сверить актуальный URL при смене адреса.
- Есть ли другие внешние интеграции (Google Sheets, email-провайдер и т.д.), специфичные для Poker App и не имеющие аналога у ReRaise?

### Итог этапа 1

Результат аудита — таблица «ReRaise vs Poker App» по каждому из шести пунктов выше, с явным выводом по каждой строке: **совпадает / совпадает частично / отсутствует / принципиально другое**. Только после того, как эта таблица заполнена по реальному коду Poker App, есть смысл идти на этап 2 — иначе последующие «максимально повторить ReRaise» решения будут приниматься вслепую.

---

## 2. Этап 1 — изучить (не менять) существующую инфраструктуру ReRaise

Цель этого этапа — понять, что у ReRaise уже построено и что из этого пригодно для повторного использования Poker App. Ничего не редактируется. Ниже — сжатый разбор каждого компонента с явной пометкой, что именно переиспользуется буквально, а что — как паттерн (по аналогии, с новыми значениями).

### 2.1 PostgreSQL — переиспользуется контейнер, не паттерн

Реальный PostgreSQL живёт в `/opt/postgres` на VPS, контейнер `poker-clock-db` (общий ресурс сервера, изначально заведённый под проект Poker Clock, теперь также обслуживающий базу `reraise`). Слушает `127.0.0.1:5432` с хоста, резолвится по имени `poker-clock-db` внутри Docker-сети `poker-clock_default`.

**Для Poker App: тот же контейнер, новая база данных внутри него** (этап 4 ниже). Файл `docker-compose.postgres.yml` в репозитории ReRaise **не описывает** эту реальную топологию (это более ранняя, локальная итерация, оставленная для разработки) — не использовать его как образец топологии.

### 2.2 Dockerfile — переиспользуется как паттерн, с параметризацией

`reraise-miniapp/Dockerfile` — 4 стадии:

```
deps      → npm ci
builder   → next build (включая build-time исполнение /api/leaderboard из-за revalidate)
migrator  → наследует deps, не builder; CMD npm run db:migrate
runner    → non-root (uid/gid 1001), standalone-вывод, EXPOSE 3000
```

Для Poker App: тот же 4-стадийный шаблон **буквально**, с точностью до структуры. Единственное, что нужно решить по результатам аудита (1.2) — нужна ли Poker App вообще отдельная `migrator`-стадия, наследующая `deps` вместо `builder` (это решение ReRaise было продиктовано конкретно build-time-исполнением `/api/leaderboard`; если у Poker App нет ISR-роута с похожим побочным эффектом, `migrator` может просто наследовать `builder` без вреда — это не обязано быть 1:1 повторением, если условие, вызвавшее решение у ReRaise, отсутствует).

### 2.3 docker-compose.yml — переиспользуется как паттерн, значения новые

`reraise-miniapp/docker-compose.yml` — один сервис `app`:

```yaml
services:
  app:
    build: {context: ., args: {NEXT_PUBLIC_*, SUPABASE_SERVICE_ROLE_KEY}}
    image: re-raise:latest
    container_name: re-raise
    restart: unless-stopped
    ports: ["127.0.0.1:3002:3000"]
    volumes: ["./storage:/app/public/storage"]
    environment: [...]
    healthcheck: {test: wget --spider /api/health, interval: 30s, timeout: 10s, retries: 3, start_period: 30s}
networks:
  default: {name: poker-clock_default, external: true}
```

Для Poker App меняются буквально шесть вещей (`image`, `container_name`, project name/рабочая директория, порт, `storage`-путь, `environment`-значения) — форма файла, healthcheck, restart policy, подключение к `poker-clock_default` остаются идентичными (детали — этап 4).

### 2.4 nginx — переиспользуется паттерн location-блоков, новый server block

Текущий конфиг `re-raise.ru` (не хранится в этом репозитории, живёт на VPS): TLS-терминация, `location /` → `proxy_pass 127.0.0.1:3002`, `location ^~ /storage/` → `alias` на диск с `expires 30d`, legacy-прокси на Supabase. Для Poker App — не редактировать этот файл, а добавить **отдельный** `server` block (детали — этап 7).

### 2.5 GitHub Actions — `deploy.yml` и `maintenance.yml` как шаблон

`deploy.yml` ReRaise: `checks` (lint + `tsc --noEmit`, отменяемый) → `deploy` (SSH, `set -Eeuo pipefail`, проверка SHA → сборка → проверка image ID → пересоздание только `app` → проверка контейнера → поллинг running+healthy → HTTPS smoke-тест `/api/health`+`/api/settings`+`/`+`/api/leaderboard` → `docker image prune`).

`maintenance.yml` ReRaise: еженедельно (понедельник 03:00 UTC, после воскресных турниров), та же concurrency-группа `production-deploy`, что и `deploy` (чтобы уборка и деплой не пересеклись на одном VPS), безопасно ограниченные команды (`docker builder prune --filter until=72h`, `docker image prune` только dangling, `journalctl --vacuum-time=14d`, `npm cache clean`), финальная проверка health.

Для Poker App — оба файла копируются как шаблон в **свой** репозиторий (детали — этап 6), не в этот.

### 2.6 Storage — паттерн переиспользуется, каталог новый

`LocalAvatarStorageRepository` пишет на диск через `fs/promises`, файлы лежат в `/opt/reraise/storage/avatars/{playerId}/...`, bind mount `./storage:/app/public/storage`, владелец `1001:1001`, nginx отдаёт напрямую через `alias`. Для Poker App — тот же паттерн (если у него вообще есть файловое хранилище, см. аудит 1.4), собственный каталог `/opt/poker-app/storage/...`.

### 2.7 Health checks — паттерн переиспользуется целиком

`GET /api/health` → `{"ok": true}`. Используется в трёх независимых местах одинаково: Docker `healthcheck` в `docker-compose.yml`, поллинг в `deploy.yml`, финальная проверка в `maintenance.yml`. Для Poker App — тот же эндпоинт, тот же формат ответа, та же тройная проверка (детали — этап 8).

---

## 3. Этап 2 — создать новый проект на VPS: `/opt/poker-app`

- Создать каталог `/opt/poker-app` рядом с `/opt/reraise`, той же структуры (git-репозиторий Poker App клонируется сюда).
- `/opt/poker-app/.env` — свой файл, свой набор секретов (не переиспользовать `/opt/reraise/.env` даже частично, кроме случаев, где секрет объективно общий, например SSH-доступ к самому VPS).
- `/opt/poker-app/storage/` — свой каталог под файловое хранилище (если применимо по итогам аудита 1.4), структурно аналогичный `/opt/reraise/storage/`, но физически отдельный.
- Ничего не создаётся внутри `/opt/reraise` и не переиспользуется из него напрямую (даже "просто прочитать") — единственная точка пересечения инфраструктуры — общая Docker-сеть (`poker-clock_default`) и общий Postgres-контейнер (следующий этап), оба уже существующие и не требующие правок.

---

## 4. Этап 3 — новая PostgreSQL database и пользователь

**Использовать существующий контейнер `poker-clock-db`. Не создавать новый Postgres, не поднимать `docker-compose.postgres.yml`.**

Подключиться к существующему контейнеру и создать изолированную базу + пользователя:

```bash
docker exec -it poker-clock-db psql -U <существующий-суперпользователь> -d postgres
```

```sql
CREATE DATABASE poker_app;
CREATE USER poker_app WITH PASSWORD '<новый, отдельный пароль>';
GRANT ALL PRIVILEGES ON DATABASE poker_app TO poker_app;
```

Итоговая строка подключения для Poker App:

```
DATABASE_URL=postgres://poker_app:<пароль>@poker-clock-db:5432/poker_app
```

Ключевые моменты:

- **Имя хоста в строке подключения — `poker-clock-db`**, то же самое, что использует ReRaise (`DATABASE_URL` у ReRaise указывает на тот же хост, другую базу — `reraise`). Резолвится только внутри Docker-сети `poker-clock_default` — контейнер Poker App должен быть подключён к той же сети (этап 4).
- **Отдельный пользователь `poker_app`**, не переиспользование пользователя `reraise` — полная изоляция доступа на уровне СУБД: даже если в коде Poker App когда-либо появится ошибка в строке подключения, отдельные учётные данные не дают физической возможности задеть базу `reraise`.
- Никаких изменений в существующей базе `reraise`, в её пользователе, в самом контейнере как сервисе (не перезапускать, не менять `docker-compose`/конфигурацию `poker-clock-db`) — создание новой базы через `CREATE DATABASE` не требует рестарта контейнера и не влияет на уже существующие подключения.
- Схема (`lib/db/schema/*.ts`, миграции) для `poker_app` — своя, по результатам аудита 1.3, генерируется тем же `drizzle-kit generate`, что и у ReRaise, но описывает таблицы Poker App, а не копирует схему ReRaise бездумно (даже при частичном сходстве доменов после форка — см. этап 1.3).

---

## 5. Этап 4 — `docker-compose.yml` Poker App: практически копия ReRaise

Копируется файл ReRaise, меняются ровно шесть значений, всё остальное — включая структуру, healthcheck, `restart: unless-stopped`, подключение к `poker-clock_default` — идентично:

```yaml
services:
  app:
    build:
      context: .
      args:
        NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}
        NEXT_PUBLIC_TELEGRAM_BOT_ID: ${NEXT_PUBLIC_TELEGRAM_BOT_ID}
        NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL}
        SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}   # изменить: только если Poker App реально требует прод-креды на build time (см. аудит 1.2)
    image: poker-app:latest                                        # ①  было re-raise:latest
    container_name: poker-app                                      # ②  было re-raise
    restart: unless-stopped
    ports:
      - "127.0.0.1:3003:3000"                                      # ④  было 3002 — см. ниже про выбор порта
    volumes:
      - ./storage:/app/public/storage                              # ⑤  тот же относительный путь, но в /opt/poker-app — физически другой каталог
    environment:
      - NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}       # ⑥  все значения — свои секреты Poker App
      - NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
      - NEXT_PUBLIC_TELEGRAM_BOT_ID=${NEXT_PUBLIC_TELEGRAM_BOT_ID}
      - NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      # ...остальные секреты по аналогии, только те, что реально нужны Poker App (см. аудит 1.7)
      - DATABASE_PROVIDER=${DATABASE_PROVIDER}
      - DATABASE_URL=${DATABASE_URL}                                # значение из этапа 3: .../poker_app, не .../reraise
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

networks:
  default:
    name: poker-clock_default
    external: true
```

**Про выбор порта (④):** ReRaise занимает `127.0.0.1:3002`. Poker Clock (первый проект на этом VPS) почти наверняка занимает какой-то другой порт. **Не предполагать номер порта — проверить на самом VPS перед первым запуском** (`ss -tlnp | grep 127.0.0.1` или `docker compose ls`/`docker ps` на предмет уже занятых `127.0.0.1:XXXX`), выбрать свободный (например, `3003`, если не занят). Это единственный пункт этапа 4, где нельзя просто скопировать число из ReRaise — оно по определению должно отличаться.

**Про `networks` (не меняется):** оба контейнера — и `re-raise`, и будущий `poker-app` — подключаются к одной и той же уже существующей внешней сети `poker-clock_default`. Это не конфликт: несколько сервисов в одной Docker-сети — штатный сценарий, именно ради этого сеть и была сделана `external`, а не создаваемой отдельно каждым compose-файлом.

Любое отклонение от этого шаблона сверх шести перечисленных пунктов должно быть явно обосновано (например: другой healthcheck-эндпоинт, если у Poker App иной путь; другой набор `environment`, если нет Telegram-интеграции по итогам аудита 1.7) — не вносится "на всякий случай" или по интуиции.

---

## 6. Этап 5 — Dockerfile Poker App: не писать заново

Копируется 4-стадийный `Dockerfile` ReRaise (раздел 2.2) буквально, построчно, включая:

- `node:20-alpine` + `libc6-compat` в `deps`;
- разделение `ARG`/`ENV` для `NEXT_PUBLIC_*` в `builder` (Next.js вшивает их в клиентский бандл на этапе сборки — это свойство Next.js, а не специфика ReRaise, применимо к любому проекту на этом фреймворке);
- non-root пользователь `nextjs` (uid/gid 1001) в `runner`;
- `output: "standalone"`-копирование (`.next/standalone`, `.next/static`) в `runner`.

**Единственное решение, требующее обоснования по факту аудита (1.2):** нужна ли `migrator`-стадия и, если да, от чего она должна наследовать.

- Если у Poker App **нет** ISR-роутов, реально исполняющихся с обращением к БД во время `next build` (в отличие от `/api/leaderboard` у ReRaise) — `migrator` может расширять `builder` без вреда, и стадию можно даже упростить/объединить, поскольку разделение `deps`/`builder` в ReRaise существовало ровно ради этой одной проблемы.
- Если такие роуты **есть** — повторить решение ReRaise 1:1 (`migrator` наследует `deps`, чтобы не требовать прод-кредов только ради прогона миграций).

Любое другое отличие от `Dockerfile` ReRaise (другая версия Node, другой базовый образ, другая стратегия копирования) требует отдельного обоснования — «потому что у Poker App так исторически было» недостаточно; нужна конкретная техническая причина (например, зависимость, требующая иной libc, если такая обнаружится).

---

## 7. Этап 6 — GitHub Actions: `deploy.yml`/`maintenance.yml` ReRaise как шаблон

Не проектируется новая система деплоя — оба файла копируются в репозиторий Poker App как отправная точка, изменения — минимальны и точечны.

### `deploy.yml` — что меняется

- `cd /opt/reraise` → `cd /opt/poker-app` (единственный путь в скрипте, который обязан измениться).
- URL в smoke-тестах (`https://re-raise.ru/...` → домен/поддомен Poker App, определяется на этапе 7 nginx).
- Список эндпоинтов в smoke-тесте — свой, по реальным роутам Poker App (у ReRaise это `/api/health`, `/api/settings`, `/`, `/api/leaderboard` — соответствие 1:1 с эндпоинтами Poker App нужно свериться по факту, не копировать вслепую, если у Poker App нет, например, `/api/leaderboard`).
- `IMAGE_NAME="$(docker compose config --images app)"` — не меняется, читается из compose-файла Poker App динамически, как и у ReRaise.
- `concurrency.group` — рекомендуется **своё, отдельное имя** (например, `poker-app-deploy` вместо `production-deploy`). GitHub Actions concurrency groups и так изолированы по репозиторию (Poker App и ReRaise — разные репозитории), поэтому коллизии имён не будет технически в любом случае — но использовать то же буквальное имя было бы вводящим в заблуждение при чтении логов/истории запусков двух разных проектов. Важная оговорка не про GitHub, а про сам VPS: concurrency-группа защищает только внутри своего workflow — она не знает о параллельном деплое **другого** проекта на том же физическом сервере. Два одновременных `docker compose build` (один для ReRaise, другой для Poker App) технически безопасны (Docker BuildKit это поддерживает), но конкурируют за один и тот же диск/CPU/BuildKit-кэш — при первом реальном деплое Poker App стоит вручную проверить, что оба процесса не запущены буквально в одну секунду, и по возможности не планировать релизы обоих проектов вплотную друг к другу.
- Секреты (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_SSH_PORT`) — тот же самый VPS, значит те же самые значения технически можно переиспользовать, но GitHub Secrets хранятся отдельно на уровне репозитория — их нужно завести заново в репозитории Poker App (простое копирование значения, не создание нового доступа).

### `maintenance.yml` — что меняется

- Путь `docker compose -f /opt/reraise/docker-compose.yml` → `/opt/poker-app/docker-compose.yml`.
- `concurrency.group` — та же рекомендация, что и для `deploy.yml` (собственное имя, например `poker-app-deploy`), и по той же причине держать её **общей с собственным `deploy.yml` Poker App** (не с `deploy.yml` ReRaise) — сериализация нужна между деплоем и уборкой одного и того же проекта, а не между двумя разными проектами.
- **Расписание (`cron`) — рекомендуется намеренно сдвинуть** относительно ReRaise (у ReRaise — понедельник 03:00 UTC). Не потому что параллельный запуск технически опасен (обе задачи работают с разными Docker-объектами — `docker builder prune`/`docker image prune` без `-a` не различают, чей это образ, но и не удаляют ничего "не своего" сверх правил фильтра), а чтобы логи двух независимых уборок на общем диске VPS не перемешивались по времени и было проще диагностировать, какая уборка что реально высвободила.
- Все команды уборки (`docker builder prune --filter until=72h`, `docker image prune -f`, `journalctl --vacuum-time=14d`, `npm cache clean`) — **не дублировать по существу**, поскольку это общесерверные, а не project-specific ресурсы (BuildKit-кэш и journal — общие для всего VPS, не разделены по проектам). Если оба проекта заведут отдельные `maintenance.yml`, каждый по расписанию будет чистить один и тот же общий кэш — не вредно (повторный `prune` на уже пустом кэше — no-op), но избыточно. Разумная альтернатива, требующая отдельного решения (не часть этого документа): оставить `docker builder prune`/`journalctl`-очистку только в `maintenance.yml` ReRaise (как уже существующей, проверенной практике), а `maintenance.yml` Poker App свести к своей part — проверке здоровья **своего** контейнера, без дублирования общесерверной уборки. Это осознанное отклонение от «максимально повторить ReRaise», которое стоит явно зафиксировать как решение, а не как забытый шаг.

---

## 8. Этап 7 — nginx: новый server block

**Не редактировать существующий конфиг `re-raise.ru`.** Добавляется отдельный файл в `sites-enabled` (например, `/etc/nginx/sites-enabled/poker-app`), по образцу существующего:

```nginx
server {
    listen 443 ssl;
    server_name poker-app.<домен>;   # или отдельный домен, по факту доступного DNS

    location / {
        proxy_pass http://127.0.0.1:3003;   # порт из этапа 4
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /storage/ {
        alias /opt/poker-app/storage/;
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    client_max_body_size 20m;

    # SSL-директивы — по тому же образцу, что и у re-raise (свой сертификат
    # на свой домен, отдельный от re-raise.ru, не общий SAN-сертификат,
    # если нет специальной причины их объединять).
}
```

Ключевое: `proxy_pass` указывает на **порт Poker App**, `alias` — на **каталог Poker App** (`/opt/poker-app/storage/`, не `/opt/reraise/storage/`). Legacy-прокси на `/supabase/*` (у ReRaise) не копируется автоматически — заводится только если по итогам аудита (1.4) Poker App аналогично сохраняет частичную зависимость от Supabase после переноса.

После добавления файла — `nginx -t` (проверка синтаксиса) и `systemctl reload nginx` (не `restart` — reload не разрывает существующие соединения `re-raise.ru`, что прямо соответствует требованию не трогать работающий ReRaise).

---

## 9. Этап 8 — health checks: полностью повторить подход ReRaise

Три места, все — по образцу ReRaise, без изменения формата:

1. **Эндпоинт.** `app/api/health/route.ts` в самом Poker App (если отсутствует — добавить, тривиальный `NextResponse.json({ ok: true })`, как у ReRaise).
2. **Docker healthcheck** в `docker-compose.yml` Poker App (этап 4) — идентичный блок, `wget --spider` на `http://127.0.0.1:3000/api/health` (порт **внутри** контейнера всегда `3000`, вне зависимости от внешнего порта из этапа 4 — совпадает с ReRaise один в один, поскольку это порт, на котором слушает сам Next.js-процесс, а не то, что публикует Docker наружу).
3. **`deploy.yml`/`maintenance.yml`** — тот же паттерн верификации: SHA-проверка → image ID-проверка → проверка статуса контейнера → поллинг running+healthy с таймаутом → HTTPS smoke-тест точного тела ответа `/api/health` (`{"ok":true}`), не просто кода `200`.

Отличий на этом этапе быть не должно вообще — health-check-подход ReRaise не специфичен для его бизнес-логики, это чисто инфраструктурный паттерн, полностью переносимый без адаптации.

---

## 10. Итоговый чек-лист развёртывания Poker App

Executable-план, предполагающий, что этап 1 (аудит) уже выполнен по реальному коду Poker App.

- [ ] **Аудит.** Заполнить таблицу «ReRaise vs Poker App» по всем шести пунктам раздела 1. Не начинать этап 2, пока таблица не заполнена по факту, а не по предположению.
- [ ] **Каталог.** Создать `/opt/poker-app`, склонировать туда репозиторий Poker App, завести `/opt/poker-app/.env` со своими секретами.
- [ ] **База данных.** Подключиться к существующему `poker-clock-db`, создать `CREATE DATABASE poker_app` + `CREATE USER poker_app` с отдельным паролем, выдать права. Не создавать новый Postgres-контейнер, не трогать базу `reraise`.
- [ ] **Drizzle-схема.** Описать `lib/db/schema/*.ts` Poker App по факту его реальных таблиц (этап 1.3), не копировать схему ReRaise бездумно. Прогнать `drizzle-kit generate` + собственный `scripts/migrate.mjs` (тот же паттерн, что у ReRaise — не штатный `drizzle-kit migrate`, если он показывает ту же проблему с проглатыванием ошибок) против `poker_app`.
- [ ] **Dockerfile.** Скопировать 4-стадийную структуру ReRaise. Решить (по аудиту 1.2), нужна ли `migrator`-стадия, наследующая `deps`, или можно проще. Любое другое отличие от Dockerfile ReRaise — зафиксировать письменно, с причиной.
- [ ] **docker-compose.yml.** Скопировать файл ReRaise, поменять ровно шесть значений (`image`, `container_name`, порт — проверенный как свободный на реальном VPS, `volumes`-путь, `environment`-значения). Сеть (`poker-clock_default`, `external: true`) и healthcheck-блок — не менять.
- [ ] **Свободный порт.** Проверить на VPS реально не занятые `127.0.0.1:XXXX` (не предполагать `3003`/любое другое число без проверки — учесть, что Poker Clock тоже занимает какой-то порт на этом же сервере).
- [ ] **GitHub Actions.** Скопировать `deploy.yml`/`maintenance.yml` ReRaise в репозиторий Poker App. Поменять путь (`/opt/poker-app`), домен в smoke-тестах, список реально существующих у Poker App эндпоинтов, имя `concurrency.group` (своё, не совпадающее буквально с ReRaise). Завести секреты (`VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY`/`VPS_SSH_PORT`) в GitHub-репозитории Poker App — значения те же (сервер общий), доступ заводится отдельно на уровне репозитория.
- [ ] **Расписание maintenance.** Сдвинуть `cron` Poker App относительно ReRaise (не обязательно технически, но для чистоты логов и диагностики). Явно решить (и зафиксировать решение), дублировать ли общесерверную уборку (`docker builder prune`/`journalctl`) в обоих `maintenance.yml`, или оставить её только в одном из двух, раз ресурс общий для всего VPS.
- [ ] **nginx.** Добавить новый файл в `sites-enabled` (не редактировать конфиг `re-raise.ru`), `proxy_pass` на свой порт, `alias` на свой storage-каталог, свой домен/сертификат. `nginx -t` → `systemctl reload nginx` (не `restart`).
- [ ] **Health checks.** Добавить `/api/health` в Poker App (если отсутствует), идентичный Docker healthcheck-блок, идентичный паттерн проверок в `deploy.yml`/`maintenance.yml` — без адаптации, это чисто инфраструктурный паттерн.
- [ ] **Storage** (если применимо по аудиту 1.4). Реализовать `Local<Domain>StorageRepository` по образцу `LocalAvatarStorageRepository` ReRaise, свой каталог `/opt/poker-app/storage/...`, отдельный одноразовый скрипт переноса из Supabase Storage (по образцу `scripts/migrate-local-avatars.mjs`), с `--dry-run` и идемпотентностью.
- [ ] **Backfill данных.** Если Poker App переносит существующие продовые данные из Supabase — отдельный идемпотентный скрипт по образцу `scripts/backfill-postgres.mjs`, FK-safe порядок таблиц под реальную схему Poker App (не порядок ReRaise один в один, если набор доменов отличается).
- [ ] **Первый деплой.** Прогнать `deploy.yml` вручную (`workflow_dispatch`, если добавлен, либо push в `main`) на тестовых данных, убедиться в прохождении всех проверок (SHA, image ID, running+healthy, HTTPS smoke-тест) до переключения реального трафика на новый домен/поддомен.
- [ ] **Проверка отсутствия побочного эффекта на ReRaise.** После каждого значимого шага (особенно — после первого `docker compose build`/`up` для Poker App и после первого прогона `maintenance.yml` Poker App) — явно проверить, что `re-raise.ru` по-прежнему `running`+`healthy` (`docker inspect`, `curl https://re-raise.ru/api/health`). Это не разовая проверка «в конце», а привычка на каждом шаге, пока оба проекта не отработали на общей инфраструктуре достаточно долго, чтобы быть уверенным в отсутствии взаимного влияния.
