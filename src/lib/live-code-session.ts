/**
 * Таймер live code для нагадування "перевір, де ти". Живе в браузері (localStorage), одна сесія на всі вкладки.
 * Ручну сесію стартуєш з попапа правил; сесія рівня стартує сама, коли відкриваєш рівень, з його часу старту.
 * Тільки для клієнта: без window ці функції нічого не роблять.
 */

export interface LiveCodeSession {
  /** сторінка, де йде робота (рівень), або '' для ручного старту */
  href: string;
  label: string;
  startedAt: number;
  remindAt: number;
  /** системне сповіщення для цього remindAt уже показане: не дублюємо після перезавантаження чи в іншій вкладці */
  notified: boolean;
  /** галочки чекліста "звір себе" */
  checks: boolean[];
}

export const DEFAULT_REMIND_MINUTES = 25;
export const MIN_REMIND_MINUTES = 5;
export const MAX_REMIND_MINUTES = 90;
export const SNOOZE_MINUTES = 10;
export const MINUTE_MS = 60_000;
/** забута сесія: через 3 год таймер уже нічого не означає */
const STALE_AFTER_MS = 3 * 60 * MINUTE_MS;

const SESSION_KEY = 'live-code-session';
const MINUTES_KEY = 'live-code-remind-minutes';
/** зміна сесії в цій вкладці (подія storage приходить тільки в інші вкладки) */
export const SESSION_EVENT = 'live-code-session';
/** відкрити попап правил (кнопка на сторінці рівня) */
export const OPEN_RULES_EVENT = 'live-code-rules';

function isSession(value: unknown): value is LiveCodeSession {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Record<string, unknown>;
  return typeof session.href === 'string'
    && typeof session.label === 'string'
    && typeof session.startedAt === 'number'
    && typeof session.remindAt === 'number'
    && typeof session.notified === 'boolean'
    && Array.isArray(session.checks);
}

export function readSession(now: number = Date.now()): LiveCodeSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSession(parsed) || now - parsed.startedAt > STALE_AFTER_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(session: LiveCodeSession | null): void {
  try {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // приватне вікно або заблоковане сховище: таймер просто не переживе перезавантаження
  }
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: session }));
}

export function clampRemindMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_REMIND_MINUTES;
  return Math.min(MAX_REMIND_MINUTES, Math.max(MIN_REMIND_MINUTES, Math.round(minutes)));
}

export function readRemindMinutes(): number {
  try {
    const raw = window.localStorage.getItem(MINUTES_KEY);
    return raw === null ? DEFAULT_REMIND_MINUTES : clampRemindMinutes(Number(raw));
  } catch {
    return DEFAULT_REMIND_MINUTES;
  }
}

export function writeRemindMinutes(minutes: number): void {
  try {
    window.localStorage.setItem(MINUTES_KEY, String(clampRemindMinutes(minutes)));
  } catch {
    // не збереглось: наступного разу знову 25
  }
}

export function startManualSession(now: number = Date.now()): LiveCodeSession {
  const session: LiveCodeSession = {
    href: '',
    label: 'Live code',
    startedAt: now,
    remindAt: now + readRemindMinutes() * MINUTE_MS,
    notified: false,
    checks: [],
  };
  writeSession(session);
  return session;
}

/**
 * Відкрив рівень, який ще не пройдено: таймер іде від старту рівня (той самий, що на сторінці рівня).
 * Та сама сесія вже йде, лишаємо як є. Якщо рівень відкрили знову, коли час нагадування вже минув,
 * нагадаємо через 10 хв, а не одразу з порога.
 */
export function adoptLevelSession(level: { href: string; label: string; startedAt: number }, now: number = Date.now()): void {
  if (now - level.startedAt > STALE_AFTER_MS) return;
  const current = readSession(now);
  if (current && current.href === level.href && current.startedAt === level.startedAt) return;
  const remindAt = level.startedAt + readRemindMinutes() * MINUTE_MS;
  writeSession({
    href: level.href,
    label: level.label,
    startedAt: level.startedAt,
    remindAt: remindAt > now ? remindAt : now + SNOOZE_MINUTES * MINUTE_MS,
    notified: false,
    checks: [],
  });
}

/** Зупинити таймер. З href: тільки якщо зараз іде саме ця сесія (рівень пройдено або відкрив еталон). */
export function stopSession(href?: string): void {
  if (href !== undefined) {
    const current = readSession();
    if (!current || current.href !== href) return;
  }
  writeSession(null);
}

export function openRules(): void {
  window.dispatchEvent(new CustomEvent(OPEN_RULES_EVENT));
}
