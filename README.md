# learning-app

Особиста апка для навчання: навчальний матеріал по system design прямо в апці (карта навантажень 4 продукти × 5 груп, 14 патернів мислення, сеньйорський мінімум з дрилами, довідник), норма дня замість планування (нове, повтор, вголос, live code, картки), цикли по розділах матеріалу, картки з інтервальним повторенням (замість Anki), база знань по темах з recall через Gemini, рівні live coding (вставив код → тести), mock system design інтерв'ю, парковка для кролячих нір.

**Стек:** Next.js 16 (App Router, server actions), TypeScript, Prisma 7 + Postgres 16 (Docker), Gemini (`@google/genai`), Tailwind 4, IBM Plex + Unbounded (fontsource), світла і темна тема за налаштуваннями системи.

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

Ключ Gemini: https://aistudio.google.com/apikey. Модель задається в `GEMINI_MODEL`, актуальні безкоштовні моделі дивись в AI Studio. Можна кілька через кому: перша основна, на ліміт (429), перевантаження (503), обрив відповіді, зависання чи 404 апка одразу пробує наступну. Чи живі моделі, видно на **Sources → 🔌 Перевірити Gemini**. Без ключа все працює, крім AI-перевірки і mock-інтерв'ю.

На безкоштовному рівні Google може використовувати запити для навчання своїх моделей. Для навчальних нотаток це неважливо, робоче сюди не клади.


## Рівні (live coding)

Сторінка **Levels** бере вправи з локального клону [live-code](https://github.com/vladio71/live-code): вставляєш код, апка ганяє тести вправи.

1. Клонуй live-code і один раз зроби в ньому `npm install`.
2. У `.env` апки: `LEVELS_DIR="C:/path/to/live-code"`, перезапусти `npm run app`.

Код з форми виконується на цьому комп'ютері (через vitest з live-code), тому апка слухає тільки `127.0.0.1`: з інших пристроїв у мережі її не видно.
Спроби копіюються в `live-code/.level-attempts/` і одразу видаляються; у git status ця папка не з'являється.

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
| `prisma/schema.prisma` | Topic, Question, DeletedCard, Source, PlanStep, RecallLog, Cycle, ActivityLog, DailyLog, ParkingItem, CellProgress, CellRedo, DrillAttempt, SpokenAnswer, MockSession, CardReview, TelegramDelivery, LevelAttempt, Task, TaskTick |
| `src/content/*.json` | навчальний матеріал: карта (клітинки зі схемами, словник блоків), патерни, модулі мінімуму з дрилами, довідник (затримки, AWS, масштаб баз, джерела) |
| `src/lib/content.ts` | типи матеріалу і доступ: клітинка, сусіди, що нового на групі, де патерн спрацював, порядок проходження |
| `src/lib/progress.ts` | прогрес по матеріалу: кроки клітинки, спроби дрилів, відповіді вголос, парковка |
| `src/lib/norm.ts` | норма дня: що в кожному слоті сьогодні і чи він закритий; повтори клітинок |
| `src/lib/sections.ts` | розділи матеріалу для циклів |
| `src/components/CellDiagram.tsx`, `CellSteps.tsx`, `CellRedo.tsx` | схема клітинки, три кроки, повтор по пам'яті |
| `src/components/DrillForm.tsx`, `SpokenForm.tsx` | дрил зі спробою і чеклістом; слот «вголос» |
| `src/components/ReferenceDiagrams.tsx` | шкала затримок і діаграми масштабу баз |
| `src/lib/learn-format.ts` | парсер `learn/` (та сама логіка, що `scripts/learn-format.mjs` у graphql-base) |
| `src/lib/sync.ts` | Sync: тягне `learn/` з GitHub, upsert тем, карток і кроків плану; картки, змінені чи видалені в апці, не чіпає |
| `src/lib/study-plan.ts` | навчальний план з `learn/plan.md`: прогрес кроків, наступний крок |
| `src/lib/schedule.ts` | інтервали повторення: 2 → 7 → 21 → 42 → 84 дні |
| `src/lib/gemini.ts` | екзаменатор (structured JSON) та інтерв'юер; стрімінг, запасні моделі на 429 і зависання, перевірка моделей |
| `src/lib/ai-status.ts`, `src/app/api/ai/status` | статус поточного запиту до Gemini в пам'яті процесу (модель, думає/пише, що впало) і route handler, який його віддає |
| `src/components/AiStatus.tsx` | рядок статусу під кнопкою, поки чекаємо Gemini |
| `src/components/GeminiCheck.tsx`, `src/lib/ai-labels.ts` | кнопка «Перевірити Gemini» на Sources; короткі назви моделей |
| `src/lib/activity.ts` | лог часу, стрік, аналітика |
| `src/lib/levels.ts` | рівні: читає вправи з `LEVELS_DIR`, прогрес з таблиці спроб |
| `src/lib/level-runner.ts` | прогін коду: тимчасова копія вправи + vitest з live-code, таймаут 30 с |
| `src/lib/level-schedule.ts` | повтори рівнів 2 → 7 → 21 → 42 і рамки 🥉 🥈 🥇 (чиста логіка) |
| `src/components/LiveCodeCoach.tsx` | попап правил live code і нагадування на 25-й хвилині (кнопка в меню) |
| `src/lib/live-code-rules.ts` | текст правил: золоте правило, чекліст, підказки L1-L3, закріплення, sanity checks |
| `src/lib/live-code-session.ts` | таймер нагадування в браузері: ручний старт або від старту рівня |
| `src/lib/task-sessions.ts` | справи-сесії: ціль на день, кроки за сьогодні, дані для башти і скайлайну |
| `src/components/Tower.tsx`, `TowerCard.tsx` | башта дня (поверх за кожен +1, прапор на цілі), скайлайн за 14 днів, попап сесії |
| `src/lib/campaign.ts`, `src/components/CampaignMap.tsx` | навчальний план як карта кампанії: регіони-тижні, фортеці-задачі, тріщини на переробках |
| `src/app/actions.ts` | усі зміни даних (server actions) |
| `src/app/tasks` | справи поза навчанням (Task): повторювані і разові |
| `src/app/api/mock/[id]` | стрімінг відповіді інтерв'юера |
| `src/lib/cards.ts` | картки: розклад 1 → 3 → 7 → … днів, черга на сьогодні, час у Stats; додати, змінити, видалити картку |
| `src/app/api/sync` | автосинк з Today (route handler, щоб не блокувати кнопки) |
| `src/app/parking` | парковка (колишній Inbox): питання з кролячих нір, одне на тиждень на експеримент |
| `src/bot/` | Telegram-бот: `main.ts` (polling і щоденна розсилка), `bot.ts` (картки, кнопки, захист від дублів), `format.ts` (тексти, markdown карток у Telegram HTML) |
