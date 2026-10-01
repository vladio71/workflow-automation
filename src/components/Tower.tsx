/**
 * Башта дня: кожен крок сесії (відправлене резюме) = поверх. Недобудовані поверхи до цілі стоять риштуванням,
 * на цілі зверху зубці і прапор, понад ціль поверхи золоті. Без хуків: малюється і на сервері, і в клієнті.
 */

export type TowerSize = 'lg' | 'md';

interface TowerProps {
  count: number;
  target: number;
  size?: TowerSize;
  /** щойно додали поверх: верхній збудований з'являється з анімацією */
  grow?: boolean;
}

interface TowerGeometry {
  floor: number;
  width: number;
}

const GEOMETRY: Record<TowerSize, TowerGeometry> = {
  lg: { floor: 22, width: 112 },
  md: { floor: 13, width: 70 },
};

const BASE = 10;
const TOP_SPACE = 34;
const SIDE = 26;

function Window({ x, y, width, height, lit }: { x: number; y: number; width: number; height: number; lit: boolean }) {
  return <rect x={x} y={y} width={width} height={height} rx={1.5} style={{ fill: lit ? 'var(--tower-window)' : 'var(--tower-dark-window)' }} />;
}

/** Дах, коли ціль дня є: зубці і прапор. */
function Roof({ left, width, floor, topY, grow }: { left: number; width: number; floor: number; topY: number; grow: boolean }) {
  const merlon = width / 7;
  const merlonTop = topY - floor * 0.4;
  const poleTop = merlonTop - 22;
  return (
    <g className={grow ? 'tower-grow' : undefined}>
      {[0, 2, 4, 6].map((slot) => (
        <rect key={slot} x={left + slot * merlon} y={merlonTop} width={merlon} height={floor * 0.4}
          style={{ fill: 'var(--tower-stone)', stroke: 'var(--tower-stone-edge)', strokeWidth: 1 }} />
      ))}
      <line x1={left + width / 2} y1={merlonTop} x2={left + width / 2} y2={poleTop} style={{ stroke: 'var(--tower-stone-edge)', strokeWidth: 2 }} />
      <path d={`M ${left + width / 2} ${poleTop} l 16 5 l -16 5 z`} style={{ fill: 'var(--tower-flag)' }} />
    </g>
  );
}

export function Tower({ count, target, size = 'md', grow = false }: TowerProps) {
  const { floor, width } = GEOMETRY[size];
  const floors = Math.max(target, count, 1);
  const complete = target > 0 && count >= target;
  const viewWidth = width + SIDE * 2;
  const viewHeight = TOP_SPACE + floors * floor + BASE;
  const left = SIDE;
  const groundY = viewHeight - BASE;
  const windowWidth = Math.max(4, width * 0.13);
  const windowHeight = floor * 0.45;

  return (
    <svg
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      width={viewWidth}
      height={viewHeight}
      role="img"
      aria-label={`Башта: ${count} з ${target}`}
      style={{ display: 'block', maxWidth: '100%' }}
    >
      {/* земля і фундамент */}
      <rect x={4} y={groundY} width={viewWidth - 8} height={3} rx={1.5} style={{ fill: 'var(--tower-ground)' }} />
      <rect x={left - 6} y={groundY - 4} width={width + 12} height={5} rx={2} style={{ fill: 'var(--tower-stone-edge)' }} />

      {Array.from({ length: floors }, (_, index) => {
        const y = groundY - 4 - (index + 1) * floor;
        const built = index < count;
        if (!built) {
          // риштування: пунктирний каркас з розкосом
          return (
            <g key={`s-${index}`} style={{ opacity: 0.55 }}>
              <rect x={left} y={y} width={width} height={floor} style={{ fill: 'none', stroke: 'var(--tower-scaffold)', strokeWidth: 1 }} strokeDasharray="3 3" />
              <path d={`M ${left} ${y + floor} L ${left + width} ${y}`} style={{ stroke: 'var(--tower-scaffold)', strokeWidth: 1 }} strokeDasharray="2 4" />
            </g>
          );
        }
        const bonus = target > 0 && index >= target;
        const isTop = index === count - 1;
        return (
          <g key={`b-${index}`} className={grow && isTop ? 'tower-grow' : undefined}>
            <rect
              x={left}
              y={y}
              width={width}
              height={floor}
              style={{ fill: bonus ? 'var(--tower-bonus)' : 'var(--tower-stone)', stroke: 'var(--tower-stone-edge)', strokeWidth: 1 }}
            />
            <Window x={left + width * 0.22} y={y + floor * 0.28} width={windowWidth} height={windowHeight} lit />
            <Window x={left + width * 0.78 - windowWidth} y={y + floor * 0.28} width={windowWidth} height={windowHeight} lit />
            {index === 0 && (
              <path
                d={`M ${left + width / 2 - floor * 0.32} ${y + floor} v ${-floor * 0.62} a ${floor * 0.32} ${floor * 0.32} 0 0 1 ${floor * 0.64} 0 v ${floor * 0.62} z`}
                style={{ fill: 'var(--tower-stone-edge)' }}
              />
            )}
          </g>
        );
      })}

      {complete && <Roof left={left} width={width} floor={floor} topY={groundY - 4 - count * floor} grow={grow} />}
    </svg>
  );
}

const WEEKDAYS: readonly string[] = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export interface SkylineDay {
  /** "2026-10-01" */
  day: string;
  count: number;
}

/** Скайлайн: маленькі башти за останні дні. Висота = скільки відправив, прапор = ціль дня була. */
export function Skyline({ days, target }: { days: readonly SkylineDay[]; target: number }) {
  const slot = 22;
  const maxFloors = Math.max(target, ...days.map((day) => day.count), 1);
  const plot = 46;
  const floor = plot / maxFloors;
  const width = days.length * slot;
  const height = plot + 30;
  const groundY = plot + 10;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Башти за останні дні" style={{ display: 'block', maxWidth: '100%' }}>
      <rect x={0} y={groundY} width={width} height={2} style={{ fill: 'var(--tower-ground)' }} />
      {days.map((entry, index) => {
        const date = new Date(`${entry.day}T00:00:00Z`);
        const isToday = index === days.length - 1;
        const x = index * slot + 5;
        const towerHeight = entry.count * floor;
        const reached = target > 0 && entry.count >= target;
        return (
          <g key={entry.day}>
            <title>{`${date.getUTCDate()}.${String(date.getUTCMonth() + 1).padStart(2, '0')}: ${entry.count}/${target}`}</title>
            {entry.count > 0 ? (
              <g>
                <rect x={x} y={groundY - towerHeight} width={12} height={towerHeight} rx={1}
                  style={{ fill: reached ? 'var(--tower-stone)' : 'var(--tower-scaffold)', stroke: isToday ? 'var(--accent)' : 'var(--tower-stone-edge)', strokeWidth: isToday ? 1.5 : 1 }} />
                {/* вікна: по одному на поверх, якщо поверхи не надто тонкі */}
                {floor >= 3.5 && Array.from({ length: entry.count }, (_, level) => (
                  <rect key={level} x={x + 5} y={groundY - (level + 1) * floor + floor * 0.3} width={2} height={Math.min(2, floor * 0.4)} style={{ fill: 'var(--tower-window)' }} />
                ))}
              </g>
            ) : (
              <rect x={x} y={groundY - 2} width={12} height={2} style={{ fill: 'var(--tower-scaffold)' }} />
            )}
            {reached && <path d={`M ${x + 6} ${groundY - towerHeight} v -9 l 6 2 l -6 2`} style={{ fill: 'var(--tower-flag)', stroke: 'var(--tower-stone-edge)', strokeWidth: 0.8 }} />}
            <text x={x + 6} y={groundY + 16} textAnchor="middle" style={{ fontSize: 9.5, fill: isToday ? 'var(--text)' : 'var(--faint)', fontWeight: isToday ? 600 : 400 }}>
              {WEEKDAYS[date.getUTCDay()]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
