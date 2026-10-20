import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { rejectUnlessAutomation } from '@/lib/automation';
import { deleteGlossaryTerm, getGlossary, upsertGlossary } from '@/lib/glossary';

/**
 * Glossary of a category from a script or a chat. Requires the token (x-automation-token).
 *
 *   GET    /api/glossary?topicId=141          terms of the category plus the global ones (no topicId: global only)
 *   PUT    /api/glossary { topicId?, terms: [{ term, aliases?, definition }] }   add or update (by term, case-insensitive)
 *   DELETE /api/glossary { topicId?, term }
 * topicId missing or null = a global term, highlighted in every category.
 */

const TopicId = z.number().int().positive().nullable().optional();

const PutSchema = z.object({
  topicId: TopicId,
  terms: z.array(z.object({
    term: z.string().trim().min(1).max(120),
    aliases: z.array(z.string().max(120)).max(20).optional(),
    definition: z.string().trim().min(1).max(20_000),
  })).min(1).max(500),
});

const DeleteSchema = z.object({ topicId: TopicId, term: z.string().trim().min(1) });

export async function GET(request: Request): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;
  const raw = new URL(request.url).searchParams.get('topicId');
  const topicId = raw ? Number(raw) : null;
  if (topicId !== null && (!Number.isInteger(topicId) || topicId <= 0)) return Response.json({ error: 'bad topicId' }, { status: 400 });
  return Response.json(await getGlossary(topicId));
}

export async function PUT(request: Request): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;
  const parsed = PutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'expected { topicId?, terms: [{ term, aliases?, definition }] }', issues: parsed.error.issues }, { status: 400 });
  }
  const result = await upsertGlossary(parsed.data.topicId ?? null, parsed.data.terms);
  revalidatePath('/', 'layout');
  return Response.json(result);
}

export async function DELETE(request: Request): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;
  const parsed = DeleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'expected { topicId?, term }' }, { status: 400 });
  const removed = await deleteGlossaryTerm(parsed.data.topicId ?? null, parsed.data.term);
  revalidatePath('/', 'layout');
  return Response.json({ removed });
}
