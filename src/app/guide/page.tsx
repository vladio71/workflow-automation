import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Markdown } from '@/components/Markdown';

export default async function GuidePage() {
  const guide = await readFile(path.join(process.cwd(), 'docs', 'GUIDE.md'), 'utf8');
  return (
    <div className="page">
      <Markdown>{guide}</Markdown>
    </div>
  );
}
