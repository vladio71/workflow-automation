import { RefillButton } from '@/components/RefillButton';
import { Tag } from '@/components/Tag';
import type { TagColor } from '@/lib/labels';
import { isGeminiConfigured } from '@/lib/gemini';
import { getChestState, getLootStats } from '@/lib/loot';
import { LOOT_RULES, POOL_TARGETS, STATIC_CARDS, type LootRarity, type PoolKind } from '@/lib/loot.config';
import { lastRefill } from '@/lib/loot-refill';

const RARITIES: readonly LootRarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
const RARITY_COLOR: Record<LootRarity, TagColor> = { COMMON: 'gray', UNCOMMON: 'green', RARE: 'blue', EPIC: 'purple', LEGENDARY: 'orange' };
const POOL_KINDS: readonly PoolKind[] = ['MEME', 'NEWS', 'ARTICLE', 'MUSIC', 'ANIME', 'FILM'];
const POOL_SOURCE: Record<PoolKind, string> = {
  MEME: 'xkcd',
  NEWS: 'Gemini + Google Search, backup Hacker News',
  ARTICLE: 'Gemini + Google Search, backup Hacker News',
  MUSIC: 'Gemini + Google Search',
  ANIME: 'Gemini + Google Search',
  FILM: 'Gemini + Google Search, only after the boss',
};
const KIND_ICON: Record<string, string> = { MICRO: '🌿', MEME: '😂', NEWS: '📰', ARTICLE: '📖', MUSIC: '🎧', ANIME: '📺', FILM: '🎬', GAME: '🎮' };

export default async function LootPage() {
  const now = new Date();
  const [chest, stats] = await Promise.all([getChestState(now), getLootStats(now)]);
  const refill = lastRefill();

  return (
    <div className="page">
      <div className="page-icon">🎁</div>
      <h1 className="page-title">Loot</h1>
      <p className="page-sub">
        The chest on Today&apos;s map: a ticket for every cleared node, two for the boss. At most {LOOT_RULES.maxPullsPerDay} a day and
        not more often than every {LOOT_RULES.minMinutesBetweenPulls} min. Every {LOOT_RULES.pityEvery}th chest without an epic is at least
        epic, and a common is never followed by another common. After each legendary the chance of another one that day drops four
        times. Cards, odds and limits live in <code className="mono">src/lib/loot.config.ts</code>.
      </p>

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="label">Today</div><div className="value">{chest.pullsToday}/{chest.maxPullsPerDay}</div><div className="hint">🎟 ×{chest.tickets} left</div></div>
        <div className="kpi"><div className="label">Epic guaranteed in</div><div className="value">{chest.pityLeft}</div><div className="hint">chests</div></div>
        <div className="kpi"><div className="label">Collected</div><div className="value">{stats.total}</div><div className="hint">all time</div></div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {RARITIES.map((rarity) => (
          <Tag key={rarity} color={RARITY_COLOR[rarity]}>{rarity.toLowerCase()} {stats.byRarity[rarity]} · {LOOT_RULES.weights[rarity]}%</Tag>
        ))}
      </div>

      <h2 className="block-title">Pool</h2>
      {!isGeminiConfigured() && (
        <p className="muted" style={{ fontSize: 14 }}>No GEMINI_API_KEY: news and articles come from Hacker News, films, anime and music only from the static list.</p>
      )}
      <table className="db" style={{ marginBottom: 12 }}>
        <tbody>
          {POOL_KINDS.map((kind) => (
            <tr key={kind}>
              <td style={{ width: 36, textAlign: 'center' }}>{KIND_ICON[kind]}</td>
              <td style={{ width: 110 }}>{kind.toLowerCase()}</td>
              <td className="mono" style={{ width: 80 }}>{stats.poolByKind[kind] ?? 0}/{POOL_TARGETS[kind]}</td>
              <td className="muted">{POOL_SOURCE[kind]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <RefillButton />
      {refill && !refill.skipped && (
        <p className="faint" style={{ fontSize: 13, marginTop: 8 }}>
          Last refill {new Date(refill.at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}
          {Object.keys(refill.added).length > 0 && <>: {Object.entries(refill.added).map(([kind, count]) => `${kind} +${count}`).join(', ')}</>}
          {refill.errors.length > 0 && <span style={{ color: 'var(--tag-red-fg)' }}> · {refill.errors.join(' · ')}</span>}
        </p>
      )}

      <h2 className="block-title">Always in the chest</h2>
      <table className="db">
        <tbody>
          {STATIC_CARDS.map((card) => (
            <tr key={card.id}>
              <td style={{ width: 36, textAlign: 'center' }}>{KIND_ICON[card.kind] ?? '🎁'}</td>
              <td className="title-cell">{card.title}</td>
              <td style={{ width: 110 }}><Tag color={RARITY_COLOR[card.rarity]}>{card.rarity.toLowerCase()}</Tag></td>
              <td className="muted mono" style={{ width: 60 }}>{card.minutes}m</td>
              <td className="faint" style={{ width: 150, fontSize: 13 }}>
                {card.afterBoss ? 'after the boss' : card.fallback ? 'if the pool has none' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {stats.recent.length > 0 && (
        <>
          <h2 className="block-title">History</h2>
          <table className="db">
            <tbody>
              {stats.recent.map((pull) => (
                <tr key={pull.id}>
                  <td className="muted mono" style={{ width: 110 }}>
                    {new Date(pull.openedAt).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ width: 36, textAlign: 'center' }}>{KIND_ICON[pull.kind] ?? '🎁'}</td>
                  <td className="title-cell">
                    {pull.url ? <a href={pull.url} target="_blank" rel="noreferrer">{pull.title} ↗</a> : pull.title}
                  </td>
                  <td style={{ width: 110 }}><Tag color={RARITY_COLOR[pull.rarity]}>{pull.rarity.toLowerCase()}</Tag></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
