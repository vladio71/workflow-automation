# learning-app

Особиста апка для навчання: retrospective revision timetable (Ali Abdaal), цикли по 2 тижні, база знань по темах, recall-сесії з перевіркою відповіді через Gemini, mock system design інтерв'ю.

**Стек:** Next.js 16 (App Router, server actions), TypeScript, Prisma 7 + Postgres 16 (Docker), Gemini (`@google/genai`), Tailwind 4, стиль Notion (світла і темна тема за налаштуваннями системи).

## Запуск

```bash
cp .env.example .env            # за бажанням встав GEMINI_API_KEY
docker compose up -d db         # Postgres на :5433
npm install
npm run db:migrate
npm run db:seed                 # 36 тем, 32 питання, 5 циклів (з docs/notion)
npm run dev                     # http://localhost:3000
```

Ключ Gemini: https://aistudio.google.com/apikey. Модель задається в `GEMINI_MODEL`, актуальні безкоштовні моделі дивись в AI Studio. Без ключа все працює, крім AI-перевірки і mock-інтерв'ю.

На безкоштовному рівні Google може використовувати запити для навчання своїх моделей. Для навчальних нотаток це неважливо, робоче сюди не клади.

`npm run db:seed` перезаписує теми, питання і цикли. Запускай тільки один раз на старті.

## Що де

| Шлях | Що |
|---|---|
| `docs/GUIDE.md` | як користуватись системою (також сторінка Guide в апці) |
| `docs/notion/` | початкова версія системи для Notion |
| `docs/wallpaper-1920x1080.png` | шпалери з планом |
| `seed/` | CSV тем і колода Anki, з яких заливається база |
| `prisma/schema.prisma` | Topic, Question, RecallLog, Cycle, DailyLog, InboxItem, MockSession |
| `src/lib/schedule.ts` | інтервали повторення: 2 → 7 → 21 → 42 → 84 дні |
| `src/lib/gemini.ts` | екзаменатор (structured JSON) і інтерв'юер (стрімінг) |
| `src/app/actions.ts` | усі зміни даних (server actions) |
| `src/app/api/mock/[id]` | стрімінг відповіді інтерв'юера |
| `src/app/api/anki-export` | експорт нових питань у файл для Anki |
