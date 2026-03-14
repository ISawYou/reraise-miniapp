# ReRaise Poker Club — Project Context

## Что это
Telegram Mini App для покерного клуба ReRaise Poker Club.

## Цель MVP
Сделать управляемый клубный MVP внутри Telegram, где:
- игрок открывает Mini App
- видит турниры
- записывается на турнир
- попадает в waitlist, если мест нет
- видит свой статус регистрации
- позже увидит рейтинг

А админ:
- создает турниры
- задает лимит игроков
- видит список регистраций
- вносит результаты
- позже синхронизирует данные с Google Sheets

## Стек
- Next.js App Router
- TypeScript
- Tailwind CSS
- Telegram WebApp SDK
- Supabase
- Vercel

## Что уже сделано
1. Создан Next.js проект
2. Проект задеплоен на Vercel
3. Telegram Mini App открывается внутри Telegram
4. Telegram user успешно читается:
   - first_name
   - username
   - telegram id
5. Подключен Supabase
6. Созданы таблицы:
   - players
   - tournaments
   - registrations
   - results
7. При открытии Mini App игрок синхронизируется в таблицу `players`
8. Сделана страница турниров
9. Турниры подгружаются из Supabase
10. Сделана запись на турнир
11. Если мест нет, запись идет в `waitlist`
12. На странице турниров работает умная кнопка:
   - Записаться
   - Вы записаны
   - Вы в waitlist

## Структура проекта
- src/app
- src/components
- src/features
- src/lib
- src/types
- src/config

## Важные файлы
- src/app/layout.tsx
- src/app/page.tsx
- src/app/tournaments/page.tsx
- src/features/auth.ts
- src/features/tournaments.ts
- src/lib/telegram.ts
- src/lib/supabase.ts
- src/types/domain.ts
- src/types/database.ts
- src/config/rating.ts

## Доменные сущности
### players
- id
- telegram_id
- username
- display_name
- created_at

### tournaments
- id
- title
- start_at
- max_players
- status
- created_at

### registrations
- id
- player_id
- tournament_id
- status
- created_at

### results
- id
- tournament_id
- player_id
- place
- rating_points
- created_at

## Статусы
### registrations
- registered
- waitlist
- cancelled
- attended

### tournaments
- draft
- open
- closed
- completed

## Текущее состояние
Сейчас уже работает первая живая цепочка:

Telegram user → player in DB → tournaments from DB → registration → waitlist/status UI

## Следующий шаг
Сделать отмену регистрации и автоматическое продвижение первого игрока из waitlist в registered.

## После этого шага
Следующие приоритеты:
1. отмена регистрации
2. live счетчик игроков (например 7/20)
3. простая админка создания турниров
4. внесение результатов
5. рейтинг
6. Google Sheets sync

## Архитектурные правила
- UI-компоненты не содержат бизнес-логику
- Telegram-интеграция лежит в `src/lib/telegram.ts`
- Supabase-интеграция лежит в `src/lib/supabase.ts`
- бизнес-логика лежит в `src/features`
- новые изменения должны менять минимальное число файлов
- лучше заменять файл целиком, если есть риск ошибиться вручную