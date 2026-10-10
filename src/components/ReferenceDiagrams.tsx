import type { DbDiagram as DbDiagramData, LatencyBar, ScalerWho } from '@/lib/content';

/** Затримки на логарифмічній шкалі: кожна поділка ×10, смуга = діапазон. */
export function LatencyLadder({ bars }: { bars: LatencyBar[] }) {
  const sorted = [...bars].sort((a, b) => a.min - b.min || a.max - b.max);
  const labelWidth = 230;
  const width = 1040;
  const rowHeight = 30;
  const top = 10;
  const plotWidth = width - labelWidth - 260;
  const lo = Math.log10(0.05);
  const hi = Math.log10(60000);
  const x = (value: number): number => labelWidth + ((Math.log10(value) - lo) / (hi - lo)) * plotWidth;
  const ticks: { value: number; label: string }[] = [
    { value: 0.1, label: '0,1 мс' }, { value: 1, label: '1 мс' }, { value: 10, label: '10 мс' }, { value: 100, label: '100 мс' },
    { value: 1000, label: '1 с' }, { value: 10000, label: '10 с' },
  ];
  const height = top + sorted.length * rowHeight + 28;
  const format = (value: number): string => (value < 1000 ? `${value}` : `${value / 1000}`).replace('.', ',');
  const range = (bar: LatencyBar): string => {
    if (bar.max < 1000) return `${format(bar.min)}–${format(bar.max)} мс`;
    if (bar.min >= 1000) return `${format(bar.min)}–${format(bar.max)} с`;
    return `${format(bar.min)} мс – ${format(bar.max)} с`;
  };
  const tone = (bar: LatencyBar): string => (bar.max < 5 ? 'fast' : bar.max < 120 ? 'ok' : bar.max < 2000 ? 'slow' : 'very-slow');

  return (
    <div className="tbl-scroll">
      <svg className="latency" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Затримки на логарифмічній шкалі">
        {ticks.map((tick) => (
          <g key={tick.value}>
            <line className="tick" x1={x(tick.value)} x2={x(tick.value)} y1={top - 4} y2={top + sorted.length * rowHeight} />
            <text className="tick-label" x={x(tick.value)} y={height - 8} textAnchor="middle">{tick.label}</text>
          </g>
        ))}
        {sorted.map((bar, index) => {
          const y = top + index * rowHeight;
          const x1 = x(bar.min);
          const x2 = Math.max(x(bar.max), x1 + 6);
          return (
            <g key={bar.label} className={`bar ${tone(bar)}${bar.estimate ? ' estimate' : ''}`}>
              <text className="bar-label" x={labelWidth - 10} y={y + 17} textAnchor="end">{bar.label}</text>
              <rect x={x1} y={y + 6} width={x2 - x1} height={16} rx={3} />
              <text className="bar-value" x={x2 + 8} y={y + 18}>{range(bar)}{bar.estimate ? ' · оцінка' : bar.note ? ` · ${bar.note}` : ''}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const BOX_WIDTH = 150;
const BOX_HEIGHT = 44;
const COL_GAP = 24;
const ROW_GAP = 34;

export function ScalerTag({ who }: { who: ScalerWho }) {
  const tone = who === 'САМ' ? 'auto' : who === 'ТИ' ? 'manual' : 'configured';
  return <span className={`scaler ${tone}`}>{who}</span>;
}

/** Одна база: блоки primary / репліки / шарди і стрілки між ними. */
export function DbDiagram({ data }: { data: DbDiagramData }) {
  const rows = Math.max(...data.boxes.map((box) => box.row)) + 1;
  const width = 3 * BOX_WIDTH + 2 * COL_GAP + 2;
  const height = rows * BOX_HEIGHT + (rows - 1) * ROW_GAP + 2;
  const place = (index: number): { x: number; y: number; w: number } | null => {
    const box = data.boxes[index];
    if (!box) return null;
    const wide = box.kind === 'st' && box.label.startsWith('Спільне');
    return { x: 1 + box.col * (BOX_WIDTH + COL_GAP), y: 1 + box.row * (BOX_HEIGHT + ROW_GAP), w: wide ? 3 * BOX_WIDTH + 2 * COL_GAP : BOX_WIDTH };
  };
  return (
    <svg className="db-diagram" viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxWidth: width, height: 'auto' }} role="img" aria-label={`Як масштабується ${data.name}`}>
      {data.arrows.map((arrow, index) => {
        const from = place(arrow.from);
        const to = place(arrow.to);
        if (!from || !to) return null;
        const sameRow = Math.abs(from.y - to.y) < 1;
        const x1 = sameRow ? from.x + from.w : from.x + from.w / 2;
        const y1 = sameRow ? from.y + BOX_HEIGHT / 2 : from.y + BOX_HEIGHT;
        const x2 = sameRow ? to.x : (x1 >= to.x && x1 <= to.x + to.w ? x1 : to.x + to.w / 2);
        const y2 = sameRow ? to.y + BOX_HEIGHT / 2 : to.y;
        return (
          <g key={index}>
            <line className="db-arrow" x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#db-arrowhead)" />
            {arrow.label && <text className="db-arrow-label" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} textAnchor="middle">{arrow.label}</text>}
          </g>
        );
      })}
      {data.boxes.map((box, index) => {
        const at = place(index);
        if (!at) return null;
        const lines = box.label.split('\n');
        return (
          <g key={index} className={`db-box kind-${box.kind}`}>
            <rect x={at.x} y={at.y} width={at.w} height={BOX_HEIGHT} rx={6} />
            {lines.map((line, lineIndex) => (
              <text key={lineIndex} x={at.x + 10} y={at.y + (lines.length === 1 ? 27 : 18 + lineIndex * 15)}>{line}</text>
            ))}
          </g>
        );
      })}
      <defs>
        <marker id="db-arrowhead" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrowhead" />
        </marker>
      </defs>
    </svg>
  );
}
