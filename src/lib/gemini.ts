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
