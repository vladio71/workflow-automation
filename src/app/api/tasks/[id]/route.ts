import { revalidatePath } from 'next/cache';
import { rejectUnlessAutomation } from '@/lib/automation';
import { db } from '@/lib/db';
import { UpdateTaskSchema, taskToJson, updateBacklogTask } from '@/lib/task-backlog';

/**
 *   GET    /api/tasks/:id
 *   PATCH  /api/tasks/:id  { status?: BACKLOG|TODO|IN_PROGRESS|DONE, priority?, title?, minutes?, notes?, ... }
 *   DELETE /api/tasks/:id
 */

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;
  const id = parseId((await params).id);
  if (id === null) return Response.json({ error: 'bad id' }, { status: 400 });
  const task = await db.task.findUnique({ where: { id } });
  if (!task) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(taskToJson(task), { headers: { 'cache-control': 'no-store' } });
}

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;
  const id = parseId((await params).id);
  if (id === null) return Response.json({ error: 'bad id' }, { status: 400 });

  const parsed = UpdateTaskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'очікую { status?, priority?, title?, minutes?, notes?, ... }', issues: parsed.error.issues }, { status: 400 });

  const task = await updateBacklogTask(id, parsed.data);
  if (!task) return Response.json({ error: 'not found' }, { status: 404 });
  revalidatePath('/', 'layout');
  return Response.json(taskToJson(task));
}

export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;
  const id = parseId((await params).id);
  if (id === null) return Response.json({ error: 'bad id' }, { status: 400 });
  const deleted = await db.task.deleteMany({ where: { id } });
  if (deleted.count === 0) return Response.json({ error: 'not found' }, { status: 404 });
  revalidatePath('/', 'layout');
  return new Response(null, { status: 204 });
}
