# Project Context

Проект: Telegram Mini App для покерного клуба ReRaise Poker Club.

Цель MVP:
- показать список турниров
- записывать игроков
- вести waitlist
- показывать статус игрока
- показывать рейтинг
- дать админу возможность создавать турниры и вносить результаты
- синхронизировать данные в Google Sheets

Стек:
- Next.js
- TypeScript
- Tailwind CSS
- Supabase
- Telegram WebApp SDK
- Vercel

Архитектурные правила:
- UI-компоненты не содержат бизнес-логику
- Telegram-интеграция лежит только в src/lib/telegram.ts
- Supabase-интеграция лежит только в src/lib/supabase.ts
- Google Sheets-интеграция лежит только в src/lib/sheets.ts
- бизнес-логика лежит в src/features
- каждая новая задача должна менять минимальное число файлов

Сущности:
- players
- tournaments
- registrations
- results

Статусы registrations:
- registered
- waitlist
- cancelled
- attended

Статусы tournaments:
- draft
- open
- closed
- completed
