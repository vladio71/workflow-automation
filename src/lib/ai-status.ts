import 'server-only';
import { randomUUID } from 'node:crypto';

/**
 * Статус запитів до Gemini, поки вони йдуть: яка модель, скільки секунд, думає чи вже пише, що впало.
 * Клієнт питає /api/ai/status?job=<id> раз на секунду і показує це під кнопкою.
 * Живе в пам'яті процесу (на globalThis, щоб server actions і route handlers бачили один і той самий Map).
 */

export type AiTask = 'plan' | 'review' | 'grade' | 'check';
export type AiPhase = 'waiting' | 'thinking' | 'writing';
export type AiJobState = 'running' | 'done' | 'failed';

/** Чим закінчилась спроба: від цього залежить, чи йти до наступної моделі. */
export type AttemptOutcome =
  | 'ok'
  | 'quota'
  | 'overloaded'
  | 'not-found'
  | 'stalled'
  | 'timeout'
  | 'bad-request'
  | 'auth'
  | 'bad-answer'
  | 'error';

export interface AttemptRecord {
  model: string;
  outcome: AttemptOutcome;
  /** людською мовою: "ліміт на день (429)" */
  detail: string;
  ms: number;
}

export interface AiJob {
  id: string;
  task: AiTask;
  label: string;
  state: AiJobState;
  /** модель, яку пробуємо зараз (або яка відповіла) */
  model: string | null;
  phase: AiPhase;
  startedAt: number;
  attemptStartedAt: number;
  endedAt: number | null;
  /** скільки символів відповіді вже прийшло */
  chars: number;
  /** скільки шматків "роздумів" прийшло (видно, що модель жива, ще до відповіді) */
  thoughts: number;
  lastChunkAt: number | null;
  attempts: AttemptRecord[];
  error: string | null;
}

const MAX_JOBS = 30;
const JOB_ID = /^[A-Za-z0-9-]{8,64}$/;

interface JobsGlobal {
  aiJobs?: Map<string, AiJob>;
}

function store(): Map<string, AiJob> {
  const holder = globalThis as JobsGlobal;
  holder.aiJobs ??= new Map();
  return holder.aiJobs;
}

/** id приходить з клієнта (щоб він міг питати статус ще до відповіді); чужий формат = свій id. */
export function startJob(task: AiTask, label: string, clientId?: string): AiJob {
  const jobs = store();
  const id = clientId && JOB_ID.test(clientId) ? clientId : randomUUID();
  const now = Date.now();
  const job: AiJob = {
    id,
    task,
    label,
    state: 'running',
    model: null,
    phase: 'waiting',
    startedAt: now,
    attemptStartedAt: now,
    endedAt: null,
    chars: 0,
    thoughts: 0,
    lastChunkAt: null,
    attempts: [],
    error: null,
  };
  jobs.set(id, job);
  // старі записи прибираємо: це не історія, а табло поточних запитів
  while (jobs.size > MAX_JOBS) {
    const oldest = jobs.keys().next().value;
    if (oldest === undefined) break;
    jobs.delete(oldest);
  }
  return job;
}

export function getJob(id: string): AiJob | null {
  return store().get(id) ?? null;
}

/** Останні запити, новіші першими: для сторінки Sources. */
export function recentJobs(limit = 10): AiJob[] {
  return [...store().values()].reverse().slice(0, limit);
}
