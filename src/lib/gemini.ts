import 'server-only';
import { ApiError, GoogleGenAI, ThinkingLevel, type Content, type GenerateContentConfig, type GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { startJob, type AiJob, type AiTask, type AttemptOutcome, type AttemptRecord } from './ai-status';
import { modelLabel } from './ai-labels';

/**
 * Gemini напряму, без абстракцій. Ключ і модель з .env.
 * Три ролі AI в апці (питання AI НЕ генерує, їх пишеш ти):
 *   1. екзаменатор: порівнює відповідь з пам'яті з еталоном
 *   2. інтерв'юер: уточнювальне питання після відповіді (в тому ж gradeAnswer)
 *   3. mock system design: веде 45-хвилинну задачу
 */
/**
 * GEMINI_MODEL може бути списком через кому: перша модель основна, решта запасні.
 * Наприклад GEMINI_MODEL="gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash-lite".
 */
const MODELS: string[] = (process.env.GEMINI_MODEL || 'gemini-3.8-flash')
  .split(',')
  .map((model) => model.trim())
  .filter((model) => model.length > 0);

export function geminiModels(): string[] {
  return [...MODELS];
}

/**
 * Відповідь іде шматками (stream), тож видно, що модель жива. Мертвою вважаємо, якщо нічого не приходить:
 * до першого шматка 45 с (модель може думати), між шматками 30 с. Тоді обриваємо і йдемо до наступної моделі.
 * Загальний час на всі моделі разом обмежений окремо для кожної дії (план, огляд, оцінка).
 */
const FIRST_CHUNK_MS = envMs('GEMINI_FIRST_CHUNK_MS', 45_000);
const STALL_MS = envMs('GEMINI_STALL_MS', 30_000);
const PLAN_TOTAL_MS = 180_000;
const REVIEW_TOTAL_MS = 120_000;
const GRADE_TOTAL_MS = 150_000;
const CHECK_TIMEOUT_MS = 30_000;
/** пауза перед єдиним повтором: 503 чи обрив в останньої моделі списку (інші на 503 одразу поступаються наступній) */
const RETRY_PAUSE_MS = 2_000;

/** Тести ставлять менші пороги через env (разом з GEMINI_BASE_URL на підставний сервер). */
function envMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Помилка після всіх спроб: message = людський ланцюжок "3.8 Flash: ліміт на день (429) → 3.7 Flash: ...". */
export class GeminiError extends Error {
  readonly attempts: AttemptRecord[];

  constructor(message: string, attempts: AttemptRecord[]) {
    super(message);
    this.name = 'GeminiError';
    this.attempts = attempts;
  }
}

export function describeAttempts(attempts: readonly AttemptRecord[]): string {
  return attempts.map((attempt) => `${modelLabel(attempt.model)}: ${attempt.detail}`).join(' → ');
}

/** Тіло помилки Gemini: SDK кладе JSON відповіді в message. */
const ApiErrorInfoSchema = z.object({
  message: z.string().optional(),
  details: z.array(z.object({
    violations: z.array(z.object({ quotaId: z.string().optional(), quotaMetric: z.string().optional() })).optional(),
  }).passthrough()).optional(),
}).passthrough();
const ApiErrorBodySchema = z.object({ error: ApiErrorInfoSchema });
type ApiErrorInfo = z.infer<typeof ApiErrorInfoSchema>;

function apiErrorBody(error: ApiError): ApiErrorInfo | null {
  // помилка на старті: message = JSON; помилка посеред стріму: "got status: X. {JSON}"
  const start = error.message.indexOf('{');
  if (start === -1) return null;
  try {
    const parsed = ApiErrorBodySchema.safeParse(JSON.parse(error.message.slice(start)));
    return parsed.success ? parsed.data.error : null;
  } catch {
    return null;
  }
}

function short(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Який саме ліміт: з quotaId помилки 429 ("...PerDay...", "...PerMinute...", пошук Google). */
function quotaLabel(error: ApiError): string {
  const body = apiErrorBody(error);
  const ids = (body?.details ?? [])
    .flatMap((detail) => detail.violations ?? [])
    .map((violation) => `${violation.quotaId ?? ''} ${violation.quotaMetric ?? ''}`)
    .join(' ');
  if (/search|grounding/i.test(ids)) return 'ліміт пошуку Google';
  if (/PerDay/i.test(ids)) return 'ліміт на день';
  if (/PerMinute/i.test(ids)) return 'ліміт на хвилину';
  return 'ліміт';
}

type AbortReason = 'stalled' | 'deadline';

interface Classified {
  outcome: AttemptOutcome;
  detail: string;
}

/**
 * Модель почала відповідати, і відповідь обірвалась: потік закінчився посеред шматка
 * (SDK кидає "Incomplete JSON segment at the end") або з'єднання закрили з того боку (fetch кидає TypeError "terminated").
 */
function isCutStream(error: Error): boolean {
  return error.message === 'Incomplete JSON segment at the end' || (error instanceof TypeError && error.message === 'terminated');
}

function classify(error: unknown, abortReason: AbortReason | null, stallLimitMs: number): Classified {
  if (abortReason === 'stalled') return { outcome: 'stalled', detail: `завис: ${Math.round(stallLimitMs / 1000)} с без відповіді` };
  if (abortReason === 'deadline') return { outcome: 'timeout', detail: 'не вклався в загальний час' };
  // обрив посеред відповіді зазвичай те саме перевантаження, що й 503: і обробляємо так само
  if (error instanceof Error && isCutStream(error)) return { outcome: 'overloaded', detail: 'Google обірвав відповідь' };
  if (error instanceof ApiError) {
    if (error.status === 429) return { outcome: 'quota', detail: `${quotaLabel(error)} (429)` };
    if (error.status === 401 || error.status === 403) return { outcome: 'auth', detail: `ключ не підходить (${error.status})` };
    if (error.status === 404) return { outcome: 'not-found', detail: 'модель не знайдена (404)' };
    if (error.status >= 500) return { outcome: 'overloaded', detail: `Google перевантажений (${error.status})` };
    const message = apiErrorBody(error)?.message ?? error.message;
    if (error.status === 400) return { outcome: 'bad-request', detail: `помилка запиту (400): ${short(message)}` };
    return { outcome: 'error', detail: `${error.status}: ${short(message)}` };
  }
  if (error instanceof Error) return { outcome: 'error', detail: short(error.message) };
  return { outcome: 'error', detail: 'невідома помилка' };
}

type NextStep = 'retry' | 'next-model' | 'stop';

/**
 * Ліміт, 503, обрив, зависання, 404, 400 = одразу наступна модель; ключ або загальний час = стоп.
 * Повтор тієї самої моделі є тільки на 503 чи обрив в останньої в списку: далі йти вже нема куди.
 */
function nextStep(outcome: AttemptOutcome, attempt: number, lastModel: boolean): NextStep {
  if (outcome === 'auth' || outcome === 'timeout') return 'stop';
  if (outcome === 'overloaded' && lastModel && attempt === 1) return 'retry';
  return 'next-model';
}

interface StreamRequest {
  task: AiTask;
  label: string;
  jobId?: string;
  totalMs: number;
  contents: string | Content[];
  config: GenerateContentConfig;
}

type StreamResult = { ok: true; text: string } | { ok: false; attempt: AttemptRecord };

/** Одна спроба одної моделі: читаємо шматки, оновлюємо статус, обриваємо, якщо модель замовкла. */
async function streamOnce(model: string, request: StreamRequest, job: AiJob, deadline: number): Promise<StreamResult> {
  const controller = new AbortController();
  const started = Date.now();
  const watch: { lastActivity: number; gotChunk: boolean; reason: AbortReason | null } = { lastActivity: started, gotChunk: false, reason: null };
  job.model = model;
  job.phase = 'waiting';
  job.attemptStartedAt = started;
  job.chars = 0;
  job.thoughts = 0;
  job.lastChunkAt = null;

  const watchdog = setInterval(() => {
    const now = Date.now();
    if (now >= deadline) {
      watch.reason = 'deadline';
      controller.abort();
      return;
    }
    const limit = watch.gotChunk ? STALL_MS : FIRST_CHUNK_MS;
    if (now - watch.lastActivity > limit) {
      watch.reason = 'stalled';
      controller.abort();
    }
  }, 1000);

  try {
    const stream = await gemini().models.generateContentStream({
      model,
      contents: request.contents,
      config: { ...request.config, abortSignal: controller.signal },
    });
    let text = '';
    for await (const chunk of stream) {
      const now = Date.now();
      watch.lastActivity = now;
      watch.gotChunk = true;
      job.lastChunkAt = now;
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.thought === true) {
          job.thoughts += 1;
          if (job.phase === 'waiting') job.phase = 'thinking';
        } else if (typeof part.text === 'string' && part.text.length > 0) {
          text += part.text;
          job.chars = text.length;
          job.phase = 'writing';
        }
      }
    }
    if (text.trim() === '') return { ok: false, attempt: { model, outcome: 'bad-answer', detail: 'порожня відповідь', ms: Date.now() - started } };
    return { ok: true, text };
  } catch (error) {
    const { outcome, detail } = classify(error, watch.reason, watch.gotChunk ? STALL_MS : FIRST_CHUNK_MS);
    return { ok: false, attempt: { model, outcome, detail, ms: Date.now() - started } };
  } finally {
    clearInterval(watchdog);
  }
}

/**
 * Запит з переходом між моделями і статусом наживо. parse перевіряє відповідь;
 * якщо вона не розбирається, це теж невдала спроба, і йдемо до наступної моделі.
 */
async function streamWithFallback<T>(request: StreamRequest, parse: (text: string) => T): Promise<T> {
  const job = startJob(request.task, request.label, request.jobId);
  const deadline = job.startedAt + request.totalMs;
  const finishFailed = (): never => {
    job.state = 'failed';
    job.endedAt = Date.now();
    job.error = describeAttempts(job.attempts);
    console.error(`[gemini] ${request.label}: ${job.error}`);
    throw new GeminiError(job.error, job.attempts);
  };

  for (const [index, model] of MODELS.entries()) {
    const lastModel = index === MODELS.length - 1;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await streamOnce(model, request, job, deadline);
      if (result.ok) {
        try {
          const value = parse(result.text);
          job.state = 'done';
          job.endedAt = Date.now();
          return value;
        } catch {
          job.attempts.push({ model, outcome: 'bad-answer', detail: 'відповідь не розібрати', ms: Date.now() - job.attemptStartedAt });
          break;
        }
      }
      job.attempts.push(result.attempt);
      const step = nextStep(result.attempt.outcome, attempt, lastModel);
      if (step === 'stop') return finishFailed();
      if (step === 'retry' && Date.now() + RETRY_PAUSE_MS < deadline) {
        await sleep(RETRY_PAUSE_MS);
        continue;
      }
      break;
    }
    if (Date.now() >= deadline) break;
  }
  return finishFailed();
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

let client: GoogleGenAI | undefined;
function gemini(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, ...geminiHttpOptions() });
  return client;
}

/** Для тестів: GEMINI_BASE_URL веде запити на підставний сервер замість Google. */
function geminiHttpOptions(): { httpOptions?: { baseUrl: string } } {
  const baseUrl = process.env.GEMINI_BASE_URL?.trim();
  return baseUrl ? { httpOptions: { baseUrl } } : {};
}

export interface ModelCheck {
  model: string;
  outcome: AttemptOutcome;
  detail: string;
  ms: number;
}

/** Кнопка "Перевірити Gemini": по одному крихітному запиту на кожну модель зі списку. */
export async function checkModels(): Promise<ModelCheck[]> {
  const results: ModelCheck[] = [];
  for (const model of MODELS) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      const response = await gemini().models.generateContent({
        model,
        contents: 'Reply with one word: ok',
        config: { temperature: 0, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, abortSignal: controller.signal },
      });
      const text = (response.text ?? '').trim();
      results.push({ model, outcome: text ? 'ok' : 'bad-answer', detail: text ? 'працює' : 'порожня відповідь', ms: Date.now() - started });
    } catch (error) {
      const check: Classified = controller.signal.aborted
        ? { outcome: 'stalled', detail: `не відповів за ${CHECK_TIMEOUT_MS / 1000} с` }
        : classify(error, null, 0);
      results.push({ model, outcome: check.outcome, detail: check.detail, ms: Date.now() - started });
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
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

export async function gradeAnswer(input: GradeInput, jobId?: string): Promise<GradeResult> {
  const prompt = [
    `Тема: ${input.topic}`,
    `Питання: ${input.question}`,
    `Еталон:\n${input.reference || '(немає, орієнтуйся на нотатки і власні знання)'}`,
    `Нотатки по темі:\n${input.notes || '(немає)'}`,
    `Відповідь з пам'яті:\n${input.answer}`,
  ].join('\n\n');

  // Межа з мережею: навіть зі structured output перевіряємо форму, а не віримо на слово.
  return streamWithFallback(
    {
      task: 'grade',
      label: 'Оцінка відповіді',
      jobId,
      totalMs: GRADE_TOTAL_MS,
      contents: prompt,
      config: {
        systemInstruction: GRADER_INSTRUCTION,
        responseMimeType: 'application/json',
        responseJsonSchema: GRADE_JSON_SCHEMA,
        temperature: 0.2,
        // роздуми приходять шматками ще до відповіді: так видно, що модель жива
        thinkingConfig: { includeThoughts: true },
      },
    },
    (text) => GradeSchema.parse(JSON.parse(text)),
  );
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

/** Старт стріму з переходом між моделями. Тільки на старті: коли текст уже пішов у чат, модель не міняємо. */
async function startStream(contents: Content[], config: GenerateContentConfig): Promise<AsyncGenerator<GenerateContentResponse>> {
  const attempts: AttemptRecord[] = [];
  for (const [index, model] of MODELS.entries()) {
    const lastModel = index === MODELS.length - 1;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const started = Date.now();
      try {
        return await gemini().models.generateContentStream({ model, contents, config });
      } catch (error) {
        const { outcome, detail } = classify(error, null, 0);
        attempts.push({ model, outcome, detail, ms: Date.now() - started });
        const step = nextStep(outcome, attempt, lastModel);
        if (step === 'stop') throw new GeminiError(describeAttempts(attempts), attempts);
        if (step === 'retry') {
          await sleep(RETRY_PAUSE_MS);
          continue;
        }
        break;
      }
    }
  }
  throw new GeminiError(describeAttempts(attempts), attempts);
}

export async function* streamMockReply(problem: string, history: ChatTurn[]): AsyncGenerator<string> {
  const stream = await startStream(toContents(history), { systemInstruction: mockInstruction(problem), temperature: 0.6 });
  try {
    for await (const chunk of stream) {
      if (chunk.text) yield chunk.text;
    }
  } catch (error) {
    // посеред репліки модель уже не міняємо, але причину показуємо зрозуміло ("Google обірвав відповідь")
    throw new Error(classify(error, null, 0).detail);
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

export async function generateDayPlan(input: DayPlanInput, jobId?: string): Promise<DayPlanResult> {
  const prompt = [
    `Сьогодні: ${input.weekday}. Бюджет часу: ${input.minutesBudget} хв.`,
    input.focus ? `Фокус дня: ${input.focus}.` : 'Фокусу на день немає.',
    input.wish ? `Побажання на день: ${input.wish}` : '',
    input.yesterdayUndone.length ? `Вчора не зроблено: ${input.yesterdayUndone.join('; ')}` : 'Вчора план виконано або його не було.',
    'Кандидати (id | тип | що | звичайний час | примітка):',
    ...input.candidates.map((c) => `${c.mandatory ? '[MUST] ' : ''}${c.id} | ${c.kind} | ${c.title} | ${c.defaultMinutes} хв${c.note ? ` | ${c.note}` : ''}`),
  ].filter((line) => line !== '').join('\n');

  return streamWithFallback(
    {
      task: 'plan',
      label: 'План дня',
      jobId,
      totalMs: PLAN_TOTAL_MS,
      contents: prompt,
      config: {
        systemInstruction: PLANNER_INSTRUCTION,
        responseMimeType: 'application/json',
        responseJsonSchema: DAY_PLAN_JSON_SCHEMA,
        temperature: 0.3,
        // план з готових кандидатів не потребує глибоких роздумів: LOW у рази швидше за дефолтний medium;
        // роздуми приходять шматками ще до відповіді, тож видно, що модель жива
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW, includeThoughts: true },
      },
    },
    (text) => DayPlanSchema.parse(JSON.parse(text)),
  );
}

export interface DayReviewInput {
  items: { title: string; minutes: number; done: boolean }[];
  recalls: string[];
}

export async function reviewDay(input: DayReviewInput, jobId?: string): Promise<string> {
  const prompt = [
    'План на сьогодні і що виконано:',
    ...input.items.map((item) => `[${item.done ? 'x' : ' '}] ${item.title} (${item.minutes} хв)`),
    input.recalls.length ? `Повторення сьогодні (тема: колір): ${input.recalls.join('; ')}` : 'Повторень сьогодні не було.',
  ].join('\n');

  return streamWithFallback(
    {
      task: 'review',
      label: 'Огляд дня',
      jobId,
      totalMs: REVIEW_TOTAL_MS,
      contents: prompt,
      config: {
        systemInstruction: `Ти коуч з навчання. Дай короткий вечірній огляд українською, 3-5 речень, без води і без похвали заради похвали:
1) що зроблено (конкретно), 2) що не зроблено і чи варто це переносити на завтра, 3) одна порада на завтра.
Якщо повторення були червоними, нагадай, що через 2 дні їх треба повторити з нуля. Не пропонуй нові теми.`,
        temperature: 0.4,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW, includeThoughts: true },
      },
    },
    (text) => text.trim(),
  );
}
