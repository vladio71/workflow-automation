import Link from 'next/link';
import { CardBrowser, type BrowseCard } from '@/components/CardBrowser';
import { CardReviewSession, type ReviewCard } from '@/components/CardReviewSession';
import { NEW_PER_DAY, getAllCards, getCardQueue, type CardView } from '@/lib/cards';
import { db } from '@/lib/db';
import { relativeDay } from '@/lib/schedule';

interface CardsPageProps {
  searchParams: Promise<{ tab?: string; topic?: string }>;
}

function dueLabel(card: CardView, now: Date): string {
  if (card.isNew) return 'new';
  const label = relativeDay(card.dueAt, now);
  return card.dueAt && card.dueAt <= now ? 'due' : label;
}

export default async function CardsPage({ searchParams }: CardsPageProps) {
  const { tab, topic } = await searchParams;
  const showAll = tab === 'all';
  const now = new Date();
  const [queue, all, topics] = await Promise.all([
    getCardQueue(now),
    getAllCards(),
    db.topic.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const todayCount = queue.due.length + queue.fresh.length;

  const reviewCards: ReviewCard[] = [...queue.due, ...queue.fresh].map((card) => ({
    id: card.id,
    question: card.question,
    answer: card.answer,
    topicName: card.topicName,
    isNew: card.isNew,
  }));
  const browseCards: BrowseCard[] = all.map((card) => ({
    id: card.id,
    question: card.question,
    answer: card.answer,
    topicId: card.topicId,
    topicName: card.topicName,
    dueLabel: dueLabel(card, now),
    lapses: card.lapses,
    fromRepo: card.fromRepo,
    editedInApp: card.editedInApp,
  }));

  return (
    <div className="page">
      <div className="page-icon">🃏</div>
      <h1 className="page-title">Cards</h1>
      <p className="page-sub">
        Your Q&amp;A instead of Anki. <b>Review</b> shows what is due today on its schedule (plus up to {NEW_PER_DAY} new cards a day).{' '}
        <b>All cards</b> shows everything, any time: browse, search, go through a topic without touching the schedule.
        Add, edit and delete cards there too.
      </p>

      <div className="db-toolbar">
        <Link className={`db-tab ${!showAll ? 'active' : ''}`} href="/cards">Review · {todayCount}</Link>
        <Link className={`db-tab ${showAll ? 'active' : ''}`} href="/cards?tab=all">All cards · {all.length}</Link>
        <span style={{ flex: 1 }} />
        <span className="faint" style={{ fontSize: 13 }}>{queue.reviewedToday} reviewed today</span>
      </div>

      <div style={{ marginTop: 16 }}>
        {showAll ? (
          <CardBrowser cards={browseCards} initialTopicId={topic ? Number(topic) : null} topics={topics} />
        ) : (
          <CardReviewSession cards={reviewCards} />
        )}
      </div>
    </div>
  );
}
