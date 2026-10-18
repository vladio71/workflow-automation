import 'server-only';
import { randomUUID } from 'node:crypto';

/**
 * Status of in-flight Gemini requests: which model, how many seconds, thinking or writing, what failed.
 * The client polls /api/ai/status?job=<id> once a second and shows it under the button.
 * Lives in process memory (on globalThis so server actions and route handlers see the same Map).
 */

export type AiTask = 'plan' | 'review' | 'grade' | 'check';
export type AiPhase = 'waiting' | 'thinking' | 'writing';
export type AiJobState = 'running' | 'done' | 'failed';

/** How an attempt ended: decides whether to move on to the next model. */
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
  /** human-readable: "daily limit (429)" */
  detail: string;
  ms: number;
}

export interface AiJob {
  id: string;
  task: AiTask;
  label: string;
  state: AiJobState;
  /** model being tried now (or the one that answered) */
  model: string | null;
  phase: AiPhase;
  startedAt: number;
  attemptStartedAt: number;
  endedAt: number | null;
  /** answer characters received so far */
  chars: number;
  /** "thought" chunks received (shows the model is alive before the answer starts) */
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

/** The id comes from the client (so it can poll status before the answer); an invalid format gets a fresh id. */
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
  // old entries are dropped: this is a board of current requests, not a history
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

/** Recent requests, newest first: for the Sources page. */
export function recentJobs(limit = 10): AiJob[] {
  return [...store().values()].reverse().slice(0, limit);
}
