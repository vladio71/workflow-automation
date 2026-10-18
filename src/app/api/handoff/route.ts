import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { rejectUnlessAutomation } from '@/lib/automation';
import { MAX_FIRST_STEP, setFirstStep } from '@/lib/handoff';

/**
 * Evening handoff from desk.py (Ctrl+Pause): "tomorrow I start with ...".
 * Body: { "firstStep": "..." }. An empty string clears it. Requires the token (x-automation-token).
 */

const BodySchema = z.object({ firstStep: z.string().max(MAX_FIRST_STEP) });

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'очікую { firstStep: string }' }, { status: 400 });

  const day = await setFirstStep(parsed.data.firstStep);
  revalidatePath('/', 'layout');
  return Response.json({ day: day.toISOString().slice(0, 10), firstStep: parsed.data.firstStep.trim().slice(0, MAX_FIRST_STEP) });
}
