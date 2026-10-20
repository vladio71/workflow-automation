import Link from 'next/link';
import { CardBrowser } from '@/components/CardBrowser';
import { CardReviewSession, type ReviewCard } from '@/components/CardReviewSession';
import { CategoryTable } from '@/components/CategoryTable';
import { GlossaryProvider } from '@/components/Glossary';
import { getAllGlossary } from '@/lib/glossary';
import { NEW_PER_DAY, NO_CATEGORY_NAME, getAllCards, getCardCategories, getCardQueue, getCategoryChoices } from '@/lib/cards';
import { categoryHref, categoryParam, parseCategoryParam } from '@/lib/card-links';
import { toBrowseCard } from '@/lib/card-view';

interface CardsPageProps {
  searchParams: Promise<{ tab?: string; topic?: string }>;
}

type CardsTab = 'review' | 'categories' | 'all';

export default async function CardsPage({ searchParams }: CardsPageProps) {
  const { tab: tabParam, topic } = await searchParams;
  const tab: CardsTab = tabParam === 'all' || tabParam === 'categories' ? tabParam : 'review';
  const only = parseCategoryParam(topic);
  const now = new Date();
  const [fullQueue, all, categories, choices, glossary] = await Promise.all([
    getCardQueue(now),
    getAllCards(),
    getCardCategories(now),
    getCategoryChoices(),
    getAllGlossary(),
  ]);
  // Review of one category: the same queue, restricted to its cards
  const queue = only ? await getCardQueue(now, only) : fullQueue;
  const todayCount = fullQueue.due.length + fullQueue.fresh.length;
  const onlyName = only
    ? categories.find((category) => category.id === only.topicId)?.name ?? NO_CATEGORY_NAME
    : null;

  const reviewCards: ReviewCard[] = queue.review.map((card) => ({
    id: card.id,
    question: card.question,
    answer: card.answer,
    topicId: card.topicId,
    topicName: card.topicName,
    isNew: card.isNew,
  }));

  return (
    <div className="page">
      <div className="page-icon">🃏</div>
      <h1 className="page-title">Cards</h1>
      <p className="page-sub">
        <b>Review</b>: what is due today (plus up to {NEW_PER_DAY} new cards a day). You grade a card and the grade sets when it comes back.{' '}
        <b>Categories</b>: the cards by category, recall one category at a time. <b>All cards</b>: everything, any time.
      </p>

      <div className="db-toolbar">
        <Link className={`db-tab ${tab === 'review' ? 'active' : ''}`} href="/cards">Review · {todayCount}</Link>
        <Link className={`db-tab ${tab === 'categories' ? 'active' : ''}`} href="/cards?tab=categories">Categories · {categories.length}</Link>
        <Link className={`db-tab ${tab === 'all' ? 'active' : ''}`} href="/cards?tab=all">All cards · {all.length}</Link>
        <span style={{ flex: 1 }} />
        {tab !== 'all' && <Link className="btn sm" href="/cards/new">+ New card</Link>}
        {tab !== 'all' && <Link className="btn sm" href="/import" data-testid="import-link">⇪ Import</Link>}
        <span className="faint" style={{ fontSize: 13, marginLeft: 8 }}>{fullQueue.reviewedToday} reviewed today</span>
      </div>

      <GlossaryProvider terms={glossary}>
      <div style={{ marginTop: 16 }}>
        {tab === 'review' && (
          <>
            {only && onlyName !== null && (
              <p className="muted" style={{ fontSize: 14, marginBottom: 10 }} data-testid="review-only">
                Only <Link href={categoryHref(only.topicId)} style={{ fontWeight: 500, textDecoration: 'underline' }}>{onlyName}</Link>
                {' · '}{reviewCards.length} waiting{' · '}
                <Link href="/cards" style={{ textDecoration: 'underline' }}>all categories</Link>
              </p>
            )}
            {/* key: a different category starts a fresh session */}
            <CardReviewSession key={only ? categoryParam(only.topicId) : 'all'} cards={reviewCards} />
          </>
        )}
        {tab === 'categories' && (
          categories.length === 0
            ? <p className="faint">No cards yet. <Link href="/cards/new" style={{ textDecoration: 'underline' }}>Add the first one</Link>.</p>
            : <CategoryTable categories={categories} newLeft={fullQueue.newLeft} now={now} />
        )}
        {tab === 'all' && <CardBrowser cards={all.map((card) => toBrowseCard(card, now))} categories={choices} />}
      </div>
      </GlossaryProvider>
    </div>
  );
}
