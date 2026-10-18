import { rejectUnlessAutomation } from '@/lib/automation';
import { ensureTodayPlan } from '@/lib/plan-auto';

/**
 * Morning script (morning.ps1): build today's plan if there is none yet, so the app opens on the tasks
 * instead of the "Plan my day" button. An existing plan is left untouched. Requires the token (x-automation-token).
 */

// Gemini can take 20-40 s
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;

  const result = await ensureTodayPlan();
  return Response.json(result, { status: result.error ? 500 : 200 });
}
