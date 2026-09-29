'use client';

import { useEffect, useState, useTransition } from 'react';
import { finishRestNow, openChestNow } from '@/app/actions';
import type { LootRarity } from '@/lib/loot.config';
import type { ChestState, RestPullView } from '@/lib/loot';

interface ChestProps {
  state: ChestState;
  /** поточний вузол карти: куди повертатись після відпочинку */
  nextTitle: string | null;
}

const RARITY_LABEL: Record<LootRarity, string> = {
  COMMON: 'Common',
  UNCOMMON: 'Uncommon',
  RARE: 'Rare',
  EPIC: 'Epic',
  LEGENDARY: 'Legendary',
};

const KIND_ICON: Record<string, string> = {
  MICRO: '🌿',
  MEME: '😂',
  NEWS: '📰',
  ARTICLE: '📖',
  MUSIC: '🎧',
  ANIME: '📺',
  FILM: '🎬',
  GAME: '🎮',
};

const GUARANTEE_LABEL: Record<string, string> = {
  pity: 'no epic for a while: guaranteed',
  boss: 'boss reward',
  streak: 'after a common: uncommon or better',
};

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

/** Поточний час, що оновлюється раз на секунду (для таймера відпочинку і "відкриється о …"). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function RestCard({ pull, reveal, nextTitle, onBack, backing }: {
  pull: RestPullView;
  reveal: boolean;
  nextTitle: string | null;
  onBack: () => void;
  backing: boolean;
}) {
  const now = useNow();
  const endsAt = new Date(pull.openedAt).getTime() + pull.minutes * 60_000;
  const left = Math.round((endsAt - now) / 1000);
  const over = left <= 0;

  return (
    <div className={`loot-card r-${pull.rarity}${reveal ? ' reveal' : ''}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className={`loot-rarity r-${pull.rarity}`}>{RARITY_LABEL[pull.rarity]}</span>
        {pull.guarantee && <span className="faint" style={{ fontSize: 12 }}>{GUARANTEE_LABEL[pull.guarantee] ?? pull.guarantee}</span>}
        <span style={{ flex: 1 }} />
        <span className={`tag ${over ? 'green' : 'gray'}`}>⏱ {over ? "time's up" : formatClock(left)}</span>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginTop: 10 }}>
        <span style={{ fontSize: 26 }}>{KIND_ICON[pull.kind] ?? '🎁'}</span>
        <b style={{ fontSize: 18, lineHeight: 1.3 }}>{pull.title}</b>
      </div>
      {pull.body && <p className="muted" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{pull.body}</p>}
      {pull.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- зовнішня картинка (xkcd), оптимізація Next тут не потрібна
        <img src={pull.imageUrl} alt={pull.title} style={{ display: 'block', maxWidth: '100%', maxHeight: 420, objectFit: 'contain', margin: '12px auto 0' }} />
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {pull.url && (
          <a className="btn sm" href={pull.url} target="_blank" rel="noreferrer">Open ↗</a>
        )}
        <span style={{ flex: 1 }} />
        <button className={`btn sm${over ? ' primary' : ' ghost'}`} onClick={onBack} disabled={backing}>
          {over ? `Back to the map${nextTitle ? `: ${nextTitle}` : ''}` : 'Back to the map early'}
        </button>
      </div>
    </div>
  );
}

export function Chest({ state, nextTitle }: ChestProps) {
  const now = useNow();
  const [revealId, setRevealId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, startOpening] = useTransition();
  const [backing, startBacking] = useTransition();

  function open() {
    setError(null);
    startOpening(async () => {
      const result = await openChestNow();
      if (!result.ok) setError(result.error);
      else setRevealId(result.pull.id);
    });
  }

  function back(pullId: number) {
    startBacking(async () => {
      await finishRestNow(pullId);
      setRevealId(null);
    });
  }

  const active = state.active;
  if (active) {
    return (
      <div style={{ margin: '4px 0 12px' }}>
        <RestCard pull={active} reveal={active.id === revealId} nextTitle={nextTitle} onBack={() => back(active.id)} backing={backing} />
      </div>
    );
  }

  // сервер закрив скриню інтервалом, а час уже минув: можна пробувати (сервер перевірить ще раз)
  const retryPassed = state.retryAt !== null && now >= new Date(state.retryAt).getTime();
  const canOpen = state.open || (retryPassed && state.tickets > 0);

  return (
    <div className="loot-bar">
      <span style={{ fontSize: 20 }}>🎁</span>
      <b>Chest</b>
      <span className="muted" style={{ fontSize: 13 }}>
        🎟 ×{state.tickets} · {state.pullsToday}/{state.maxPullsPerDay} today · epic in {state.pityLeft}
        {state.bossBonusReady && (state.legendaryToday === 0 ? ' · 👑 boss chest: legendary' : ' · 👑 boss chest: rare or better')}
        {state.legendaryToday > 0 && ` · legendary today: ${state.legendaryToday}`}
      </span>
      <span style={{ flex: 1 }} />
      {state.todayPulls.length > 0 && (
        <span style={{ display: 'inline-flex', gap: 3 }}>
          {state.todayPulls.map((pull) => (
            <span key={pull.id} className={`loot-dot r-${pull.rarity}`} title={`${RARITY_LABEL[pull.rarity]}: ${pull.title}`} />
          ))}
        </span>
      )}
      {canOpen ? (
        <button className="btn primary sm" onClick={open} disabled={opening}>{opening ? 'Opening…' : 'Open the chest'}</button>
      ) : (
        <span className="faint" style={{ fontSize: 13 }}>
          {state.reason}
          {state.retryAt && !retryPassed && <> Opens at {formatTime(state.retryAt)}.</>}
        </span>
      )}
      {error && <span style={{ color: 'var(--tag-red-fg)', fontSize: 13, width: '100%' }}>{error}</span>}
    </div>
  );
}
