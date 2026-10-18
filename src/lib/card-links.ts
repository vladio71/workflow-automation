/** Links to a card category. 'none' = cards without a category. Separate file: needed by both server and client. */
export const NO_CATEGORY_PARAM = 'none';

export function categoryParam(topicId: number | null): string {
  return topicId === null ? NO_CATEGORY_PARAM : String(topicId);
}

/** Category page: all of its cards. */
export function categoryHref(topicId: number | null): string {
  return `/cards/category/${categoryParam(topicId)}`;
}

/** Review of this category only: due cards plus new ones within the daily limit. */
export function categoryReviewHref(topicId: number | null): string {
  return `/cards?topic=${categoryParam(topicId)}`;
}

export interface ParsedCategory {
  topicId: number | null;
}

/** 'none' -> no category, '12' -> topic 12, anything else -> null (no such category). */
export function parseCategoryParam(value: string | undefined): ParsedCategory | null {
  if (value === undefined || value === '') return null;
  if (value === NO_CATEGORY_PARAM) return { topicId: null };
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? { topicId: id } : null;
}
