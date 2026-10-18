/**
 * Live code rules (Action Reference: Algorithmic Problem Solving), in Ukrainian.
 * Text and data only: shown by the rules popup and the reminder (LiveCodeCoach).
 */

export interface RuleLine {
  /** when or which level: "0-5 min", "L1", "Right away" */
  when: string;
  text: string;
}

export interface SanityCheck {
  trigger: string;
  pattern: string;
  state: string;
}

export const GOLDEN_RULE = '20 хв без плану = стоп. Далі не гріндиш, а йдеш по підказках L1 → L2 → L3.';

/** 1. Session, the 15-20 min rule. These lines double as the "check yourself" checklist. */
export const ROUTINE_CHECKS: readonly RuleLine[] = [
  { when: '0–5 хв', text: 'Назвав структуру (Tree, Graph, Array, DP) і ціль (shortest path, min/max, target search).' },
  { when: '5–15 хв', text: 'Прогнав руками 2 маленькі приклади.' },
  { when: '5–15 хв', text: 'Є brute force, і я бачу, де в ньому вузьке місце.' },
  { when: '20 хв', text: 'Є план, пишу код. Плану нема: стоп, не гріндь далі.' },
];

/** 2. Unstuck loop: hints in order, the next one only if the previous did not help. */
export const HINT_LEVELS: readonly RuleLine[] = [
  { when: 'L1', text: 'Тільки тег категорії: BFS, Two Pointers, Monotonic Stack.' },
  { when: 'L2', text: 'Підхід або псевдокод, без коду.' },
  {
    when: 'L3',
    text: 'Повне рішення. Потім розбери, чому оптимальне краще за brute force: наприклад, O(1) вказівники стану проти O(N) копіювання масиву.',
  },
];

/** Where these hint levels live in the live-code exercises. */
export const HINTS_IN_REPO = 'У live-code: L1 = патерн з README (у рівнях він у шапці), L2 = «Підказка» (є не в усіх вправах), L3 = еталон (у рівнях Give up).';

/** 3. Retention. */
export const RETENTION: readonly RuleLine[] = [
  { when: 'Одразу', text: 'Закрий рішення. Нічого з нього не передруковуй.' },
  { when: 'Через 48 год', text: 'Та сама задача з нуля в чистому файлі. Рівні повертаються самі через 2 дні.' },
  { when: 'Pattern Vault', text: 'Шаблон (BFS + parent map, sliding window) у свою шпаргалку.' },
];

/** 4. Sanity check: what the statement says -> first pattern -> how to hold state. */
export const SANITY_CHECKS: readonly SanityCheck[] = [
  { trigger: 'Unweighted shortest path', pattern: 'BFS', state: 'Батьків тримай у Map, масиви шляху не копіюй.' },
  { trigger: 'Weighted shortest path', pattern: 'Dijkstra', state: 'Min-priority queue і Map відстаней.' },
  { trigger: 'Branching / decision tree', pattern: 'DFS / backtracking', state: "Стан мутуй і відкочуй на місці, об'єкти не клонуй." },
  { trigger: 'Contiguous subarrays', pattern: 'Sliding window / two pointers', state: 'Правий вказівник розширює, лівий стискає за умовою.' },
];
