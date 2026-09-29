/**
 * Налаштування скрині. Це твій файл: картки, шанси і ліміти міняються тут, решту коду чіпати не треба.
 *
 * Звідки картки:
 *   - статичні (цей файл): завжди в пулі, не закінчуються;
 *   - пул у БД (RestCard): новини, статті, фільм, аніме, музика з Gemini + Google Search, меми з xkcd,
 *     запасні новини й статті з Hacker News. Докидаються самі, коли відкриваєш Today; після пулу картка зникає.
 */
export type LootRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

/** MICRO = коротка перерва для тіла, решта = що випало з пулу або з цього файлу */
export type RestKind = 'MICRO' | 'MEME' | 'NEWS' | 'ARTICLE' | 'MUSIC' | 'ANIME' | 'FILM' | 'GAME';

/** Види, які наповнюються з мережі (Gemini, xkcd, Hacker News) */
export type PoolKind = 'MEME' | 'NEWS' | 'ARTICLE' | 'MUSIC' | 'ANIME' | 'FILM';

export interface StaticRestCard {
  /** стабільний id: по ньому видно в історії, що випало */
  id: string;
  kind: RestKind;
  rarity: LootRarity;
  title: string;
  body: string;
  minutes: number;
  url?: string;
  /** довге: падає тільки після боса дня */
  afterBoss?: boolean;
  /** запасна: падає, тільки коли в пулі немає справжньої картки цього виду (наприклад, AI не підібрав музику) */
  fallback?: boolean;
}

export interface LootRules {
  maxPullsPerDay: number;
  /** між двома скринями треба попрацювати хоча б стільки хвилин */
  minMinutesBetweenPulls: number;
  /** кожен N-й пул поспіль без epic гарантовано дає epic або legendary */
  pityEvery: number;
  /** після common наступна скриня дає uncommon або краще: двох "поганих" поспіль не буває */
  noCommonTwiceInRow: boolean;
  /**
   * Після кожної legendary за день її шанс множиться на це число: 10% → 2.5% → 0.6%.
   * Друга legendary можлива, але рідко: інакше день пропав.
   */
  legendaryRepeatFactor: number;
  /** шанси у відсотках, сума = 100 */
  weights: Record<LootRarity, number>;
}

export const LOOT_RULES: LootRules = {
  maxPullsPerDay: 6,
  minMinutesBetweenPulls: 25,
  pityEvery: 6,
  noCommonTwiceInRow: true,
  legendaryRepeatFactor: 0.25,
  // це твій день, а не гра: поганий дроп рідкісний
  weights: { COMMON: 20, UNCOMMON: 25, RARE: 25, EPIC: 20, LEGENDARY: 10 },
};

/** Рідкість карток з пулу за видом */
export const POOL_RARITY: Record<PoolKind, LootRarity> = {
  MEME: 'UNCOMMON',
  NEWS: 'RARE',
  ARTICLE: 'EPIC',
  MUSIC: 'LEGENDARY',
  ANIME: 'LEGENDARY',
  FILM: 'LEGENDARY',
};

/** Скільки живих карток кожного виду тримати в пулі */
export const POOL_TARGETS: Record<PoolKind, number> = { MEME: 4, NEWS: 3, ARTICLE: 3, MUSIC: 2, ANIME: 2, FILM: 2 };

/** Скільки днів картка живе в пулі: новини швидко старіють, решта ні */
export const POOL_TTL_DAYS: Record<PoolKind, number> = { MEME: 14, NEWS: 2, ARTICLE: 7, MUSIC: 7, ANIME: 7, FILM: 14 };

/** Хвилини відпочинку за видом (для карток з пулу) */
export const POOL_MINUTES: Record<PoolKind, number> = { MEME: 3, NEWS: 5, ARTICLE: 7, MUSIC: 20, ANIME: 25, FILM: 120 };

/** Фільм на дві години: тільки після боса дня */
export const POOL_AFTER_BOSS: Record<PoolKind, boolean> = { MEME: false, NEWS: false, ARTICLE: false, MUSIC: false, ANIME: false, FILM: true };

/** Що шукати для новин і статей. Твоя відповідь була: "просто щось цікаве". */
export const INTERESTS =
  'просто щось цікаве і легке для перерви: наука, технології, космос, історія, дизайн, ігри, дивні факти. ' +
  'Без політики, війни і трагедій: це відпочинок.';

export const STATIC_CARDS: StaticRestCard[] = [
  { id: 'water', kind: 'MICRO', rarity: 'COMMON', title: 'Склянка води', body: 'Встань, налий води і випий біля вікна. Телефон лишається на столі.', minutes: 3 },
  { id: 'stretch', kind: 'MICRO', rarity: 'COMMON', title: 'Розминка', body: 'Шия, плечі, спина: по 5 повільних повторів. Потім 30 секунд просто постій рівно.', minutes: 3 },
  { id: 'eyes', kind: 'MICRO', rarity: 'COMMON', title: 'Очі: 20-20-20', body: 'Дивись на щось далі ніж 6 метрів 20 секунд. Тричі, з морганням між підходами.', minutes: 2 },
  { id: 'walk', kind: 'MICRO', rarity: 'COMMON', title: 'Пройдись', body: 'Кілька кіл по квартирі або сходами вниз і вгору. Без навушників.', minutes: 5 },
  { id: 'breath', kind: 'MICRO', rarity: 'COMMON', title: 'Дихання 4-7-8', body: '4 цикли: вдих на 4 рахунки, затримка на 7, видих на 8.', minutes: 2 },
  { id: 'tea', kind: 'MICRO', rarity: 'COMMON', title: 'Чай без телефону', body: 'Зроби чай чи каву і випий, нічого не гортаючи.', minutes: 5 },
  { id: 'game', kind: 'GAME', rarity: 'LEGENDARY', title: 'Гра: 30 хвилин', body: 'Тридцять хвилин у свою гру. Коли таймер скінчився, гра теж.', minutes: 30, afterBoss: true },
  { id: 'music-own', kind: 'MUSIC', rarity: 'LEGENDARY', title: '20 хвилин музики', body: 'Улюблений альбом, очі закриті або у вікно. Нічого не роби паралельно.', minutes: 20, fallback: true },
];
