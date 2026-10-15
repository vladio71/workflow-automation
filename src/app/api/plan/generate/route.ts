import { rejectUnlessAutomation } from '@/lib/automation';
import { ensureTodayPlan } from '@/lib/plan-auto';

/**
 * Ранковий скрипт (morning.ps1): скласти план на сьогодні, якщо його ще нема, щоб апка відкрилась одразу
 * на задачі, а не на кнопці "Plan my day". Якщо план уже є, нічого не чіпає. Тільки з токеном (x-automation-token).
 */

// Gemini може думати 20-40 с
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;

  const result = await ensureTodayPlan();
  return Response.json(result, { status: result.error ? 500 : 200 });
}
