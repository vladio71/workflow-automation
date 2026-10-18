'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { GOLDEN_RULE, HINTS_IN_REPO, HINT_LEVELS, RETENTION, ROUTINE_CHECKS, SANITY_CHECKS, type RuleLine } from '@/lib/live-code-rules';
import {
  DEFAULT_REMIND_MINUTES, MAX_REMIND_MINUTES, MINUTE_MS, MIN_REMIND_MINUTES, OPEN_RULES_EVENT, SESSION_EVENT, SNOOZE_MINUTES,
  clampRemindMinutes, readRemindMinutes, readSession, startManualSession, stopSession, writeRemindMinutes, writeSession,
  type LiveCodeSession,
} from '@/lib/live-code-session';

/**
 * Live code rules in a dialog plus a "check where you are" reminder at the 25th minute (configurable).
 * The timer starts here by hand or when a level is opened. When it fires: browser notification,
 * the dialog opens, 👀 in the tab title. No clock is shown anywhere on purpose.
 */
type View = 'rules' | 'reminder' | 'look' | 'solved';
type Permission = NotificationPermission | 'unsupported';

/** Tab title mark while the reminder is unanswered. No clock anywhere: it pressures instead of helping */
const TITLE_MARK = '👀 ';

function currentPermission(): Permission {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function notify(title: string, body: string): void {
  if (currentPermission() !== 'granted') return;
  try {
    const notification = new Notification(title, { body, tag: 'live-code', requireInteraction: true });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // browser does not support page notifications: the dialog and the 👀 tab mark still work
  }
}

function RuleRows({ lines }: { lines: readonly RuleLine[] }) {
  return (
    <div>
      {lines.map((line) => (
        <div key={line.when + line.text} className="rule-row">
          <span className="tag gray">{line.when}</span>
          <span>{line.text}</span>
        </div>
      ))}
    </div>
  );
}

function SelfCheck({ checks, onToggle }: { checks: boolean[]; onToggle: (index: number) => void }) {
  return (
    <div>
      {ROUTINE_CHECKS.map((line, index) => {
        const on = checks[index] === true;
        return (
          <button key={line.text} type="button" className={`check rule-check ${on ? 'on' : ''}`} onClick={() => onToggle(index)}>
            <span className="box">
              {on && <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.2"><path d="M2 6.5l2.5 2.5L10 3.5" /></svg>}
            </span>
            <span className="tag gray">{line.when}</span>
            <span className="label">{line.text}</span>
          </button>
        );
      })}
    </div>
  );
}

export function LiveCodeCoach() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  /** The remindAt for which the dialog was already opened in this tab */
  const shownFor = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('rules');
  const [session, setSession] = useState<LiveCodeSession | null>(null);
  /** The session just closed from the reminder, kept for the link back to the level */
  const [finished, setFinished] = useState<LiveCodeSession | null>(null);
  const [freeChecks, setFreeChecks] = useState<boolean[]>([]);
  const [remindMinutes, setRemindMinutes] = useState(DEFAULT_REMIND_MINUTES);
  const [now, setNow] = useState(0);
  const [permission, setPermission] = useState<Permission>('unsupported');

  // the session lives in localStorage: read on mount, after changes in this tab (SESSION_EVENT) and in other tabs (storage)
  useEffect(() => {
    const sync = () => setSession(readSession());
    const showRules = () => {
      setView('rules');
      setOpen(true);
    };
    sync();
    setRemindMinutes(readRemindMinutes());
    setPermission(currentPermission());
    window.addEventListener(SESSION_EVENT, sync);
    window.addEventListener('storage', sync);
    window.addEventListener(OPEN_RULES_EVENT, showRules);
    return () => {
      window.removeEventListener(SESSION_EVENT, sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener(OPEN_RULES_EVENT, showRules);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  const pending = session !== null && now >= session.remindAt;

  // time is up: open the dialog and send one system notification for the whole browser, not one per tab
  useEffect(() => {
    if (!session || !pending || shownFor.current === session.remindAt) return;
    shownFor.current = session.remindAt;
    setView('reminder');
    setOpen(true);
    const latest = readSession();
    if (latest && latest.remindAt === session.remindAt && !latest.notified) {
      writeSession({ ...latest, notified: true });
      notify('Live code: перевір, де ти', `${session.label}. В якому стані рішення? Може, краще піти дивитись?`);
    }
  }, [session, pending]);

  // 👀 in the tab title while the reminder is unanswered; Next rewrites the title on navigation, so re-apply every second
  useEffect(() => {
    if (pending && !document.title.startsWith(TITLE_MARK)) document.title = TITLE_MARK + document.title;
    if (!pending && document.title.startsWith(TITLE_MARK)) document.title = document.title.slice(TITLE_MARK.length);
  }, [pending, now]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function askPermission() {
    if (currentPermission() !== 'default') return;
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission(currentPermission());
    }
  }

  function start() {
    // ask for permission on click: without a user gesture the browser may silently block it
    void askPermission();
    writeRemindMinutes(remindMinutes);
    startManualSession();
    setFreeChecks([]);
    setOpen(false);
  }

  function snooze() {
    if (!session) return;
    writeSession({ ...session, remindAt: Date.now() + SNOOZE_MINUTES * MINUTE_MS, notified: false });
    setOpen(false);
  }

  function finish(next: 'look' | 'solved') {
    setFinished(session);
    stopSession();
    setView(next);
  }

  const checks = session ? session.checks : freeChecks;
  function toggleCheck(index: number) {
    const next = ROUTINE_CHECKS.map((_, position) => (position === index ? checks[position] !== true : checks[position] === true));
    if (session) writeSession({ ...session, checks: next });
    else setFreeChecks(next);
  }

  function openFromMenu() {
    setView(pending ? 'reminder' : 'rules');
    setOpen(true);
  }

  const backHref = finished?.href || null;

  return (
    <>
      <button type="button" className="nav-link nav-button" onClick={openFromMenu} data-testid="live-code-menu">
        <span style={{ width: 20, textAlign: 'center' }}>📏</span>
        <span>Live code rules</span>
        {session && pending && <span className="count alert" title={session.label}>перевір</span>}
        {session && !pending && <span className="count" title={`${session.label}: нагадування увімкнене`}>●</span>}
      </button>

      <dialog
        ref={dialogRef}
        className="modal"
        aria-labelledby="live-code-title"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <div className="modal-head">
          <h2 id="live-code-title">
            {view === 'rules' && '📏 Live code: правила'}
            {view === 'reminder' && '👀 Перевір, де ти'}
            {view === 'look' && '🔎 Іду дивитись'}
            {view === 'solved' && "🏁 Розв'язав"}
          </h2>
          <button type="button" className="btn ghost sm" aria-label="Закрити" onClick={() => setOpen(false)}>✕</button>
        </div>

        <div className="modal-body">
          {view === 'rules' && (
            <>
              <div className="golden">{GOLDEN_RULE}</div>
              <div className="rule-title">1. Сесія: звір себе</div>
              <SelfCheck checks={checks} onToggle={toggleCheck} />
              <div className="rule-title">2. Застряг: підказки по черзі</div>
              <RuleRows lines={HINT_LEVELS} />
              <p className="faint" style={{ fontSize: 13, marginTop: 4 }}>{HINTS_IN_REPO}</p>
              <div className="rule-title">3. Після рішення</div>
              <RuleRows lines={RETENTION} />
              <div className="rule-title">4. Sanity checks</div>
              <table className="db">
                <thead>
                  <tr><th>Тригер у задачі</th><th>Перший патерн</th><th>Стан</th></tr>
                </thead>
                <tbody>
                  {SANITY_CHECKS.map((row) => (
                    <tr key={row.trigger}>
                      <td>{row.trigger}</td>
                      <td style={{ fontWeight: 500 }}>{row.pattern}</td>
                      <td className="muted">{row.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {view === 'reminder' && session && (
            <>
              <p style={{ marginBottom: 4 }}>
                <b>{session.label}.</b> В якому стані рішення? Якщо є план і воно рухається, працюй далі. Якщо ні,
                гріндити далі нема сенсу: краще піти дивитись, по черзі L1 → L2 → L3.
              </p>
              <div className="rule-title">Звір себе</div>
              <SelfCheck checks={checks} onToggle={toggleCheck} />
            </>
          )}

          {view === 'look' && (
            <>
              <div className="rule-title">Підказки по черзі</div>
              <RuleRows lines={HINT_LEVELS} />
              <p className="faint" style={{ fontSize: 13, marginTop: 4 }}>{HINTS_IN_REPO}</p>
              <div className="rule-title">Після рішення</div>
              <RuleRows lines={RETENTION} />
            </>
          )}

          {view === 'solved' && (
            <>
              <div className="rule-title">Після рішення</div>
              <RuleRows lines={RETENTION} />
            </>
          )}
        </div>

        <div className="modal-foot">
          {view === 'rules' && session && (
            <>
              <span className="faint" style={{ fontSize: 13 }}>{session.label} · нагадаю перевірити, де ти</span>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn sm" onClick={() => stopSession()}>■ Стоп</button>
            </>
          )}
          {view === 'rules' && !session && (
            <>
              <span className="faint" style={{ fontSize: 13 }}>Нагадати через</span>
              <input
                className="input"
                type="number"
                aria-label="Хвилин до нагадування"
                min={MIN_REMIND_MINUTES}
                max={MAX_REMIND_MINUTES}
                step={5}
                style={{ width: 64, height: 28 }}
                value={remindMinutes}
                onChange={(event) => setRemindMinutes(clampRemindMinutes(Number(event.target.value)))}
              />
              <span className="faint" style={{ fontSize: 13 }}>хв</span>
              <button type="button" className="btn primary sm" onClick={start}>▶ Старт</button>
              <span style={{ flex: 1 }} />
              <span className="faint" style={{ fontSize: 12 }}>Рівні запускають таймер самі.</span>
            </>
          )}
          {view === 'reminder' && (
            <>
              <button type="button" className="btn primary sm" onClick={snooze}>Є рух, працюю далі</button>
              <button type="button" className="btn sm" onClick={() => finish('look')}>Іду дивитись</button>
              <button type="button" className="btn sm" onClick={() => finish('solved')}>Розв&apos;язав</button>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn ghost sm" onClick={() => { stopSession(); setOpen(false); }}>Стоп таймер</button>
            </>
          )}
          {(view === 'look' || view === 'solved') && (
            <>
              {backHref && <Link href={backHref} className="btn sm" onClick={() => setOpen(false)}>← До рівня</Link>}
              <span style={{ flex: 1 }} />
              <button type="button" className="btn primary sm" onClick={() => setOpen(false)}>Ок</button>
            </>
          )}
          {view === 'rules' && permission === 'default' && (
            <button type="button" className="btn ghost sm" onClick={() => void askPermission()}>🔔 Дозволити сповіщення</button>
          )}
          {view === 'rules' && (permission === 'denied' || permission === 'unsupported') && (
            <span className="faint" style={{ fontSize: 12, flexBasis: '100%' }}>
              Сповіщення браузера вимкнені: нагадування буде тільки тут і 👀 у назві вкладки.
            </span>
          )}
        </div>
      </dialog>
    </>
  );
}
