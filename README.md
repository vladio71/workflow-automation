# learning-app

Особиста апка для навчання: retrospective revision timetable (Ali Abdaal), цикли по 2 тижні, база знань по темах, картки з інтервальним повторенням (замість Anki), AI-план на день у вигляді карти зі скринею відпочинку і вечірньою перевіркою, рівні live coding (вставив код → тести), recall-сесії з перевіркою відповіді через Gemini, mock system design інтерв'ю.

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
npm run app        # Postgres + нові міграції + prisma generate + збірка + старт на http://localhost:3000 (слухає тільки цей комп'ютер)
```
Зупинити: `Ctrl+C` (апка), потім `npm run stop` (Postgres; дані лишаються у volume).

**Після `git pull`:** той самий `npm run app`: сам застосує нові міграції, перегенерує Prisma-клієнт під нову схему і перезбере. Якщо змінився `package.json` (нові залежності), спершу `npm install`.

| Команда | Що робить |
|---|---|
| `npm run setup` | перший запуск з нуля |
| `npm run app` | звичайний старт (production-збірка, швидка) |
| `npm run dev:all` | Postgres + міграції + dev-режим з hot reload, якщо правиш код |
| `npm run stop` | зупинити Postgres |
| `npm run bot` | Telegram-бот з картками (окремий процес поруч з апкою) |
| `npm run db:seed` | стерти все і залити стартову тему GraphQL |

Ключ Gemini: https://aistudio.google.com/apikey. Модель задається в `GEMINI_MODEL`, актуальні безкоштовні моделі дивись в AI Studio. Без ключа все працює, крім AI-перевірки і mock-інтерв'ю.

На безкоштовному рівні Google може використовувати запити для навчання своїх моделей. Для навчальних нотаток це неважливо, робоче сюди не клади.


## Рівні (live coding)

Сторінка **Levels** бере вправи з локального клону [live-code](https://github.com/vladio71/live-code): вставляєш код, апка ганяє тести вправи.

1. Клонуй live-code і один раз зроби в ньому `npm install`.
2. У `.env` апки: `LEVELS_DIR="C:/path/to/live-code"`, перезапусти `npm run app`.

Код з форми виконується на цьому комп'ютері (через vitest з live-code), тому апка слухає тільки `127.0.0.1`: з інших пристроїв у мережі її не видно.
Спроби копіюються в `live-code/.level-attempts/` і одразу видаляються; у git status ця папка не з'являється.

## Скриня (Loot)

Під картою на Today: квиток за кожен пройдений вузол, у скрині картка відпочинку з таймером. Правила і картки в `src/lib/loot.config.ts`.
Новини, статті, музику, аніме і фільми шукає Gemini з Google Search (той самий `GEMINI_API_KEY`), меми беруться з xkcd, без ключа новини й статті йдуть з Hacker News.
За сторінкою цін Google, пошук для Gemini 3 має безкоштовний місячний ліміт (5000 запитів на момент написання), пул тягне кілька сотень на місяць.

## Telegram-бот

Картки з черги на сьогодні приходять у Telegram: питання, кнопка «Показати відповідь», потім Забув / Важко / Згадав. Оцінка йде в той самий розклад, що й на сторінці Cards, наступна картка приходить після оцінки.

1. У [@BotFather](https://t.me/BotFather): `/newbot`, токен у `.env` як `TELEGRAM_BOT_TOKEN`.
2. `npm run bot` і напиши боту `/start`: він відповість твоїм chat id.
3. Встав його в `.env` як `TELEGRAM_CHAT_ID` і перезапусти `npm run bot`.

Бот працює окремим процесом (другий термінал поруч з `npm run app`) з тією ж базою. Першу картку дня шле о `TELEGRAM_SEND_AT` (за замовчуванням 09:00 за часом цього комп'ютера, як і «сьогодні» в апці); `/today` почне раніше або поверне поточну картку. Відповідає тільки на твій chat id.

Картка не прийде двічі за день навіть після рестарту: у `TelegramDelivery` UNIQUE (картка, день). Якщо картку тим часом оцінив в апці, оцінка з Telegram удруге не запишеться.

## Що де

| Шлях | Що |
|---|---|
| `docs/GUIDE.md` | як користуватись системою (також сторінка Guide в апці) |
| `docs/notion/` | початкова версія системи для Notion |
| `docs/wallpaper-1920x1080.png` | шпалери з планом |
| `seed/` | нотатки GraphQL, з яких заливається стартова тема |
| `prisma/schema.prisma` | Topic, Question, Source, PlanStep, RecallLog, Cycle, ActivityLog, DailyLog, DailyPlan, InboxItem, MockSession, CardReview, TelegramDelivery, LevelAttempt, RestCard, RestPull |
| `src/lib/learn-format.ts` | парсер `learn/` (та сама логіка, що `scripts/learn-format.mjs` у graphql-base) |
| `src/lib/sync.ts` | Sync: тягне `learn/` з GitHub, upsert тем, карток і кроків плану |
| `src/lib/study-plan.ts` | навчальний план: які кроки і переробки йдуть у план дня |
| `src/lib/plan-order.ts` | AI не може викинути чи переставити кроки плану |
| `src/lib/schedule.ts` | інтервали повторення: 2 → 7 → 21 → 42 → 84 дні |
| `src/lib/gemini.ts` | екзаменатор (structured JSON), інтерв'юер (стрімінг), план дня і вечірній огляд |
| `src/lib/activity.ts` | лог часу, стрік, аналітика |
| `src/lib/planner.ts` | кандидати для плану з даних, план за правилами без AI, автовизначення виконаного |
| `src/components/DayMap.tsx` | план дня як карта: вузли, стежка, бос, фініш |
| `src/lib/levels.ts` | рівні: читає вправи з `LEVELS_DIR`, прогрес з таблиці спроб |
| `src/lib/level-runner.ts` | прогін коду: тимчасова копія вправи + vitest з live-code, таймаут 30 с |
| `src/lib/level-schedule.ts` | повтори рівнів 2 → 7 → 21 → 42 і рамки 🥉 🥈 🥇 (чиста логіка) |
| `src/lib/plan-order.ts` | порядок дня: обов'язкові кроки плану, розминка першою, бос одразу після неї |
| `src/lib/loot.config.ts` | скриня: статичні картки, шанси, ліміти, скільки карток тримати в пулі (редагуй тут) |
| `src/lib/loot-rules.ts` | квитки, ліміти, pity, бонус за боса, кидок рідкості (чиста логіка) |
| `src/lib/loot.ts` | стан скрині з плану на сьогодні, відкрити скриню, закінчити відпочинок |
| `src/lib/loot-refill.ts` | пул карток: xkcd, Gemini + Google Search, запасний Hacker News |
| `src/app/actions.ts` | усі зміни даних (server actions) |
| `src/app/api/mock/[id]` | стрімінг відповіді інтерв'юера |
| `src/lib/cards.ts` | картки: розклад 1 → 3 → 7 → … днів, черга на сьогодні, час у Stats |
| `src/app/api/sync` | автосинк з Today (route handler, щоб не блокувати кнопки) |
| `src/bot/` | Telegram-бот: `main.ts` (polling і щоденна розсилка), `bot.ts` (картки, кнопки, захист від дублів), `format.ts` (тексти, markdown карток у Telegram HTML) |
