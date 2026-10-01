'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { modelLabel } from '@/lib/ai-labels';

/**
 * Рядок "що зараз з Gemini" під кнопкою, поки чекаємо відповідь: модель, секунди, думає чи пише,
 * скільки вже прийшло, і що впало до цього ("3.8 Flash: ліміт (429) → пробую 3.7 Flash").
 * Питає /api/ai/status кожні 0,8 с, тільки поки active.
 */
const POLL_MS = 800;
/** стільки секунд тиші, і показуємо "нічого нового N с": видно, що модель, можливо, зависла */
const QUIET_AFTER_S = 8;

const AttemptSchema = z.object({ model: z.string(), outcome: z.string(), detail: z.string(), ms: z.number() });
const JobSchema = z.object({
  state: z.enum(['running', 'done', 'failed']),
  model: z.string().nullable(),
  phase: z.enum(['waiting', 'thinking', 'writing']),
  startedAt: z.number(),
  attemptStartedAt: z.number(),
  chars: z.number(),
  thoughts: z.number(),
  lastChunkAt: z.number().nullable(),
  attempts: z.array(AttemptSchema),
  now: z.number(),
});
type JobView = z.infer<typeof JobSchema>;

function phaseText(job: JobView): string {
  if (job.phase === 'writing') return `пише відповідь, ${job.chars.toLocaleString('uk-UA')} симв.`;
  if (job.phase === 'thinking') return 'думає';
  return 'чекає відповіді';
}

export function AiStatus({ jobId, active }: { jobId: string | null; active: boolean }) {
  const [job, setJob] = useState<JobView | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/ai/status?job=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
        // тіло читаємо завжди, і на 404 теж: непрочитана відповідь лишається відкритим запитом у браузері
        const body: unknown = await response.json();
        if (!response.ok) return;
        const parsed = JobSchema.safeParse(body);
        if (!stopped && parsed.success) setJob(parsed.data);
      } catch {
        // мережа моргнула: наступне опитування спробує ще раз
      }
    };
    void load();
    if (!active) return () => { stopped = true; };
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [jobId, active]);

  useEffect(() => {
    if (!active) return;
    setJob(null);
  }, [jobId, active]);

  if (!jobId) return null;
  if (!job) {
    // запит ще не дійшов до Gemini: апка спершу збирає кандидатів з бази
    return active ? <p className="ai-status faint" data-testid="ai-status">⏳ готую запит до Gemini…</p> : null;
  }

  const trail = job.attempts.map((attempt) => `${modelLabel(attempt.model)}: ${attempt.detail}`).join(' → ');
  if (active && job.state === 'done') {
    return <p className="ai-status faint" data-testid="ai-status">✓ {job.model ? modelLabel(job.model) : 'Gemini'} відповів, зберігаю…</p>;
  }
  if (active && job.state === 'failed') {
    return <p className="ai-status faint" data-testid="ai-status">⚠️ Gemini не відповів ({trail}), роблю без нього…</p>;
  }

  if (job.state === 'running') {
    const seconds = Math.max(0, Math.round((job.now - job.startedAt) / 1000));
    const quiet = Math.round((job.now - (job.lastChunkAt ?? job.attemptStartedAt)) / 1000);
    return (
      <p className="ai-status" data-testid="ai-status">
        {trail && <span className="faint">{trail} → </span>}
        ⏳ <b>{job.model ? modelLabel(job.model) : 'Gemini'}</b> · {seconds} с · {phaseText(job)}
        {quiet >= QUIET_AFTER_S && <span className="ai-status-quiet"> · нічого нового {quiet} с</span>}
      </p>
    );
  }

  // успіх після запасної моделі: варто знати, що основна впала; звичайний успіх нічого не показує
  if (job.state === 'done' && trail && job.model) {
    return <p className="ai-status faint" data-testid="ai-status">✓ відповів {modelLabel(job.model)} (до цього {trail})</p>;
  }
  return null;
}
