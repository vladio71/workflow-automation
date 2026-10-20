# How to study and not forget

Foundation: Ali Abdaal's principles (active recall, spaced repetition, retrospective revision timetable) plus drills from [graphql-base](https://github.com/vladio71/graphql-base).

## Three rules

1. **Questions, not notes.** Taking notes feels productive and barely works. Write questions, answer from memory.
2. **Hard = right.** A review has to be an effort: blank page, source closed. Re-reading does not count.
3. **Retrospective, not ahead.** Don't plan "topic X on Tuesday"; every morning take the weakest and oldest. The **Today** page does that.

## Pages

| Page | What it is |
|---|---|
| **Today** | the AI plan for the day (focus, draft, after the start a map), the checklist, what to review (red and overdue), the current cycle, weekly system design, quick capture |
| **Topics** | everything being learned: drills, primer sections, AI, Python. Color + last recall date + next review |
| **Topic** | notes (the knowledge base, markdown), questions for the topic, recall history |
| **Recall** | a session: question -> answer from memory -> Gemini check or the reference -> you set the color |
| **Cards** | cards instead of Anki: **Review** (what is due today), **Categories** (cards by category, Recall of one category) and **All cards** (every Q&A any time, search; a click opens the card page) |
| **Questions** | every question and task: add, edit your own, when a card is due next |
| **Cycles** | your plan: focuses in turn (about 2 weeks each), goal, topics, retro. No hard dates |
| **Stats** | streak, time by day, track, topic and kind of work, activity calendar |
| **Inbox** | quick capture without sorting; triage on Sunday |
| **Tasks** | tasks outside study, a board like Jira: Backlog -> To do -> In progress -> Done. Backlog stays out of the day plan; To do and In progress get picked. A task with a daily target is a session with a counter and a tower |
| **Mock interview** | system design, 45 min, Gemini as the interviewer |
| **Levels** | live-coding exercises from the live-code repo: paste code -> tests -> level passed, frame 🥉 -> 🥈 -> 🥇 |
| **Plan** | the study plan from `learn/plan.md` as a campaign map: weeks are regions, problems are fortresses; the step list under the map |
| **Sources** | repos with a `learn/` folder the app pulls topics and cards from; Gemini status: model check and recent requests |

## The day plan (AI)

In the morning on Today, before **Plan my day**:
- **Focus**: **Live code** (levels) or a study plan button (System design...). Whatever is in focus takes up to 60% of the budget: a focused plan takes more steps and up to 2 new problems, and with Live code in focus the levels become mandatory (redos first, up to 4, then up to 6 new ones in order, while they fit in the 60%). The other plans share the rest (~40%) that day. Without a focus every plan takes its own daily limit and levels are optional (1-2).
- **Wish**: free text ("no mock", "only reviews today"). It goes into the prompt, but Gemini still picks only from the candidates.
- Time budget.

How the plan is built:
- The app collects candidates from your data: study-plan steps, overdue and red topics, topics of the current cycle with too few questions, a primer section if there was no system design for a week, a mock if there was none for a week, the Inbox, tasks from **Tasks**.
- Gemini picks items into the time budget, orders them and explains why each one is for today. It invents no new topics. Yesterday's undone items are taken into account.
- While Gemini thinks, the status under the button shows the request: which model, how many seconds, thinking or already writing, and what failed before.
- Without a key, or when no model answered, the plan is built by plain rules. Then a red line under the plan gives the reason per model, e.g. "3.8 Flash: daily limit (429) -> 3.7 Flash: stalled: 30 s without a reply". The line stays until the plan is rebuilt. More in the "Gemini" section below.

**Draft -> start.** Plan my day gives a draft. Before the start it can be edited: ✕ removes an item, −/+ changes minutes, ↑↓ reorders, a candidate the plan skipped can be added, or your own task in one line (it is saved to Tasks). A removed study-plan step takes the later steps of that plan with it, and two steps of one plan never swap: the plan defines their order. **▶ Start the day** fixes the plan and it becomes a map (below). **Re-plan** after the start asks for confirmation, keeps what is done today at the top of the map and rebuilds the rest as a draft.

**Tasks.** The board: **Backlog | To do | In progress**, done ones collapsed at the bottom. A new one-off task lands in Backlog and stays out of the plan until you move it with the `→` arrow into To do. Recurring ones (daily or weekdays) are in progress at once, the plan takes them itself. A one-off task in To do is offered by the plan until it is done, with a note of how many days it has been waiting. Ticking a one-off task in the plan closes it in Tasks too. Priority P1 high ... P4 low sets the order in the columns.

Putting something into the backlog from outside (iPhone Shortcuts, desk.py, curl), with the `x-automation-token` header:
- `POST /api/tasks` body `{ "title": "Set up Jomo", "priority": 2, "minutes": 40 }` -> 201, the task is in Backlog
- `GET /api/tasks?status=BACKLOG` (also TODO, IN_PROGRESS, DONE; without status: everything not done)
- `PATCH /api/tasks/:id` body `{ "status": "TODO" }` or `{ "priority": 1 }`, `DELETE /api/tasks/:id`

**Session and the tower of the day.** A task in Tasks can get a daily target, e.g. "Send resumes: 10". Then it is a session:
- **▶ Session** (on Today under the map, or on the task's node on the map) opens a popup: **+1 sent** or Enter per resume, the field takes the company or a link, **−1** removes an extra one. There is also **+1** in Tasks.
- Every +1 is a floor of the tower. Floors still missing up to the target stand as scaffolding, a flag goes on top at the target, floors above the target are golden.
- The task's node on the map shows 3/10 and closes itself at the target.
- At midnight the tower starts from zero and yesterday's goes into the skyline: small towers for the last 14 days, with a flag where the target was reached.

During the day the app sees what is done on its own: a recall on a topic, 3+ new questions, a mock, an empty Inbox. Cards tick themselves when today's queue is empty. The rest (explaining out loud) is ticked by hand.

In the evening, **Check the day**: a short review of what was done, what to carry over, one tip for tomorrow.

### The day map

After **Start the day** the plan is shown as a map: the items stand on a path in execution order.
- Passed ones glow green, the current one pulses, the next ones are locked until the current one is passed. No choosing what to do next.
- The longest item of the day is the boss (👑). After the last item, the finish 🏁.
- A click on a node shows what it is and why today. The current one has **Start** (go to the work), **Mark done** (for what the app cannot see itself), **Skip for now** (move to the end of the day; study-plan steps don't move).
- A level (⚔️) cannot be ticked: only green tests.
- The order is set by code, not by the AI: cards first (warm-up, a quick first win), right after them the boss while the head is fresh, then lighter towards the evening. Mandatory items (plan steps, focused levels) keep their relative order. This is the draft order: before the start it can be changed with ↑↓.

## Levels

A level is an exercise from [live-code](https://github.com/vladio71/live-code): the task in a README, a starter `index.ts`, tests and a reference solution.
1. Open a level (from the day map or the Levels page). There is no clock on the page: time is counted quietly, only for Stats and the "check where you are" reminder.
2. Write the code right in the app (no autocomplete, like in an interview) or paste your own, **Run tests** or Ctrl+Enter.
3. The app puts the code into a temporary copy of the exercise and runs its tests. Green tests = level passed. Your `index.ts` in the repo is untouched.
4. After a pass the reference opens: write down 1-2 things it does better.

Redos follow the rule from the README: the same exercise from scratch after 2 days, then 7, 21, 42. A pass on time raises the frame 🥉 -> 🥈 -> 🥇, a pass before the due date is just practice. Levels that are due go into the day plan on their own, together with the next new exercise in order.

**Give up** opens the reference before a pass: the level comes back in 2 days, and a pass the same day closes the plan item but does not raise the frame.

Setup: `LEVELS_DIR` in `.env` = the path to a local clone of live-code, and `npm install` inside it once.

### Live code rules and the reminder

**📏 Live code rules** in the menu (and the **📏 Rules** button on a level page) opens a popup with the rules: the golden rule (20 min without a plan = stop), a "check yourself" checklist by minute, hints in order L1 -> L2 -> L3, what to do after a solution, a table of sanity checks. Read it before the start, tick along the way.

The reminder timer:
- a level starts it on its own, from its start; green tests or an opened reference stop it;
- for an exercise in the editor: **▶ Start** in the popup (with the minutes, 25 by default).

No clock is shown anywhere. After 25 min (configurable) a browser notification arrives, the "check where you are" popup opens on the page, and 👀 appears in the tab. The answers: **Moving, keep going** (asks again later), **Going to look** (hints in order and what to do after) or **Solved**. While the reminder is on, a ● sits next to the menu item. The browser asks for notification permission once: on the first **▶ Start** or with the **🔔 Allow notifications** button in the popup. Without permission the popup and the 👀 remain.

## The study plan (Plan)

When a repo has `learn/plan.md` (currently system-design-reps), the day plan is built like this:
1. Today's cards (Cards).
2. **Problem redos** that are due: at most 2 per day, 45 min each, from scratch. A problem is a topic `learn/pNN-*`; after an attempt you set the color, and the 2 / 7 / 21 day schedule brings it back on its own.
3. **The next plan steps strictly in order**, while they fit the plan's daily limit (`dailyMinutes`, currently 210 min). At most one new problem a day. On a day focused on this plan: at least 60% of the day budget and up to 2 new problems.
4. The rest of the budget: other reviews, Node / AI cycles.

Plan steps are selected by code, not by the AI: Gemini only arranges the day and writes the explanations; it cannot drop or reorder a plan step.
A problem attempt counts on its own when you pass "Do it" on its topic. The other steps are ticked in the day plan or on the Plan page.
A plan problem does not appear in "Due for recall" before its date, even when it is red.

Changing the plan (order, steps, daily limit) = changing `learn/plan.md` in the repo. Progress is bound to the step's `Id:`, so text and order can be edited without losing ticks.

**The campaign map.** On the Plan page the plan is shown as a campaign; it never resets:
- a region is a week from plan.md (`## Week 1 · ...`); a region passed to the end gets a flag 🚩, the current one ⚔️, the next ones are locked 🔒;
- 🏰 a fortress is a problem: attempt, reference and summary form a ring of three parts that lights up as you pass; 📖 reading, 🔎 deep dive, 🐉 with a crown is an exam;
- a problem whose redo is due cracks (a red crack and "!"); a recall repairs it;
- a click on a node shows its steps with ticks and links. The old step list is under the map, in "All steps as a list".

On Today a mini-map of the current region replaces the progress bar; a click opens Plan.

## Cards

Q questions from every topic (from repos and added by hand) live in the app; a separate Anki is not needed.

**Review:** cards that are due plus up to 10 new ones a day. Answer in your head or out loud first, then Space, then grade:
- **1 Forgot**: again tomorrow, and once more at the end of this session;
- **2 Hard**: the same interval;
- **3 Recalled**: the next interval 1 -> 3 -> 7 -> 14 -> 30 -> 60 -> 120 days.

**All cards:** every card at once, without the schedule. Filter by topic, search, "Show answers" (just read), "Go through" and "Shuffled" (go one by one). A pass here does not change the schedule; only **F (Forgot)** puts the card on tomorrow. Cards are grouped by category, the due date in its own column.

**Categories:** a card's category is its topic. The table: how many cards, how many due, how many new, the next due date. A click on a category opens its cards; **Recall** leads to a Review of that category only (due cards with grades). A card added by hand changes category with a click on it: the list of existing ones (recently used first) or "+ Add new". A repo card's category is its folder in learn/.

**Add, edit, delete:**
- **+ New card**: a separate page with question, answer and category at once (Ctrl+Enter = add). The form stays open to add several in a row. A new card comes into Review as new.
- A click on a card: its page, where question, answer and category are changed (Ctrl+Enter = save, Esc = cancel). The schedule does not change.
- **✕** on a card: delete (with confirmation). The review history goes with it.
- A repo card you edited gets an **edited** mark: Sync stops updating it from `questions.md`, your text wins. A repo card you deleted is not brought back by Sync. The only way back is by hand, through New card.

**Telegram:** the same cards can arrive every morning in Telegram (`npm run bot`, setup in the README). A grade there goes into the same schedule as here.

Time on cards is logged into Stats on its own (kind Cards), and the "Cards" tick on Today is set when today's queue is empty.

Repo cards stay plain markdown in `learn/*/questions.md` on GitHub, readable without the app. What you edit or delete in the app is not written back to the file: for those cards the file and the app diverge.

## Colors and reviews

| Color | When | Next review |
|---|---|---|
| 🟢 Green | recalled from scratch without hints | later: the interval grows (2 -> 7 -> 21 -> 42 -> 84 days) |
| 🟡 Amber | small gaps | the same step |
| 🔴 Red | stuck | check the reference, review in 2 days |

**You** set the color, not Gemini: it only suggests. The date changes only after a recall session; a manual color change in the table leaves the schedule alone.

## Process for a new topic

1. Read the section or did the drill, compared with the reference.
2. Closed the source and wrote 3-5 questions on the topic page.
3. Answered from memory (Recall).
4. Opened the source, filled in the Reference, added notes.
5. Q questions become cards on their own: they show up on **Cards** (up to 10 new a day).

## Import: cards without a repo

**Cards -> ⇪ Import**: paste text in the `Q:`/`A:` format (the same as `learn/questions.md`) or drop a .md, pick a category, press Import. The preview shows how many cards were recognised and where the format breaks. A question that already exists in the category is not duplicated; it gets the new answer and keeps its schedule. `T:` cards are not imported here, only through a repo.

The same from a script or a chat: `POST /api/import` with the `x-automation-token` header, body `{ text, topicId | newCategory, deadline? }`.

**Diagrams and images in cards.** Inside a ``` fence an answer keeps its indentation and blank lines, so ASCII diagrams stay aligned. Images: `POST /api/images` with the token, body `{ data: <base64>, mime: "image/png", alt? }` returns `{ id, url, markdown }`; put `markdown` (`![alt](/api/images/17)`) into `A:`. Images live in the database (table `CardImage`), up to 3 MB each.

**Glossary.** Each category can have a glossary (table `GlossaryTerm`). In card answers the first occurrence of each term of the card's category (and of global terms) is underlined; hover or tap shows the explanation. Code blocks are not touched. The category page lists the whole glossary. From a script or a chat: `PUT /api/glossary` with the token, body `{ topicId?, terms: [{ term, aliases?, definition }] }` (same term updates, no duplicates); `GET /api/glossary?topicId=…`; `DELETE /api/glossary { topicId?, term }`. No `topicId` = a global term.

## Category deadline

Preparing for a date (an interview): on the category page set **⏱ Deadline** (or `deadline: 2026-10-19` in `topic.md` for repo cards). Until that date:
- the category's cards go first in Review, the nearer deadline higher; its new cards are all taken at once, the 10 a day limit does not apply to them;
- intervals are squeezed into the days left: each next review is roughly twice as long (1, 2, 4 days...), but none jumps past the day before the deadline; with one day left, daily; "forgot" is always tomorrow.

After the deadline the category becomes regular: the ladder 1 -> 3 -> 7 -> 14 -> 30 -> 60 -> 120, no priority.

## Repo cards (Sources)

Code and the cards about it live in the repo with the material, in the `learn/` folder. Two layouts:

```
learn/topic.md + learn/questions.md                    one topic for the whole repo (graphql-base)
learn/<module>/topic.md + learn/<module>/questions.md  a topic per folder (system-design-reps)
```

`topic.md` is front matter: `name`, `track`, optionally `notes:` (a file in the repo that becomes the topic notes, e.g. the module README), `drill:` (the drills folder) and `deadline:` (YYYY-MM-DD, see "Category deadline"). Each folder becomes its own topic with its own color and reviews.

```
Q: What is null bubbling?
A: A non-null field failed, the null bubbles up to the nearest nullable parent.

T: Write a DataLoader from scratch
Ref: drills/02-medium/06-dataloader-by-hand.ts
Check: npx tsx drills/02-medium/06-dataloader-by-hand.ts
```

- **Q** = explain in words. Becomes a card on the Cards page.
- **T** = write code by hand. App only: Recall shows the task, you write from scratch, then open the reference (Ref) and run Check.

How data gets into the app:
1. After studying you write a summary in your own words; Claude turns it into cards in `learn/questions.md`.
2. Push. CI in the repo checks the format (a broken card or a missing Ref gives a red check).
3. The app pulls on opening Today (at most once per 10 min and only when the repo has new commits) or with the **Sync** button on Sources.

Sync rules:
- a file with an error is not imported at all; the error is shown on Sources;
- a card is recognised by its question text: a changed answer updates the card (its schedule stays); a changed question is a new card;
- a card deleted from the file disappears from the app; a deleted module folder loses its cards, the topic stays as a regular one;
- your answers from memory, colors and schedules are never touched by Sync; neither are questions added by hand in the app;
- a repo card edited in the app (All cards -> ✎) is no longer updated by Sync; if the question later leaves the file, the card stays in the app as a regular one;
- a repo card deleted in the app (All cards -> ✕) is not recreated by Sync while the question is in the file; a rewritten question arrives as a new card;
- on the topic and Questions pages repo cards are read-only; they change through All cards or in the file;
- Sources shows after a Sync how many such cards there are: "2 edited in app, 1 deleted in app".

A private repo: `GITHUB_TOKEN` in `.env` (fine-grained, Contents: read-only). Without a token GitHub allows 60 requests an hour, which is enough.

## Gemini

`.env` can list several models separated by commas: `GEMINI_MODEL="gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash-lite"`. The first is primary, the rest are fallbacks.
- Quota (429), overload (503), a cut-off reply, 404, a broken reply, or a silent model (45 s before the first chunk or 30 s of silence mid-reply): the app moves to the next model at once. Only the last one in the list is retried on a 503 or a cut-off, after 2 s: there is nowhere else to go.
- The reply streams in chunks, so a long reply is never cut; only silence is. The overall limit for the day plan is 3 min.
- While you wait (day plan, evening review, a grade in Recall) a status line sits under the button: model, seconds, "thinking" or "writing, N chars", and what failed before. A long silence shows as "nothing new for N s".
- No model answered: the day plan is built by rules, with a red line under it giving the reason. Recall shows the reason under the button, the evening review is done without AI.
- **Sources -> Gemini**: the model order, the **🔌 Check Gemini** button (a short request to each model: works or not, and why) and the app's recent requests: which model answered and what failed. The request list lives until the app restarts.

## Rhythm

**Daily, ~25 min**
1. Cards -> Review: everything due today (Space = answer, 1/2/3 = forgot / hard / recalled).
2. Today -> one category from "Due for recall" -> Recall (due cards).
3. One question out loud in a minute.

Reviews take topics from every track, not only the current cycle: several short different topics beat one long one (interleaving).

**Weekdays:** the main work follows the current cycle and the 50 / 35 / 15 split (Node + system design / AI in TS / Python).

**Weekly: system design** ([primer](https://systemdesignschool.io/primer))
- 1 primer section: read, do the widgets and quizzes, write 3-5 questions;
- its drill, if there is one (the Drill column in Topics);
- 1 mock, 45 min.

Order: §7 -> §8 -> §9 -> §10 (master template) -> §11 per component -> §12-13 as a skill -> §14 deep dives.

**Sunday, ~20 min:** triage the Inbox, look over the colors in Topics, write the cycle Retro if it ends, pick a primer section.

## Cycles and topics

You make the plan yourself: on the **Cycles** page add a focus ("Node: pool, retries, races") and add topics right in the cycle card. The first cycle becomes active automatically. No dates, only order and status.

Topics without a cycle are added on the **Topics** page (the "+ New topic" row). At the start there is one topic, **GraphQL**, with notes and your DataLoader; its cards come from the graphql-base repo.

One cycle at a time. No new one until the current one is finished.

## Time and streak

- **Log time** (on Today, Stats and the topic page): minutes + what you did (Study, Drill, Questions, Reading). Topic or track optional.
- Recall sessions and mocks log themselves, by timer.
- **Streak** = consecutive days with anything at all: a time entry or a tick in the checklist. If nothing is done yet today, the streak holds until the end of the day.
- **Stats**: time per day, week, total, by track, topic or kind of work, plus the activity calendar.

## What not to do

- Don't rewrite videos or articles into notes. Only questions and answers from memory.
- Don't give 🟢 for "re-read it and it all made sense".
- Don't ask Gemini to generate questions: writing them yourself is half the learning.
- Don't polish the app instead of studying. A new feature is a task for cycle 2, not daily work.

---

The original Notion version (CSV, formulas, views): `docs/notion/`.
