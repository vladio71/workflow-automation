# workflow-automation

A tool I built for myself to run my own daily routine without planning it by hand: notes and task sources live in Git repos, an LLM turns them into a plan for the day, reviews come on a schedule through a Telegram bot, and the evening check closes the loop.

Built with AI coding agents (Claude Code, Cursor) as the main way of writing code; I review and own what they produce.

## What it does

- **Sources from Git.** Topics, notes and exercise sets are synced from GitHub repos (`src/lib/sync.ts`), so the knowledge base is version-controlled and the app is a view over it, not the source of truth.
- **Daily plan with a contract.** The planner (`src/lib/planner.ts`) asks Gemini for the day's plan, but the output is schema-validated with zod and mandatory steps are selected by code, not by the model: recurring tasks and the next steps of each plan are always present and in order, the LLM only fills the optional part and the reasoning.
- **Resilient model calls.** `src/lib/gemini.ts` runs a fallback chain across models: quota (429), overload (503), a cut-off stream, a hang or a 404 moves to the next model at once; only an auth error or the overall deadline stops the call. A streamed reply switches models only before its first token.
- **Scheduled reviews over Telegram.** A separate bot process (`src/bot`) sends the day's review queue at a set time, takes the answer grades back, and writes them into the same schedule the web UI uses. A unique (item, day) key in the DB makes delivery idempotent across restarts.
- **Code exercises with real tests.** The Levels page takes a solution, runs the exercise's test suite from a local clone of [live-code](https://github.com/vladio71/live-code) with vitest, and schedules redos from the result.
- Also: two-week cycles with retrospective revision, spaced-repetition cards, recall sessions graded by the LLM, mock system-design sessions, a task backlog and an activity log.

**Stack:** Next.js 16 (App Router, server actions), TypeScript, Prisma 7 + Postgres 16 (Docker), Gemini (`@google/genai`), zod, Tailwind 4.

## Run

Node 22+ and Docker.

```bash
npm run setup      # first time: .env, install, Postgres, migrations, seed (seed wipes data, run once)
npm run app        # Postgres + migrations + prisma generate + build + start on http://127.0.0.1:3000
npm run dev:all    # same with hot reload
npm run bot        # Telegram bot, separate process next to the app
npm run stop       # stop Postgres (data stays in the volume)
```

Optional `.env` keys: `GEMINI_API_KEY` (several models comma-separated, first is primary), `GITHUB_TOKEN` for private source repos, `LEVELS_DIR` pointing at a local live-code clone, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_SEND_AT`. Without a Gemini key everything works except the LLM features.

The app binds to `127.0.0.1` only: submitted exercise code runs on this machine.

More detail on the workflow itself: `docs/GUIDE.md`.
