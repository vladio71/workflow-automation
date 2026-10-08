import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CardEditor } from '@/components/CardForms';
import { getCard, getCategoryChoices } from '@/lib/cards';
import { categoryHref } from '@/lib/card-links';
import { dueLabel } from '@/lib/card-view';

interface CardPageProps {
  params: Promise<{ id: string }>;
}

/** Сторінка однієї картки: правка питання і відповіді, категорія, видалення. */
export default async function CardPage({ params }: CardPageProps) {
  const { id } = await params;
  const cardId = Number(id);
  if (!Number.isInteger(cardId)) notFound();
  const [card, categories] = await Promise.all([getCard(cardId), getCategoryChoices()]);
  if (!card) notFound();
  const backHref = categoryHref(card.topicId);

  return (
    <div className="page">
      <p className="faint" style={{ fontSize: 13 }}>
        <Link href={backHref} style={{ textDecoration: 'underline' }}>← {card.topicName}</Link>
      </p>
      <h1 className="page-title">Card</h1>
      <p className="page-sub">
        {dueLabel(card, new Date())}{card.lapses > 0 ? ` · forgotten ×${card.lapses}` : ''} · editing does not change the schedule
      </p>
      <CardEditor
        card={{
          id: card.id,
          question: card.question,
          answer: card.answer,
          topicId: card.topicId,
          topicName: card.topicName,
          fromRepo: card.fromRepo,
          editedInApp: card.editedInApp,
        }}
        categories={categories}
        backHref={backHref}
      />
    </div>
  );
}
