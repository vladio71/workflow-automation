# learning-app

Особиста апка для навчання: retrospective revision timetable (Ali Abdaal), цикли по 2 тижні, база знань по темах, AI-план на день з вечірньою перевіркою, recall-сесії з перевіркою відповіді через Gemini, mock system design інтерв'ю.

**Стек:** Next.js 16 (App Router, server actions), TypeScript, Prisma 7 + Postgres 16 (Docker), Gemini (`@google/genai`), Tailwind 4, стиль Notion (світла і темна тема за налаштуваннями системи).

## Запуск

Потрібні Node 22+ і Docker (Docker Desktop має бути запущений).

**Перший раз:**
```bash
npm run setup      # створить .env, npm install, підніме Postgres, міграції, seed
```
`setup` запускає seed, а він **чистить усі дані** в апці. Тому тільки один раз.
Після цього за бажанням встав `GEMINI_API_KEY` і `GITHUB_TOKEN` у `.env`.

**Щодня:**
```bash
npm run app        # Postgres + нові міграції + збірка + старт на http://localhost:3000
```
Зупинити: `Ctrl+C` (апка), потім `npm run stop` (Postgres; дані лишаються у volume).

**Після `git pull`:** той самий `npm run app` (сам застосує нові міграції і перезбере). Якщо змінився `package.json`, спершу `npm install`.

| Команда | Що робить |
|---|---|
| `npm run setup` | перший запуск з нуля |
| `npm run app` | звичайний старт (production-збірка, швидка) |
| `npm run dev:all` | Postgres + dev-режим з hot reload, якщо правиш код |
| `npm run stop` | зупинити Postgres |
| `npm run db:seed` | стерти все і залити стартову тему GraphQL |

Ключ Gemini: https://aistudio.google.com/apikey. Модель задається в `GEMINI_MODEL`, актуальні безкоштовні моделі дивись в AI Studio. Без ключа все працює, крім AI-перевірки і mock-інтерв'ю.

На безкоштовному рівні Google може використовувати запити для навчання своїх моделей. Для навчальних нотаток це неважливо, робоче сюди не клади.


## Що де

| Шлях | Що |
|---|---|
| `docs/GUIDE.md` | як користуватись системою (також сторінка Guide в апці) |
| `docs/notion/` | початкова версія системи для Notion |
| `docs/wallpaper-1920x1080.png` | шпалери з планом |
| `seed/` | нотатки GraphQL і колода Anki, з яких заливається стартова тема |
| `prisma/schema.prisma` | Topic, Question, Source, RecallLog, Cycle, ActivityLog, DailyLog, DailyPlan, InboxItem, MockSession |
| `src/lib/learn-format.ts` | парсер `learn/` (та сама логіка, що `scripts/learn-format.mjs` у graphql-base) |
| `src/lib/sync.ts` | Sync: тягне `learn/` з GitHub, upsert теми і карток |
| `src/lib/schedule.ts` | інтервали повторення: 2 → 7 → 21 → 42 → 84 дні |
| `src/lib/gemini.ts` | екзаменатор (structured JSON), інтерв'юер (стрімінг), план дня і вечірній огляд |
| `src/lib/activity.ts` | лог часу, стрік, аналітика |
| `src/lib/planner.ts` | кандидати для плану з даних, план за правилами без AI, автовизначення виконаного |
| `src/app/actions.ts` | усі зміни даних (server actions) |
| `src/app/api/mock/[id]` | стрімінг відповіді інтерв'юера |
| `src/app/api/anki-export` | експорт нових питань у файл для Anki |
