import { revalidatePath } from 'next/cache';
import { rejectUnlessAutomation } from '@/lib/automation';
import { CreateTaskSchema, createBacklogTask, listTasks, taskToJson } from '@/lib/task-backlog';

/**
 * Беклог справ ззовні (Shortcuts на айфоні, desk.py, curl). Тільки з токеном (x-automation-token).
 *
 *   GET  /api/tasks?status=BACKLOG|TODO|IN_PROGRESS|DONE   без status: усі незроблені
 *   POST /api/tasks  { title, priority?, minutes?, repeat?, target?, until?, status?, notes? }
 *        нова справа йде в BACKLOG (повторювана одразу в TODO) і в план дня не лізе, поки не витягнеш.
 */

const STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'DONE'] as const;
type StatusParam = (typeof STATUSES)[number];

export async function GET(request: Request): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;

  const raw = new URL(request.url).searchParams.get('status');
  const status: StatusParam | undefined = STATUSES.find((value) => value === raw);
  if (raw && !status) return Response.json({ error: `status: ${STATUSES.join(' | ')}` }, { status: 400 });

  const tasks = await listTasks({ status });
  return Response.json(tasks.map(taskToJson), { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;

  const parsed = CreateTaskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'очікую { title, priority?, minutes?, repeat?, target?, until?, status?, notes? }', issues: parsed.error.issues }, { status: 400 });
  }
  const task = await createBacklogTask(parsed.data);
  revalidatePath('/', 'layout');
  return Response.json(taskToJson(task), { status: 201 });
}
