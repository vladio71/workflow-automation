import 'server-only';
import { GoogleGenAI, type Content } from '@google/genai';
import { z } from 'zod';

/**
 * Gemini напряму, без абстракцій. Ключ і модель з .env.
 * Три ролі AI в апці (питання AI НЕ генерує, їх пишеш ти):
 *   1. екзаменатор: порівнює відповідь з пам'яті з еталоном
 *   2. інтерв'юер: уточнювальне питання після відповіді (в тому ж gradeAnswer)
 *   3. mock system design: веде 45-хвилинну задачу
 */
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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

  const response = await gemini().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      systemInstruction: GRADER_INSTRUCTION,
      responseMimeType: 'application/json',
      responseJsonSchema: GRADE_JSON_SCHEMA,
      temperature: 0.2,
    },
  });
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
  const stream = await gemini().models.generateContentStream({
    model: MODEL,
    contents: toContents(history),
    config: { systemInstruction: mockInstruction(problem), temperature: 0.6 },
  });
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
Правила системи:
- Anki і хоча б одне повторення (RECALL) щодня, якщо вони є серед кандидатів.
- Спершу червоні/найстаріші повторення, потім робота по поточному циклу. Не більше 2-3 повторень за день.
- Одна тема циклу за раз. QUESTIONS для теми, над якою працюєш, це частина роботи, а не окрема тема.
- SYSTEM_DESIGN і MOCK приблизно раз на тиждень; MOCK краще у вихідні або коли є 45+ хвилин.
- Вклади план у бюджет часу. Краще 3-5 пунктів, які реально зробити, ніж 8.
- Порядок пунктів = порядок виконання.
- why: одне коротке речення українською, чому цей пункт сьогодні.
- summary: 1-2 речення українською, головний фокус дня.`;

export interface DayPlanInput {
  weekday: string;
  minutesBudget: number;
  candidates: { id: string; kind: string; title: string; defaultMinutes: number }[];
  yesterdayUndone: string[];
}

export async function generateDayPlan(input: DayPlanInput): Promise<DayPlanResult> {
  const prompt = [
    `Сьогодні: ${input.weekday}. Бюджет часу: ${input.minutesBudget} хв.`,
    input.yesterdayUndone.length ? `Вчора не зроблено: ${input.yesterdayUndone.join('; ')}` : 'Вчора план виконано або його не було.',
    'Кандидати (id | тип | що | звичайний час):',
    ...input.candidates.map((c) => `${c.id} | ${c.kind} | ${c.title} | ${c.defaultMinutes} хв`),
  ].join('\n');

  const response = await gemini().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      systemInstruction: PLANNER_INSTRUCTION,
      responseMimeType: 'application/json',
      responseJsonSchema: DAY_PLAN_JSON_SCHEMA,
      temperature: 0.3,
    },
  });
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

  const response = await gemini().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      systemInstruction: `Ти коуч з навчання. Дай короткий вечірній огляд українською, 3-5 речень, без води і без похвали заради похвали:
1) що зроблено (конкретно), 2) що не зроблено і чи варто це переносити на завтра, 3) одна порада на завтра.
Якщо повторення були червоними, нагадай, що через 2 дні їх треба повторити з нуля. Не пропонуй нові теми.`,
      temperature: 0.4,
    },
  });
  return (response.text ?? '').trim();
}
