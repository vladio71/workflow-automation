import Link from 'next/link';
import { ImportForm } from '@/components/ImportForm';
import { getCategoryChoices } from '@/lib/cards';

/** Quick card import: text or a .md file in the Q:/A: format, a category, an optional deadline. */
export default async function ImportPage() {
  const categories = await getCategoryChoices();
  return (
    <div className="page">
      <p className="faint" style={{ fontSize: 13 }}>
        <Link href="/cards?tab=categories" style={{ textDecoration: 'underline' }}>← Cards</Link>
      </p>
      <h1 className="page-title">Import cards</h1>
      <p className="page-sub">
        Paste text or drop a .md file in the <code>Q:</code>/<code>A:</code> format (same as <code>learn/questions.md</code>).
        A question that already exists in the category gets the new answer instead of a duplicate.
      </p>
      <ImportForm categories={categories} />
    </div>
  );
}
