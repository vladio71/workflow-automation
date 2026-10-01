import 'server-only';
import { ApiError, GoogleGenAI, ThinkingLevel, type Content } from '@google/genai';
import { z } from 'zod';

/**
 * Gemini напряму, без абстракцій. Ключ і модель з .env.
 * Три ролі AI в апці (питання AI НЕ генерує, їх пишеш ти):
 *   1. екзаменатор: порівнює відповідь з пам'яті з еталоном
 *   2. інтерв'юер: уточнювальне питання після відповіді (в тому ж gradeAnswer)
 *   3. mock system design: веде 45-хвилинну задачу
 */
/**
 * GEMINI_MODEL може бути списком через кому: перша модель основна, решта запасні.
 * Наприклад GEMINI_MODEL="gemini-3.8-flash,gemini-2.5-flash-lite".
 */
const MODELS: string[] = (process.env.GEMINI_MODEL || 'gemini-3.8-flash')
  .split(',')
  .map((model) => model.trim())
  .filter((model) => model.length > 0);

/**
 * SDK за замовчуванням не має таймауту: запит може висіти скільки завгодно, а кнопка "Planning…" разом з ним.
 * Таймаут на одну спробу; спливло = одразу помилка (і план за правилами), без переходу на інші моделі,
 * щоб загальне очікування було передбачуване.
 */
const PLAN_TIMEOUT_MS = 30_000;
const GRADE_TIMEOUT_MS = 60_000;

/** 429 = ліміт free tier, 500/503 = Google перевантажений. Це минає, тому пробуємо ще раз. */
const TEMPORARY_STATUSES = [429, 500, 503];
const RETRIES_PER_MODEL = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Виклик з повторами: тимчасова помилка -> пауза і ще раз; модель зайнята або прибрана (404) -> наступна зі списку.
 * Інші помилки (невалідний ключ, поганий запит) кидаємо одразу, повтор їх не вилікує.
 */
async function callWithFallback<T>(call: (model: string) => Promise<T>): Promise<T> {
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= RETRIES_PER_MODEL; attempt += 1) {
      try {
        return await call(model);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`Gemini (${model}) не відповів вчасно, спробуй ще раз пізніше`);
        }
        if (!(error instanceof ApiError)) throw error;
        if (error.status === 404) break; // модель недоступна: одразу до наступної
        if (!TEMPORARY_STATUSES.includes(error.status)) throw error;
        if (attempt < RETRIES_PER_MODEL) await sleep(1500 * attempt);
      }
    }
  }
  throw new Error(
    `Gemini is busy or unavailable (tried: ${MODELS.join(', ')}). Try again in a minute, or add a fallback model to GEMINI_MODEL.`,
  );
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

let client: GoogleGenAI | undefined;
function gemini(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

// ------------------------------------------------------------------ 1-2. оцінка відповіді

const GradeSchema = z.object({
  score: z.number().min(0).max(100),
  covered: z.array(z.string()),
  missed: z.array(z.string()),
  wrong: z.array(z.string()),
  followUp: z.string(),
  suggested: z.enum(['RED', 'AMBER', 'GREEN']),
});
export type GradeResult = z.infer<typeof GradeSchema>;

/** Та сама схема для Gemini (structured output), щоб модель повертала рівно такий JSON. */
const GRADE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    covered: { type: 'array', items: { type: 'string' } },
    missed: { type: 'array', items: { type: 'string' } },
    wrong: { type: 'array', items: { type: 'string' } },
    followUp: { type: 'string' },
    suggested: { type: 'string', enum: ['RED', 'AMBER', 'GREEN'] },
  },
  required: ['score', 'covered', 'missed', 'wrong', 'followUp', 'suggested'],
};

export interface GradeInput {
  topic: string;
  question: string;
  reference: string;
  notes: string;
  answer: string;
}

const GRADER_INSTRUCTION = `Ти екзаменатор для senior backend розробника, який готується до співбесід.
Він відповідав З ПАМ'ЯТІ. Порівняй його відповідь з еталоном і нотатками.
Правила:
- Оцінюй суть, а не формулювання. Своїми словами = добре.
- covered: що він правильно назвав (коротко, 3-8 слів на пункт).
- missed: важливе з еталону, чого немає у відповіді. Тільки суттєве.
- wrong: фактичні помилки. Якщо немає, порожній масив.
- followUp: ОДНЕ уточнювальне питання англійською, як на реальній співбесіді, що копає глибше в слабке місце.
- suggested: GREEN якщо суть повна і без помилок, AMBER якщо дрібні прогалини, RED якщо пропущене ключове або є помилка.
- Пункти covered/missed/wrong пиши українською.`;

export async function gradeAnswer(input: GradeInput): Promise<GradeResult> {
  const prompt = [
    `Тема: ${input.topic}`,
    `Питання: ${input.question}`,
    `Еталон:\n${input.reference || '(немає, орієнтуйся на нотатки і власні знання)'}`,
    `Нотатки по темі:\n${input.notes || '(немає)'}`,
    `Відповідь з пам'яті:\n${input.answer}`,
  ].join('\n\n');

  const response = await callWithFallback((model) => gemini().models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: GRADER_INSTRUCTION,
      responseMimeType: 'application/json',
      responseJsonSchema: GRADE_JSON_SCHEMA,
      temperature: 0.2,
      httpOptions: { timeout: GRADE_TIMEOUT_MS },
    },
  }));
  // Межа з мережею: навіть зі structured output перевіряємо форму, а не віримо на слово.
  return GradeSchema.parse(JSON.parse(response.text ?? '{}'));
}

// ------------------------------------------------------------------ 3. mock system design

export interface ChatTurn {
  role: 'USER' | 'MODEL';
  content: string;
}

function mockInstruction(problem: string): string {
  return `You are a senior system design interviewer at a product company. The candidate is a backend engineer (Node.js/TypeScript) interviewing for a senior role.
Problem: "${problem}". The interview lasts 45 minutes.
Follow the flow: 1) functional and non-functional requirements, 2) back-of-the-envelope estimates, 3) API, 4) data model, 5) high-level design, 6) deep dives into bottlenecks and trade-offs.
Rules:
- Ask ONE question or give ONE nudge per message. Keep messages short (2-5 sentences).
- Do not design the system for the candidate. If they are stuck, give a small hint, not the answer.
- Push on trade-offs: consistency vs availability, caching and invalidation, queues, idempotency, sharding, failure modes.
- When the candidate writes "END", stop interviewing and give structured feedback: strengths, gaps, what a strong senior answer would include, and a hire/no-hire signal with reasoning.`;
}

function toContents(history: ChatTurn[]): Content[] {
  return history.map((turn) => ({
    role: turn.role === 'USER' ? 'user' : 'model',
    parts: [{ text: turn.content }],
  }));
}

export async function* streamMockReply(problem: string, history: ChatTurn[]): AsyncGenerator<string> {
  // Повтор тільки на старті: коли текст уже пішов у чат, переключати модель посеред відповіді не можна.
  const stream = await callWithFallback((model) => gemini().models.generateContentStream({
    model,
    contents: toContents(history),
    config: { systemInstruction: mockInstruction(problem), temperature: 0.6 },
  }));
  for await (const chunk of stream) {
    if (chunk.text) yield chunk.text;
  }
}

// ------------------------------------------------------------------ 4. план дня і вечірній огляд

const DayPlanSchema = z.object({
  summary: z.string(),
  items: z.array(z.object({ id: z.string(), minutes: z.number().int().min(5).max(180), why: z.string() })),
});
export type DayPlanResult = z.infer<typeof DayPlanSchema>;

const DAY_PLAN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          minutes: { type: 'integer', minimum: 5, maximum: 180 },
          why: { type: 'string' },
        },
        required: ['id', 'minutes', 'why'],
      },
    },
  },
  required: ['summary', 'items'],
};

const PLANNER_INSTRUCTION = `Ти коуч з навчання для senior backend розробника, який шукає роботу і вчить Node, system design, AI на TypeScript і Python.
Склади план на СЬОГОДНІ тільки з наданих кандидатів (використовуй їхні id без змін, нічого не вигадуй).
Кандидати з позначкою [MUST] — сьогоднішня частина навчальних планів і повторювані справи, вже відібрані кодом:
бери їх УСІ, кроки одного плану в тому ж порядку, хвилини не міняй. PLAN = крок плану, RECALL "Redo" = переробка задачі з нуля.
Інші кандидати додавай тільки в залишок бюджету.
Правила системи:
- CARDS (картки на сьогодні) і хоча б одне повторення (RECALL) щодня, якщо вони є серед кандидатів.
- Спершу червоні/найстаріші повторення, потім робота по поточному циклу. Не більше 2-3 повторень за день.
- Одна тема циклу за раз. QUESTIONS для теми, над якою працюєш, це частина роботи, а не окрема тема.
- SYSTEM_DESIGN і MOCK (якщо є серед кандидатів) приблизно раз на тиждень; MOCK краще у вихідні або коли є 45+ хвилин.
- LEVEL = вправа live coding під співбесіду: пишеш код, тести мають позеленіти. Якщо LEVEL є серед кандидатів, бери 1-2 на день:
  спершу "Level redo" (настав термін повтору), потім нова. Став їх у першу половину дня, поки свіжа голова.
  У день фокусу на live-code рівні приходять як [MUST]: бери всі.
- TASK = справа поза навчанням (резюме, деплой). [MUST] TASK постав туди, де її зручно зробити.
  Разову TASK бери, коли є місце в бюджеті, особливо якщо вона висить кілька днів; одну-дві за день, не більше.
- Якщо вказано фокус дня, його пункти (кроки плану або рівні) вже стоять першими серед [MUST]; з решти кандидатів бери те, що не заважає фокусу.
- Побажання користувача на день враховуй, але вибирай тільки з кандидатів.
- Вклади план у бюджет часу. Краще 3-5 пунктів, які реально зробити, ніж 8.
- Порядок пунктів = порядок виконання. Апка сама ставить CARDS першими (розминка) і найбільший пункт одразу після них, тож пиши why з цим порядком.
- why: одне коротке речення українською, чому цей пункт сьогодні.
- summary: 1-2 речення українською, головний фокус дня.`;

export interface DayPlanInput {
  weekday: string;
  minutesBudget: number;
  /** назва навчального плану у фокусі або null */
  focus: string | null;
  /** побажання на день вільним текстом, може бути порожнім */
  wish: string;
  candidates: { id: string; kind: string; title: string; defaultMinutes: number; mandatory: boolean; note: string }[];
  yesterdayUndone: string[];
}

export async function generateDayPlan(input: DayPlanInput): Promise<DayPlanResult> {
  const prompt = [
    `Сьогодні: ${input.weekday}. Бюджет часу: ${input.minutesBudget} хв.`,
    input.focus ? `Фокус дня: ${input.focus}.` : 'Фокусу на день немає.',
    input.wish ? `Побажання на день: ${input.wish}` : '',
    input.yesterdayUndone.length ? `Вчора не зроблено: ${input.yesterdayUndone.join('; ')}` : 'Вчора план виконано або його не було.',
    'Кандидати (id | тип | що | звичайний час | примітка):',
    ...input.candidates.map((c) => `${c.mandatory ? '[MUST] ' : ''}${c.id} | ${c.kind} | ${c.title} | ${c.defaultMinutes} хв${c.note ? ` | ${c.note}` : ''}`),
  ].filter((line) => line !== '').join('\n');

  const response = await callWithFallback((model) => gemini().models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: PLANNER_INSTRUCTION,
      responseMimeType: 'application/json',
      responseJsonSchema: DAY_PLAN_JSON_SCHEMA,
      temperature: 0.3,
      // план з готових кандидатів не потребує глибоких роздумів: LOW у рази швидше за дефолтний medium
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      httpOptions: { timeout: PLAN_TIMEOUT_MS },
    },
  }));
  return DayPlanSchema.parse(JSON.parse(response.text ?? '{}'));
}

export interface DayReviewInput {
  items: { title: string; minutes: number; done: boolean }[];
  recalls: string[];
}

export async function reviewDay(input: DayReviewInput): Promise<string> {
  const prompt = [
    'План на сьогодні і що виконано:',
    ...input.items.map((item) => `[${item.done ? 'x' : ' '}] ${item.title} (${item.minutes} хв)`),
    input.recalls.length ? `Повторення сьогодні (тема: колір): ${input.recalls.join('; ')}` : 'Повторень сьогодні не було.',
  ].join('\n');

  const response = await callWithFallback((model) => gemini().models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: `Ти коуч з навчання. Дай короткий вечірній огляд українською, 3-5 речень, без води і без похвали заради похвали:
1) що зроблено (конкретно), 2) що не зроблено і чи варто це переносити на завтра, 3) одна порада на завтра.
Якщо повторення були червоними, нагадай, що через 2 дні їх треба повторити з нуля. Не пропонуй нові теми.`,
      temperature: 0.4,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      httpOptions: { timeout: PLAN_TIMEOUT_MS },
    },
  }));
  return (response.text ?? '').trim();
}

// ------------------------------------------------------------------ 5. картки відпочинку для скрині

/** Види карток, які шукає Gemini (меми беремо з xkcd, без AI). */
export type SearchedRestKind = 'NEWS' | 'ARTICLE' | 'MUSIC' | 'ANIME' | 'FILM';

export interface RestCardDraft {
  kind: SearchedRestKind;
  title: string;
  body: string;
  url: string;
}

export interface RestCardsRequest {
  /** "середа, 30 вересня 2026" */
  today: string;
  interests: string;
  counts: Record<SearchedRestKind, number>;
}

const RestCardsSchema = z.object({
  cards: z.array(z.object({
    kind: z.enum(['NEWS', 'ARTICLE', 'MUSIC', 'ANIME', 'FILM']),
    title: z.string().min(1),
    body: z.string(),
    url: z.string(),
  })),
});

const REST_CARDS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['NEWS', 'ARTICLE', 'MUSIC', 'ANIME', 'FILM'] },
          title: { type: 'string' },
          body: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['kind', 'title', 'body', 'url'],
      },
    },
  },
  required: ['cards'],
};

const REST_CARDS_INSTRUCTION = `Ти підбираєш перерви для розробника, який багато вчиться. Кожна картка = готове рішення:
він відкриває її і нічого не вибирає, одразу дивиться, слухає чи читає.
Шукай у Google і бери тільки реальні сторінки, які знайшов. Нічого не вигадуй: ні назв, ні посилань.
title: коротко; назви фільмів, аніме, альбомів мовою оригіналу.
body: 1-3 речення українською: що це і чим зачепить. Без реклами і без "обов'язково подивіться".
url: пряме https-посилання на сторінку, яку знайшов.`;

const KIND_ASK: Record<SearchedRestKind, string> = {
  NEWS: 'NEWS: свіжа (останні 3 дні) цікава новина, яку приємно прочитати за 5 хвилин',
  ARTICLE: 'ARTICLE: цікава стаття або есе на 5-7 хвилин читання (не новина)',
  MUSIC: 'MUSIC: конкретний альбом, EP або мікс, який слухається за ~20 хвилин; посилання на YouTube, Bandcamp або Spotify',
  ANIME: 'ANIME: аніме, яке виходить у цьому сезоні, і конкретна серія, з якої почати (номер серії в body); посилання на MyAnimeList, AniList або Crunchyroll',
  FILM: 'FILM: фільм останніх двох років з високими оцінками критиків і глядачів; посилання на IMDb або Letterboxd',
};

const SEARCHED_KINDS: readonly SearchedRestKind[] = ['NEWS', 'ARTICLE', 'MUSIC', 'ANIME', 'FILM'];

function restCardsPrompt(request: RestCardsRequest): string {
  const lines = SEARCHED_KINDS
    .filter((kind) => request.counts[kind] > 0)
    .map((kind) => `- ${KIND_ASK[kind]}: ${request.counts[kind]} шт.`);
  return [
    `Сьогодні ${request.today}.`,
    `Інтереси для NEWS і ARTICLE: ${request.interests}`,
    'Знайди:',
    ...lines,
    'Усі картки різні. Поверни JSON {"cards": [...]}.',
  ].join('\n');
}

function parseRestCards(text: string): RestCardDraft[] {
  // без structured output модель може обгорнути JSON у ```json … ```: беремо від першої { до останньої }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return [];
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const parsed = RestCardsSchema.safeParse(json);
  if (!parsed.success) return [];
  return parsed.data.cards.filter((card) => card.url.startsWith('https://'));
}

const REST_TIMEOUT_MS = 90_000;

/**
 * Gemini + Google Search: новини, статті, музика, аніме, фільм для скрині.
 * Structured output разом з пошуком підтримують моделі Gemini 3; якщо API відмовить (400), просимо JSON текстом.
 */
export async function findRestCards(request: RestCardsRequest): Promise<RestCardDraft[]> {
  const prompt = restCardsPrompt(request);
  try {
    const response = await callWithFallback((model) => gemini().models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: REST_CARDS_INSTRUCTION,
        tools: [{ googleSearch: {} }],
        responseMimeType: 'application/json',
        responseJsonSchema: REST_CARDS_JSON_SCHEMA,
        temperature: 0.9,
        httpOptions: { timeout: REST_TIMEOUT_MS },
      },
    }));
    return parseRestCards(response.text ?? '');
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 400) throw error;
    const response = await callWithFallback((model) => gemini().models.generateContent({
      model,
      contents: `${prompt}\nВідповідай тільки JSON, без тексту навколо.`,
      config: {
        systemInstruction: REST_CARDS_INSTRUCTION,
        tools: [{ googleSearch: {} }],
        temperature: 0.9,
        httpOptions: { timeout: REST_TIMEOUT_MS },
      },
    }));
    return parseRestCards(response.text ?? '');
  }
}
