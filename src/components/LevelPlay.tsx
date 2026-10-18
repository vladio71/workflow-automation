'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { giveUpLevel, runLevelAttempt } from '@/app/actions';
import { adoptLevelSession, openRules, stopSession } from '@/lib/live-code-session';

interface LevelPlayProps {
  levelKey: string;
  /** Level name, used as the reminder label */
  title: string;
  /** index.ts or index.tsx: the file name in the copy of the exercise */
  fileName: string;
  stub: string;
  /** The reference is visible only if the level was passed or given up today */
  initialReference: string | null;
  passedToday: boolean;
  gaveUpToday: boolean;
  lastOutput: { passed: boolean; output: string } | null;
  nextHref: string | null;
}

interface RunView {
  passed: boolean;
  timedOut: boolean;
  output: string;
  durationMs: number;
}

/** Local date, not UTC: after 21:00 Kyiv time UTC is already "tomorrow" */
function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // private window or blocked storage: the draft simply is not saved
  }
}

export function LevelPlay(props: LevelPlayProps) {
  const draftKey = `level-draft:${props.levelKey}`;
  const startKey = `level-start:${props.levelKey}:${localDay()}`;

  const [code, setCode] = useState(props.stub);
  // no clock on the page (it pressured instead of helping): the start time only feeds Stats and the reminder
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [reference, setReference] = useState<string | null>(props.initialReference);
  const [passed, setPassed] = useState(props.passedToday);
  const [error, setError] = useState<string | null>(null);
  const [running, startRunning] = useTransition();
  const [givingUp, startGivingUp] = useTransition();
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // the draft and the timer start live in localStorage, so a page reload does not lose them
  useEffect(() => {
    const draft = readStorage(draftKey);
    if (draft !== null) setCode(draft);
    const savedStart = Number(readStorage(startKey));
    const start = Number.isFinite(savedStart) && savedStart > 0 ? savedStart : Date.now();
    writeStorage(startKey, String(start));
    setStartedAt(start);
  }, [draftKey, startKey]);

  // the LiveCodeCoach reminder counts from the level start; once passed or the reference is open, the timer is not needed
  const sessionHref = `/levels/${props.levelKey}`;
  const active = !passed && reference === null;
  useEffect(() => {
    if (startedAt === null) return;
    if (active) adoptLevelSession({ href: sessionHref, label: props.title, startedAt });
    else stopSession(sessionHref);
  }, [startedAt, active, sessionHref, props.title]);

  function changeCode(value: string) {
    setCode(value);
    writeStorage(draftKey, value);
  }

  function elapsedMinutes(): number {
    return startedAt === null ? 1 : Math.max(1, Math.round((Date.now() - startedAt) / 60000));
  }

  function runTests() {
    setError(null);
    startRunning(async () => {
      const result = await runLevelAttempt(props.levelKey, code, elapsedMinutes());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRun({ passed: result.passed, timedOut: result.timedOut, output: result.output, durationMs: result.durationMs });
      if (result.passed) {
        setPassed(true);
        setReference(result.reference);
        // next time (the redo in 2 days) starts from a clean stub
        writeStorage(draftKey, null);
      }
    });
  }

  function giveUp() {
    if (!window.confirm('Open the reference now? The level comes back in 2 days, today it does not count toward the frame.')) return;
    setError(null);
    startGivingUp(async () => {
      const result = await giveUpLevel(props.levelKey, code, elapsedMinutes());
      if (!result.ok) setError(result.error);
      else setReference(result.reference);
    });
  }

  function resetToStub() {
    if (!window.confirm('Start from the empty stub? Your current code will be lost.')) return;
    changeCode(props.stub);
  }

  /** Tab = 2 spaces, Ctrl/Cmd+Enter = run the tests */
  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!running) runTests();
      return;
    }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const editor = event.currentTarget;
    const { selectionStart, selectionEnd } = editor;
    const next = `${code.slice(0, selectionStart)}  ${code.slice(selectionEnd)}`;
    changeCode(next);
    requestAnimationFrame(() => {
      editorRef.current?.setSelectionRange(selectionStart + 2, selectionStart + 2);
    });
  }

  const shownRun: RunView | null = run ?? (props.lastOutput && props.lastOutput.output
    ? { passed: props.lastOutput.passed, timedOut: false, output: props.lastOutput.output, durationMs: 0 }
    : null);

  return (
    <div className="level-play">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span className="mono faint">{props.fileName}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn ghost sm" onClick={openRules} title="Правила live code: 20 хв без плану = стоп">📏 Rules</button>
        {passed && <span className="tag green">✓ cleared today</span>}
      </div>

      <textarea
        ref={editorRef}
        className="textarea mono"
        value={code}
        onChange={(event) => changeCode(event.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        style={{ minHeight: 420, fontSize: 13, lineHeight: 1.55, tabSize: 2, whiteSpace: 'pre', overflowX: 'auto' }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn primary" onClick={runTests} disabled={running || givingUp}>
          {running ? 'Running tests…' : '▶ Run tests'}
        </button>
        <span className="faint" style={{ fontSize: 12 }}>Ctrl+Enter</span>
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={resetToStub} disabled={running}>Reset to stub</button>
        {reference === null && (
          <button className="btn ghost sm" onClick={giveUp} disabled={running || givingUp}>
            {givingUp ? 'Opening…' : 'Give up, show reference'}
          </button>
        )}
      </div>

      {error && <p style={{ color: 'var(--tag-red-fg)', fontSize: 14, marginTop: 8 }}>{error}</p>}

      {shownRun && (
        <div className="callout" style={{ display: 'block', marginTop: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {shownRun.passed ? '✅ Tests are green: level cleared' : shownRun.timedOut ? '⏳ Stopped: took too long' : '❌ Tests are red'}
            {shownRun.durationMs > 0 && <span className="faint" style={{ fontWeight: 400 }}> · {(shownRun.durationMs / 1000).toFixed(1)} s</span>}
          </div>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', fontSize: 12, margin: 0 }}>{shownRun.output}</pre>
        </div>
      )}

      {passed && (
        <div className="callout" style={{ marginTop: 14 }}>
          <span className="emoji">🏁</span>
          <div style={{ fontSize: 14 }}>
            Compare with the reference and write down 1-2 things it does better. Same exercise from scratch in 2 days.
            {props.nextHref && <> <Link href={props.nextHref} style={{ textDecoration: 'underline' }}>Next level →</Link></>}
          </div>
        </div>
      )}

      {reference !== null && (
        <details open={passed} style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Reference</summary>
          <pre className="mono" style={{ background: 'var(--callout)', padding: '12px 14px', borderRadius: 6, overflowX: 'auto', fontSize: 12, marginTop: 8 }}>
            {reference}
          </pre>
        </details>
      )}
    </div>
  );
}
