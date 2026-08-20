# RERAISE Academy: production readiness

Дата проверки: 2026-08-20.

## Статус синхронизации

- Ветка: `feature/reraise-academy-data-layer`.
- `HEAD`, локальный `main` и `origin/main`: `3e9d2e6`.
- Расхождение с `origin/main`: `0/0`; merge/rebase не потребовался.
- Конфликтов с актуальным `main` нет.
- Academy changes должны находиться в reviewed feature commit до merge/deployment.

## Проверки

- Чистая PostgreSQL 16.15: миграции `0000`-`0007` применены успешно.
- Academy tests: 80/80 passed, включая real PostgreSQL integration suite 6/6.
- TypeScript: passed (`npx tsc --noEmit`).
- ESLint: 0 errors, 20 существующих warnings.
- `git diff --check`: passed; только уведомления Git о LF/CRLF.
- Production build: passed с `DATABASE_PROVIDER=postgres`, локальной PostgreSQL и
  непроизводственными значениями внешних integrations.
- Полный test suite: 286 passed, 10 failed, 6 skipped. Те же 10 тестов падают на
  чистом `origin/main` (`3e9d2e6`) без Academy changes, поэтому это подтверждённые
  pre-existing failures, а не Academy regression.

Классификация 10 pre-existing failures:

- `features/__tests__/admin-delete-player.test.ts`: 1 тест мокает legacy
  `@/lib/supabase`, тогда как production-код уже использует `PlayerRepository`.
- `features/__tests__/admin-remove-participant.test.ts`: 3 теста мокают legacy
  `@/lib/supabase`, тогда как production-код уже использует
  `RegistrationRepository`.
- `features/__tests__/waitlist.test.ts`: 4 теста мокают legacy `@/lib/supabase`,
  тогда как production-код уже использует Repository Layer.
- `lib/__tests__/telegram.test.ts`: 2 теста ожидают отсутствие Telegram WebApp, но
  global test setup оставляет WebApp user `123456` доступным через cached module
  state.

Эти падения означают отсутствие актуального regression coverage для перечисленных
legacy-наборов, но не свидетельствуют о runtime-дефекте Academy и не блокируют
Academy deployment при зелёных Academy/PostgreSQL/build проверках.

## Pre-deployment gates

1. Merge reviewed Academy feature commit в deployment branch.
2. Подтвердить свежий PostgreSQL backup и штатную процедуру restore. Команды
   backup/restore в репозитории не описаны, это operational gate владельца VPS.
3. Убедиться, что `.env.postgres` содержит `DATABASE_PROVIDER=postgres` и корректный
   `DATABASE_URL` для контейнера `poker-clock-db`.

Vercel и Supabase являются legacy architecture и не входят в production target
Academy. Supabase compatibility, migration и права `service_role` не являются
release gates.

## Deployment runbook

### 1. Backup gate

Не продолжать без подтверждённого свежего backup и проверенного способа restore.
Репозиторий не содержит штатной команды backup/restore, поэтому команда намеренно
не приведена.

### 2. Получение проверенного кода на VPS

Штатный flow из `docs/architecture.md` начинается так:

```bash
cd /opt/reraise
git pull
```

Перед продолжением проверить, что получен именно reviewed Academy commit.

### 3. PostgreSQL migration

Подтверждённые repository/docs команды:

```bash
docker build --target migrator -t re-raise-migrator:latest .
docker run --rm --network poker-clock_default --env-file .env.postgres \
  re-raise-migrator:latest npm run db:migrate
```

После успешной migration выполнить read-only SQL ниже. Не запускать backfill:
Academy начинает с пустого progress и не переносит исторические данные.

### 4. VPS application deploy

Подтверждённые repository/docs команды:

```bash
docker compose build app
docker compose up -d app
```

Проверить healthcheck `/api/health`, затем web/email smoke test.

### 5. Smoke verification

Канонический production target один: VPS/Docker/PostgreSQL. После deployment
проверить оба auth flow на этом deployment: Telegram Mini App session и web/email
OTP session.

## Read-only PostgreSQL verification

Выполнять после migration в целевой базе только read-only пользователем либо в
read-only transaction.

```sql
BEGIN TRANSACTION READ ONLY;

SELECT to_regclass('public.academy_lesson_progress') AS progress_table,
       to_regclass('public.academy_training_attempts') AS attempts_table,
       to_regprocedure(
         'public.record_academy_training_attempt(uuid,uuid,text,integer,boolean)'
       ) AS record_function;

SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY id;

SELECT conrelid::regclass AS table_name, conname, contype,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN (
  'public.academy_lesson_progress'::regclass,
  'public.academy_training_attempts'::regclass
)
ORDER BY table_name::text, conname;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('academy_lesson_progress', 'academy_training_attempts')
ORDER BY tablename, indexname;

SELECT p.oid::regprocedure AS function_name,
       p.provolatile,
       p.prosecdef,
       p.proconfig,
       has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_execute,
       has_function_privilege(current_user, p.oid, 'EXECUTE') AS current_user_can_execute
FROM pg_proc p
WHERE p.oid = 'public.record_academy_training_attempt(uuid,uuid,text,integer,boolean)'::regprocedure;

SELECT count(*) AS progress_rows FROM public.academy_lesson_progress;
SELECT count(*) AS attempt_rows FROM public.academy_training_attempts;

SELECT *
FROM public.academy_lesson_progress
WHERE attempts_count < 1
   OR last_score_percent NOT BETWEEN 0 AND 100
   OR best_score_percent NOT BETWEEN 0 AND 100
   OR best_score_percent < last_score_percent
   OR (passed AND first_completed_at IS NULL)
   OR (NOT passed AND first_completed_at IS NOT NULL)
   OR lesson_code NOT IN (
     'preflop_rfi_9max_100bb_utg', 'preflop_rfi_9max_100bb_ep',
     'preflop_rfi_9max_100bb_mp1', 'preflop_rfi_9max_100bb_mp2',
     'preflop_rfi_9max_100bb_hj', 'preflop_rfi_9max_100bb_co',
     'preflop_rfi_9max_100bb_btn'
   );

SELECT *
FROM public.academy_training_attempts
WHERE score_percent NOT BETWEEN 0 AND 100
   OR passed <> (score_percent >= 80)
   OR lesson_code NOT IN (
     'preflop_rfi_9max_100bb_utg', 'preflop_rfi_9max_100bb_ep',
     'preflop_rfi_9max_100bb_mp1', 'preflop_rfi_9max_100bb_mp2',
     'preflop_rfi_9max_100bb_hj', 'preflop_rfi_9max_100bb_co',
     'preflop_rfi_9max_100bb_btn'
   );

SELECT p.player_id, p.lesson_code, p.attempts_count,
       count(a.id) AS actual_attempts,
       p.best_score_percent, max(a.score_percent) AS actual_best
FROM public.academy_lesson_progress p
LEFT JOIN public.academy_training_attempts a
  ON a.player_id = p.player_id AND a.lesson_code = p.lesson_code
GROUP BY p.player_id, p.lesson_code, p.attempts_count, p.best_score_percent
HAVING p.attempts_count <> count(a.id)
    OR p.best_score_percent <> max(a.score_percent);

SELECT player_id, lesson_code, count(*) AS first_pass_rows
FROM public.academy_training_attempts
WHERE first_pass
GROUP BY player_id, lesson_code
HAVING count(*) > 1;

ROLLBACK;
```

Ожидание: обе таблицы и функция существуют; migration list содержит восемь строк;
все invalid-state запросы возвращают ноль строк.

## Smoke tests

### Telegram Mini App

- Открыть приложение через текущего Telegram-бота; убедиться, что session создана.
- Открыть `Академия`; проверить глобальную bottom navigation и safe area.
- Открыть Preflop: доступны UTG, EP, MP1, MP2, HJ, CO, BTN; Positions показывает `x/7`.
- Открыть lesson: range grid и объяснение отображаются.
- Запустить training: получено ровно 10 уникальных вопросов.
- Завершить 7/10: попытка не пройдена и сохранена.
- Завершить 8/10: попытка пройдена и сохранена.
- Обновить страницу и повторно открыть Mini App: progress сохранён.
- Пройти повторно с худшим результатом: `attempts` и `last` обновлены, `best` сохранён,
  `passed` не снят.

### Web / email OTP

- Войти через `/login` по email OTP и проверить `/api/auth/me`.
- Повторить весь Academy сценарий выше для того же web session.
- Выйти/войти повторно и убедиться, что progress относится к тому же player id.
- Проверить, что Telegram-linked email не создаёт отдельный progress-профиль.

## Rollback and recovery

- При ошибке migration приложение не обновлять; восстановить БД штатной VPS
  процедурой restore, которая должна быть подтверждена до начала работ.
- При ошибке нового приложения оставить additive Academy tables на месте и вернуть
  предыдущий проверенный application revision через принятую Git/deployment
  процедуру. Репозиторий не документирует точную rollback-команду, поэтому она не
  подменяется предположением.
- Не удалять Academy tables/function вручную как первый rollback: миграция additive,
  а старый application code их не использует.
- Не выполнять backfill, `db:push` или ручное изменение существующих доменов.
