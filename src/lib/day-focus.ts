/**
 * Фокус дня: що сьогодні бере більшу частину бюджету. Рядок, а не id, бо у фокусі буває
 * навчальний план з репо або рівні live-code. Чиста логіка без БД: її імпортує і клієнт (PlanCard).
 *   ''              без фокусу
 *   'levels'        рівні live-code
 *   'plan:<id>'     навчальний план (Source.id)
 */
export const NO_FOCUS = '';
export const LEVELS_FOCUS = 'levels';

export function planFocus(sourceId: number): string {
  return `plan:${sourceId}`;
}

/** Кнопка фокусу над планом дня. */
export interface FocusOption {
  key: string;
  name: string;
}
