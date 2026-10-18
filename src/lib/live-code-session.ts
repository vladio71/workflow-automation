/**
 * Live code timer for the "check where you are" reminder. Lives in the browser (localStorage), one session for all tabs.
 * A manual session is started from the rules popup; a level session starts itself when a level is opened, from its start time.
 * Client only: without window these functions do nothing.
 */

export interface LiveCodeSession {
  /** page where the work happens (a level), or '' for a manual start */
  href: string;
  label: string;
  startedAt: number;
  remindAt: number;
  /** the system notification for this remindAt was already shown: not repeated after a reload or in another tab */
  notified: boolean;
  /** ticks of the "check yourself" checklist */
  checks: boolean[];
}

export const DEFAULT_REMIND_MINUTES = 25;
export const MIN_REMIND_MINUTES = 5;
export const MAX_REMIND_MINUTES = 90;
export const SNOOZE_MINUTES = 10;
export const MINUTE_MS = 60_000;
/** forgotten session: after 3 h the timer means nothing any more */
const STALE_AFTER_MS = 3 * 60 * MINUTE_MS;

const SESSION_KEY = 'live-code-session';
const MINUTES_KEY = 'live-code-remind-minutes';
/** session change in this tab (the storage event only reaches other tabs) */
export const SESSION_EVENT = 'live-code-session';
/** open the rules popup (button on the level page) */
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
    // private window or blocked storage: the timer just will not survive a reload
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
    // not saved: next time it is 25 again
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
 * An unfinished level was opened: the timer runs from the level start (the same one as on the level page).
 * If that session is already running, it is left as is. If the level is reopened after the reminder time has passed,
 * the reminder fires in 10 min rather than immediately.
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

/** Stop the timer. With href: only if exactly this session is running (level passed or reference opened). */
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
