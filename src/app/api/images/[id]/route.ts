import { db } from '@/lib/db';

/**
 * Serve a card image. Public like the rest of the app's pages (cards render it in <img>).
 * Images never change (a new upload gets a new id), so the browser may cache them forever.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const imageId = Number(id);
  if (!Number.isInteger(imageId) || imageId <= 0) return new Response('not found', { status: 404 });

  const image = await db.cardImage.findUnique({ where: { id: imageId } });
  if (!image) return new Response('not found', { status: 404 });

  const headers: Record<string, string> = {
    'content-type': image.mime,
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  };
  // an SVG opened directly could run scripts; this keeps it a plain picture
  if (image.mime === 'image/svg+xml') headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'";
  return new Response(new Uint8Array(image.bytes), { headers });
}
