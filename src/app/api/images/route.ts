import { z } from 'zod';
import { rejectUnlessAutomation } from '@/lib/automation';
import { db } from '@/lib/db';

/**
 * Upload an image for cards from a script or a chat. Requires the token (x-automation-token).
 *
 * Body: { data, mime, alt? }
 *   data  the file as base64 (no "data:" prefix)
 *   mime  image/png | image/jpeg | image/webp | image/gif | image/svg+xml
 *   alt   short description, optional
 * Response: { id, url, markdown }  -> put `markdown` into a card answer (A:)
 */

const MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'] as const;
/** Vercel caps a request body at ~4.5 MB; base64 adds a third, so 3 MB of image is the safe limit. */
const MAX_BYTES = 3 * 1024 * 1024;

const BodySchema = z.object({
  data: z.string().min(1),
  mime: z.enum(MIMES),
  alt: z.string().trim().max(200).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectUnlessAutomation(request);
  if (rejected) return rejected;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'expected { data: base64, mime, alt? }', issues: parsed.error.issues }, { status: 400 });
  }
  const { data, mime, alt } = parsed.data;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0) return Response.json({ error: 'data is not valid base64' }, { status: 400 });
  if (bytes.length > MAX_BYTES) return Response.json({ error: `image is over ${MAX_BYTES} bytes` }, { status: 413 });

  const image = await db.cardImage.create({ data: { mime, bytes, alt: alt ?? '' } });
  const url = `/api/images/${image.id}`;
  return Response.json({ id: image.id, url, markdown: `![${alt ?? ''}](${url})` });
}
