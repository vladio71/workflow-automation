/**
 * Розділи матеріалу: цикл бере один розділ, норма дня бере наступне тільки з нього.
 * "" = вільний цикл: свої теми, норма дня бере наступну клітинку і дрил по загальному порядку.
 */
export interface Section {
  id: string;
  name: string;
  /** що вмію після цього циклу */
  goal: string;
  /** групи карти, з яких береться наступна клітинка */
  cellGroups: string[];
  /** модулі «Мінімуму», з яких береться наступний дрил */
  moduleIds: string[];
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'map-1-3',
    name: 'Карта: групи 1–3',
    goal: 'Виводжу систему малого, середнього і великого масштабу сам і пояснюю кожен блок за 1,5 хв',
    cellGroups: ['1', '2', '3'],
    moduleIds: [],
  },
  {
    id: 'minimum',
    name: 'Сеньйорський мінімум',
    goal: 'Моніторинг, інциденти, тести, компроміси: відповідаю на дрил без еталону і розповідаю свій досвід як історію',
    cellGroups: [],
    moduleIds: ['mon', 'inc', 'test', 'trade'],
  },
  {
    id: 'map-4',
    name: 'Карта: група 4',
    goal: 'Розумію, навіщо кожен блок на дуже великому масштабі, і можу назвати його ціну',
    cellGroups: ['4'],
    moduleIds: [],
  },
  {
    id: 'map-5',
    name: 'Карта: група 5',
    goal: 'Шардинг, регіони, гарячі ключі: пояснюю на прикладах Notion, Discord, Alex Xu',
    cellGroups: ['5'],
    moduleIds: [],
  },
];

export const FREE_SECTION_ID = '';

export function getSection(id: string): Section | null {
  return SECTIONS.find((section) => section.id === id) ?? null;
}
