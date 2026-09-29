'use client';

import type { PlanItemWithStatus } from '@/lib/planner';

/**
 * План дня як карта: вузли на звивистій стежці в порядку виконання.
 * Пройдені горять, поточний пульсує, наступні закриті, поки не пройдеш поточний. Найдовший пункт = бос.
 */
export type NodeState = 'done' | 'current' | 'locked';

interface DayMapProps {
  items: PlanItemWithStatus[];
  icons: Record<PlanItemWithStatus['kind'], string>;
  selectedId: string | null;
  bossId: string | null;
  stateOf: (item: PlanItemWithStatus) => NodeState;
  onSelect: (id: string) => void;
}

interface Point {
  x: number;
  y: number;
}

const WIDTH = 760;
const PER_ROW = 4;
const PAD_X = 70;
const PAD_TOP = 56;
const ROW_HEIGHT = 150;
const RADIUS = 24;
const BOSS_RADIUS = 31;
/** наскільки U-поворот між рядами виходить за крайній вузол */
const TURN_BULGE = 64;

/** Змійка: парні ряди зліва направо, непарні справа наліво; легка хвиля по висоті, щоб було схоже на стежку. */
function pointAt(index: number): Point {
  const row = Math.floor(index / PER_ROW);
  const step = index % PER_ROW;
  const column = row % 2 === 0 ? step : PER_ROW - 1 - step;
  const x = PAD_X + (column * (WIDTH - 2 * PAD_X)) / (PER_ROW - 1);
  const wave = column % 2 === 0 ? -10 : 12;
  return { x, y: PAD_TOP + row * ROW_HEIGHT + wave };
}

/** Відрізок стежки між вузлами: у межах ряду S-крива, між рядами дуга назовні. */
function segmentPath(from: Point, to: Point): string {
  const sameRow = Math.abs(from.y - to.y) < ROW_HEIGHT / 2;
  if (sameRow) {
    const middle = (to.x - from.x) / 2;
    return `M ${from.x} ${from.y} C ${from.x + middle} ${from.y}, ${to.x - middle} ${to.y}, ${to.x} ${to.y}`;
  }
  const outward = from.x > WIDTH / 2 ? TURN_BULGE : -TURN_BULGE;
  return `M ${from.x} ${from.y} C ${from.x + outward} ${from.y}, ${to.x + outward} ${to.y}, ${to.x} ${to.y}`;
}

const TITLE_PREFIX = /^(Level redo|Level|Recall|Redo з нуля|Cards|Cycle \d+): /;

function shortTitle(title: string): string {
  const clean = title.replace(TITLE_PREFIX, '').replace(/^work on /, '');
  return clean.length > 22 ? `${clean.slice(0, 21)}…` : clean;
}

export function DayMap({ items, icons, selectedId, bossId, stateOf, onSelect }: DayMapProps) {
  const points = items.map((_, index) => pointAt(index));
  const finish = pointAt(items.length);
  const allDone = items.length > 0 && items.every((item) => stateOf(item) === 'done');
  const rows = Math.floor(items.length / PER_ROW) + 1;
  const height = PAD_TOP + (rows - 1) * ROW_HEIGHT + 84;

  const trail = [...points, finish];

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" role="img" aria-label="Plan for today as a map" style={{ display: 'block', margin: '6px 0 2px' }}>
      {/* стежка: пройдене суцільне зелене, решта пунктиром */}
      {trail.slice(1).map((to, index) => {
        const from = trail[index];
        if (!from) return null;
        const fromItem = items[index];
        const toItem = items[index + 1];
        const walked = fromItem !== undefined && stateOf(fromItem) === 'done' && (toItem === undefined ? allDone : stateOf(toItem) !== 'locked');
        return (
          <path
            key={`seg-${index}`}
            d={segmentPath(from, to)}
            style={{ fill: 'none', stroke: walked ? 'var(--map-done)' : 'var(--map-line)', strokeWidth: walked ? 4 : 3, strokeLinecap: 'round' }}
            strokeDasharray={walked ? undefined : '2 9'}
          />
        );
      })}

      {/* фініш */}
      <g style={{ opacity: allDone ? 1 : 0.35 }}>
        <text x={finish.x} y={finish.y + 9} textAnchor="middle" style={{ fontSize: 28 }}>🏁</text>
        <text x={finish.x} y={finish.y + 40} textAnchor="middle" style={{ fontSize: 12, fill: 'var(--muted)' }}>{allDone ? 'Day cleared' : 'Finish'}</text>
      </g>

      {items.map((item, index) => {
        const point = points[index];
        if (!point) return null;
        const state = stateOf(item);
        const isBoss = item.id === bossId;
        const radius = isBoss ? BOSS_RADIUS : RADIUS;
        const selected = item.id === selectedId;
        const fill = state === 'done' ? 'var(--tag-green-bg)' : state === 'current' ? 'var(--tag-blue-bg)' : 'var(--callout)';
        const stroke = state === 'done' ? 'var(--map-done)' : state === 'current' ? 'var(--accent)' : 'var(--border-strong)';
        return (
          <g
            key={item.id}
            role="button"
            tabIndex={0}
            aria-label={`${item.title}, ${state}`}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect(item.id);
            }}
            style={{ cursor: 'pointer', outline: 'none' }}
          >
            {state === 'current' && (
              <circle cx={point.x} cy={point.y} r={radius} className="map-pulse" style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 3 }} />
            )}
            {selected && <circle cx={point.x} cy={point.y} r={radius + 7} style={{ fill: 'none', stroke: 'var(--text)', strokeWidth: 1.5, opacity: 0.5 }} strokeDasharray="3 4" />}
            <circle
              cx={point.x}
              cy={point.y}
              r={radius}
              style={{ fill, stroke, strokeWidth: state === 'locked' ? 1.5 : 3 }}
              strokeDasharray={state === 'locked' ? '4 4' : undefined}
            />
            <text x={point.x} y={point.y + (isBoss ? 9 : 7)} textAnchor="middle" style={{ fontSize: isBoss ? 25 : 20, opacity: state === 'locked' ? 0.45 : 1 }}>
              {icons[item.kind]}
            </text>
            {isBoss && <text x={point.x} y={point.y - radius - 6} textAnchor="middle" style={{ fontSize: 18 }}>👑</text>}
            {state === 'done' && (
              <g>
                <circle cx={point.x + radius * 0.72} cy={point.y - radius * 0.72} r={9} style={{ fill: 'var(--map-done)' }} />
                <path
                  d={`M ${point.x + radius * 0.72 - 4} ${point.y - radius * 0.72} l 3 3 l 5 -6`}
                  style={{ fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}
                />
              </g>
            )}
            <text
              x={point.x}
              y={point.y + radius + 18}
              textAnchor="middle"
              style={{ fontSize: 12.5, fontWeight: state === 'current' ? 600 : 500, fill: state === 'locked' ? 'var(--faint)' : 'var(--text)' }}
            >
              {shortTitle(item.title)}
            </text>
            <text x={point.x} y={point.y + radius + 34} textAnchor="middle" style={{ fontSize: 11.5, fill: 'var(--faint)' }}>
              {item.minutes}m{isBoss ? ' · boss' : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
