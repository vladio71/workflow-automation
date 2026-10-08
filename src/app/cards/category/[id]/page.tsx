import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CardBrowser } from '@/components/CardBrowser';
import { NO_CATEGORY_NAME, getAllCards, getCardQueue, getCategoryChoices } from '@/lib/cards';
import { categoryParam, categoryReviewHref, parseCategoryParam } from '@/lib/card-links';
import { toBrowseCard } from '@/lib/card-view';
import { db } from '@/lib/db';

interface CategoryPageProps {
  params: Promise<{ id: string }>;
}

/** Одна категорія: усі її картки. Recall веде в Review тільки цієї категорії, клік по картці на її сторінку. */
export default async function CategoryPage({ params }: CategoryPageProps) {
  const { id } = await params;
  const category = parseCategoryParam(id);
  if (!category) notFound();
  const now = new Date();
  const [topic, all, queue, choices] = await Promise.all([
    category.topicId === null ? null : db.topic.findUnique({ where: { id: category.topicId }, select: { id: true, name: true } }),
    getAllCards(),
    getCardQueue(now, category),
    getCategoryChoices(),
  ]);
  if (category.topicId !== null && !topic) notFound();

  const cards = all.filter((card) => card.topicId === category.topicId).map((card) => toBrowseCard(card, now));
  const waiting = queue.due.length + queue.fresh.length;
  const name = topic?.name ?? NO_CATEGORY_NAME;

  return (
    <div className="page">
      <p className="faint" style={{ fontSize: 13 }}>
        <Link href="/cards?tab=categories" style={{ textDecoration: 'underline' }}>← Categories</Link>
      </p>
      <h1 className="page-title" data-testid="category-title">{name}</h1>
      <p className="page-sub">
        {cards.length} cards · {queue.due.length} due · {queue.fresh.length} new today
        {topic && <> · <Link href={`/topics/${topic.id}`} style={{ textDecoration: 'underline' }}>topic page</Link></>}
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        {waiting > 0 ? (
          <Link className="btn primary" data-testid="category-recall" href={categoryReviewHref(category.topicId)}>▶ Recall {waiting}</Link>
        ) : (
          <span className="faint" style={{ fontSize: 14 }}>Nothing due in this category right now.</span>
        )}
        <span className="faint" style={{ fontSize: 13 }}>
          Recall takes the due cards and grades them. “Go through” below takes all of them and leaves the schedule alone.
        </span>
      </div>

      {cards.length === 0 ? (
        <p className="faint">
          No cards here yet. <Link href={`/cards/new?topic=${categoryParam(category.topicId)}`} style={{ textDecoration: 'underline' }}>Add one</Link>.
        </p>
      ) : (
        <CardBrowser cards={cards} categories={choices} locked={category} />
      )}
    </div>
  );
}
