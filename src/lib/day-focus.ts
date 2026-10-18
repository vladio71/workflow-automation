/**
 * Day focus: what takes most of today's budget. A string, not an id, because the focus can be
 * a study plan from a repo or live-code levels. Pure logic without DB: the client (PlanCard) imports it too.
 *   ''              no focus
 *   'levels'        live-code levels
 *   'plan:<id>'     study plan (Source.id)
 */
export const NO_FOCUS = '';
export const LEVELS_FOCUS = 'levels';

export function planFocus(sourceId: number): string {
  return `plan:${sourceId}`;
}

/** Focus button above the day plan. */
export interface FocusOption {
  key: string;
  name: string;
}
