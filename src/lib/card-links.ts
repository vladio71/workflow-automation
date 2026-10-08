/** Посилання на категорію карток. 'none' = картки без категорії. Окремий файл: потрібен і серверу, і клієнту. */
export const NO_CATEGORY_PARAM = 'none';

export function categoryParam(topicId: number | null): string {
  return topicId === null ? NO_CATEGORY_PARAM : String(topicId);
}

/** Сторінка категорії: усі її картки. */
export function categoryHref(topicId: number | null): string {
  return `/cards/category/${categoryParam(topicId)}`;
}

/** Review тільки цієї категорії: картки, в яких настав термін, плюс нові в межах ліміту на день. */
export function categoryReviewHref(topicId: number | null): string {
  return `/cards?topic=${categoryParam(topicId)}`;
}

export interface ParsedCategory {
  topicId: number | null;
}

/** 'none' -> без категорії, '12' -> тема 12, усе інше -> null (такої категорії нема). */
export function parseCategoryParam(value: string | undefined): ParsedCategory | null {
  if (value === undefined || value === '') return null;
  if (value === NO_CATEGORY_PARAM) return { topicId: null };
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? { topicId: id } : null;
}
