'use client';

import { useState } from 'react';

export interface DayPoint {
  day: string;
  minutes: number;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

interface Tip {
  x: number;
  y: number;
  value: string;
  label: string;
}

/** Хвилини по днях: вертикальні стовпці, одна серія, підказка при наведенні на стовпець. */
export function DailyBars({ data }: { data: DayPoint[] }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const width = 760;
  const height = 180;
  const padTop = 12;
  const padBottom = 22;
  const padLeft = 34; // місце під підписи осі, щоб не налазили на стовпці
  const max = Math.max(60, ...data.map((d) => d.minutes));
  const niceMax = Math.ceil(max / 60) * 60;
  const slot = (width - padLeft) / data.length;
  const barWidth = Math.max(4, slot - 4); // 2px зазор з кожного боку
  const plotHeight = height - padTop - padBottom;
  const gridLines = [0, 0.5, 1].map((f) => Math.round(niceMax * f));

  return (
    <div className="viz" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Minutes per day">
        {gridLines.map((value) => {
          const y = padTop + plotHeight - (value / niceMax) * plotHeight;
          return (
            <g key={value}>
              <line x1={padLeft} x2={width} y1={y} y2={y} stroke="var(--viz-grid)" strokeWidth={1} />
              <text x={padLeft - 6} y={y + 3} fontSize={10} textAnchor="end" fill="var(--faint)">{formatMinutes(value)}</text>
            </g>
          );
        })}
        {data.map((point, index) => {
          const barHeight = (point.minutes / niceMax) * plotHeight;
          const x = padLeft + index * slot + (slot - barWidth) / 2;
          const y = padTop + plotHeight - barHeight;
          const radius = Math.min(4, barWidth / 2, barHeight);
          const showLabel = index % 7 === data.length % 7 || index === data.length - 1;
          return (
            <g key={point.day}>
              {point.minutes > 0 && (
                <path
                  d={`M${x},${padTop + plotHeight} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + barWidth - radius} Q${x + barWidth},${y} ${x + barWidth},${y + radius} V${padTop + plotHeight} Z`}
                  fill="var(--viz-bar)"
                  opacity={tip && tip.label !== formatDay(point.day) ? 0.55 : 1}
                />
              )}
              {/* ціль наведення більша за стовпець: уся колонка */}
              <rect
                x={padLeft + index * slot} y={0} width={slot} height={height} fill="transparent"
                onMouseMove={(event) => {
                  const box = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setTip({ x: ((padLeft + (index + 0.5) * slot) / width) * box.width, y: (y / height) * box.height, value: formatMinutes(point.minutes), label: formatDay(point.day) });
                }}
              />
              {showLabel && (
                <text x={padLeft + index * slot + slot / 2} y={height - 6} fontSize={10} textAnchor={index === data.length - 1 ? 'end' : 'middle'} fill="var(--faint)">
                  {new Date(`${point.day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tip && <div className="viz-tip" style={{ left: tip.x, top: tip.y }}><b>{tip.value}</b>{tip.label}</div>}
    </div>
  );
}

/** Календар активності як на GitHub: колонки = тижні, рядки = дні тижня. Один відтінок, 5 рівнів. */
export function ActivityHeatmap({ data }: { data: DayPoint[] }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const cell = 13;
  const gap = 3;
  const first = data[0] ? new Date(`${data[0].day}T00:00:00Z`) : new Date();
  const offset = (first.getUTCDay() + 6) % 7; // понеділок = 0
  const weeks = Math.ceil((data.length + offset) / 7);
  const level = (minutes: number): number => (minutes === 0 ? 0 : minutes < 30 ? 1 : minutes < 60 ? 2 : minutes < 120 ? 3 : 4);
  const width = weeks * (cell + gap);
  const height = 7 * (cell + gap);

  return (
    <div className="viz" onMouseLeave={() => setTip(null)} style={{ overflowX: 'auto' }}>
      <svg width={width} height={height} role="img" aria-label="Activity calendar">
        {data.map((point, index) => {
          const position = index + offset;
          const x = Math.floor(position / 7) * (cell + gap);
          const y = (position % 7) * (cell + gap);
          return (
            <rect
              key={point.day} x={x} y={y} width={cell} height={cell} rx={3}
              fill={`var(--viz-heat-${level(point.minutes)})`}
              stroke={tip?.label === formatDay(point.day) ? 'var(--text)' : 'none'}
              onMouseMove={() => setTip({ x: x + cell / 2, y, value: formatMinutes(point.minutes), label: formatDay(point.day) })}
            />
          );
        })}
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--faint)', marginTop: 6 }}>
        <span>less</span>
        {[0, 1, 2, 3, 4].map((value) => (
          <span key={value} style={{ width: 11, height: 11, borderRadius: 3, background: `var(--viz-heat-${value})`, display: 'inline-block' }} />
        ))}
        <span>more · 0 / &lt;30m / &lt;1h / &lt;2h / 2h+</span>
      </div>
      {tip && <div className="viz-tip" style={{ left: tip.x, top: tip.y }}><b>{tip.value}</b>{tip.label}</div>}
    </div>
  );
}
