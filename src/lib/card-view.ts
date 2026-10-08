import type { BrowseCard } from '@/components/CardBrowser';
import type { CardView } from '@/lib/cards';
import { relativeDay } from '@/lib/schedule';

/** "new", "due", "tomorrow", "in 3d": коли картка наступного разу прийде в Review. */
export function dueLabel(card: CardView, now: Date): string {
  if (card.isNew) return 'new';
  return card.dueAt && card.dueAt <= now ? 'due' : relativeDay(card.dueAt, now);
}

export function toBrowseCard(card: CardView, now: Date): BrowseCard {
  return {
    id: card.id,
    question: card.question,
    answer: card.answer,
    topicId: card.topicId,
    topicName: card.topicName,
    dueLabel: dueLabel(card, now),
    lapses: card.lapses,
    fromRepo: card.fromRepo,
    editedInApp: card.editedInApp,
  };
}
