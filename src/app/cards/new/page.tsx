import Link from 'next/link';
import { NewCardForm } from '@/components/CardForms';
import { getCategoryChoices } from '@/lib/cards';
import { categoryHref, parseCategoryParam } from '@/lib/card-links';

interface NewCardPageProps {
  searchParams: Promise<{ topic?: string }>;
}

/** Standalone add-card page. ?topic=<id> is the category the user came from. */
export default async function NewCardPage({ searchParams }: NewCardPageProps) {
  const { topic } = await searchParams;
  const from = parseCategoryParam(topic);
  const categories = await getCategoryChoices();
  const known = from !== null && from.topicId !== null && categories.some((category) => category.id === from.topicId);
  const backHref = from && (from.topicId === null || known) ? categoryHref(from.topicId) : '/cards?tab=categories';

  return (
    <div className="page">
      <p className="faint" style={{ fontSize: 13 }}>
        <Link href={backHref} style={{ textDecoration: 'underline' }}>← Back</Link>
      </p>
      <h1 className="page-title">New card</h1>
      <p className="page-sub">New cards come up in Review. Pick a category or add a new one right in the list.</p>
      <NewCardForm categories={categories} defaultTopicId={known && from ? from.topicId : null} backHref={backHref} />
    </div>
  );
}
