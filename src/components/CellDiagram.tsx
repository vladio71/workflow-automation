'use client';

import { useMemo, useState } from 'react';
import type { Cell, CellEdge, CellNode, NodeGloss } from '@/lib/content';

interface CellDiagramProps {
  cell: Cell;
  lanes: string[];
  newIds: string[];
  glossary: Record<string, NodeGloss>;
}

interface NodePosition {
  x: number;
  y: number;
  node: CellNode;
}

interface Point {
  x: number;
  y: number;
}

interface Curve {
  d: string;
  points: [Point, Point, Point, Point];
}

/** Геометрія схеми: колонка = смуга (lane), блок стоїть у рядку колонки. */
const LANE_WIDTH = 178;
const NODE_WIDTH = 152;
const NODE_HEIGHT = 50;
const ROW_HEIGHT = 74;
const TOP = 34;
const PAD_X = 14;
const LANE_CLASS = ['lane-client', 'lane-entry', 'lane-compute', 'lane-background', 'lane-data', 'lane-external'];

function layout(cell: Cell): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  for (const node of cell.nodes) {
    positions.set(node.id, { x: PAD_X + node.lane * LANE_WIDTH, y: TOP + node.row * ROW_HEIGHT, node });
  }
  return positions;
}

function curve(from: NodePosition, to: NodePosition): Curve {
  if (to.node.lane === from.node.lane) {
    const x1 = from.x + NODE_WIDTH / 2;
    const x2 = to.x + NODE_WIDTH / 2;
    const down = to.y > from.y;
    const y1 = down ? from.y + NODE_HEIGHT : from.y;
    const y2 = down ? to.y : to.y + NODE_HEIGHT;
    const dx = 36;
    const p1: Point = { x: x1, y: y1 };
    const p2: Point = { x: x1 + dx, y: y1 + (y2 - y1) / 3 };
    const p3: Point = { x: x2 + dx, y: y1 + (2 * (y2 - y1)) / 3 };
    const p4: Point = { x: x2, y: y2 };
    return { d: `M${p1.x},${p1.y} C${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`, points: [p1, p2, p3, p4] };
  }
  const rightwards = to.node.lane > from.node.lane;
  const x1 = rightwards ? from.x + NODE_WIDTH : from.x;
  const x2 = rightwards ? to.x : to.x + NODE_WIDTH;
  const y1 = from.y + NODE_HEIGHT / 2;
  const y2 = to.y + NODE_HEIGHT / 2;
  const dx = Math.max(40, Math.abs(x2 - x1) / 2);
  const sign = rightwards ? 1 : -1;
  const p1: Point = { x: x1, y: y1 };
  const p2: Point = { x: x1 + sign * dx, y: y1 };
  const p3: Point = { x: x2 - sign * dx, y: y2 };
  const p4: Point = { x: x2, y: y2 };
  return { d: `M${p1.x},${p1.y} C${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`, points: [p1, p2, p3, p4] };
}

function pointAt(points: [Point, Point, Point, Point], t: number): Point {
  const m = 1 - t;
  const [a, b, c, d] = points;
  return {
    x: m * m * m * a.x + 3 * m * m * t * b.x + 3 * m * t * t * c.x + t * t * t * d.x,
    y: m * m * m * a.y + 3 * m * m * t * b.y + 3 * m * t * t * c.y + t * t * t * d.y,
  };
}

/** Номер стрілки ставимо там, де він не лягає на блок і на інший номер. */
function markerPositions(curves: Curve[], positions: NodePosition[]): Point[] {
  const markers: Point[] = [];
  for (const entry of curves) {
    let best: Point | null = null;
    for (const t of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]) {
      const point = pointAt(entry.points, t);
      const onNode = positions.some(
        (p) => point.x > p.x - 11 && point.x < p.x + NODE_WIDTH + 11 && point.y > p.y - 11 && point.y < p.y + NODE_HEIGHT + 11,
      );
      const onMarker = markers.some((m) => Math.hypot(m.x - point.x, m.y - point.y) < 22);
      if (!onNode && !onMarker) {
        best = point;
        break;
      }
    }
    markers.push(best ?? pointAt(entry.points, 0.5));
  }
  return markers;
}

function trim(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function CellDiagram({ cell, lanes, newIds, glossary }: CellDiagramProps) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const positions = useMemo(() => layout(cell), [cell]);
  const newSet = useMemo(() => new Set(newIds), [newIds]);
  const rows = Math.max(...cell.nodes.map((node) => node.row)) + 1;
  const width = PAD_X * 2 + 5 * LANE_WIDTH + NODE_WIDTH;
  const height = TOP + rows * ROW_HEIGHT + 8;
  const labelOf = new Map(cell.nodes.map((node) => [node.id, node.label]));

  const curves = useMemo(() => cell.edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) throw new Error(`edge ${edge.from} → ${edge.to} points at a missing node`);
    return curve(from, to);
  }), [cell, positions]);
  const markers = useMemo(() => markerPositions(curves, [...positions.values()]), [curves, positions]);

  const current = selectedNode ? cell.nodes.find((node) => node.id === selectedNode) ?? null : null;
  const gloss = current ? glossary[current.id] ?? null : null;
  const toggleEdge = (index: number): void => setSelectedEdge((value) => (value === index ? null : index));

  return (
    <div>
      <div className="diagram-wrap">
        <svg className="cell-diagram" viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', minWidth: width * 0.85, height: 'auto' }} role="img" aria-label={`Схема ${cell.id}`}>
          {lanes.map((lane, index) => (
            <g key={lane}>
              <rect className="lane-bg" x={PAD_X + index * LANE_WIDTH - 6} y={22} width={NODE_WIDTH + 12} height={height - 26} rx={8} />
              <text className="lane-title" x={PAD_X + index * LANE_WIDTH} y={15}>{lane}</text>
            </g>
          ))}
          {curves.map((entry, index) => (
            <path
              key={`e${index}`}
              className={`edge${selectedEdge === index ? ' hl' : ''}`}
              d={entry.d}
              markerEnd="url(#cell-arrowhead)"
              onClick={() => toggleEdge(index)}
            />
          ))}
          {markers.map((point, index) => (
            <g key={`m${index}`} className={`marker${selectedEdge === index ? ' hl' : ''}`} onClick={() => toggleEdge(index)}>
              <circle cx={point.x.toFixed(1)} cy={point.y.toFixed(1)} r={9.5} />
              <text x={point.x.toFixed(1)} y={point.y.toFixed(1)}>{index + 1}</text>
            </g>
          ))}
          {cell.nodes.map((node) => {
            const position = positions.get(node.id);
            if (!position) return null;
            const isNew = newSet.has(node.id);
            const classes = ['node', LANE_CLASS[node.lane] ?? '', isNew ? 'new' : '', selectedNode === node.id ? 'sel' : ''].join(' ');
            return (
              <g
                key={node.id}
                className={classes}
                tabIndex={0}
                onClick={() => setSelectedNode(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedNode(node.id);
                  }
                }}
              >
                <rect className="box" x={position.x} y={position.y} width={NODE_WIDTH} height={NODE_HEIGHT} rx={7} />
                <text className="t" x={position.x + 9} y={position.y + (node.sub ? 20 : 30)}>{trim(node.label, isNew ? 18 : 22)}</text>
                {node.sub && <text className="s" x={position.x + 9} y={position.y + 37}>{trim(node.sub, 27)}</text>}
                {isNew && <text className="new-tag" x={position.x + NODE_WIDTH - 6} y={position.y + 11} textAnchor="end">НОВЕ</text>}
                <title>{node.sub ? `${node.label} · ${node.sub}` : node.label}</title>
              </g>
            );
          })}
          <defs>
            <marker id="cell-arrowhead" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="arrowhead" />
            </marker>
          </defs>
        </svg>
      </div>

      <div className="node-info">
        {current ? (
          <>
            <b>{current.label}</b>{current.sub ? ` · ${current.sub}` : ''}
            {gloss?.what && <div><span className="node-info-key">ЩО</span> {gloss.what}</div>}
            {gloss?.why && <div><span className="node-info-key">НАВІЩО</span> {gloss.why}</div>}
            {current.note && <div><span className="node-info-key">ТУТ</span> {current.note}</div>}
            {gloss?.without && <div><span className="node-info-key">БЕЗ НЬОГО</span> {gloss.without}</div>}
          </>
        ) : (
          <span className="muted">Натисни на блок: що це, навіщо він тут і що буде без нього. Номер на стрілці відповідає рядку в таблиці потоків.</span>
        )}
      </div>

      <h3 className="block-title">Потоки: трафік і затримка</h3>
      <div className="tbl-scroll">
        <table className="db flows">
          <thead>
            <tr><th style={{ width: 28 }}>#</th><th>Звідки → куди</th><th>Трафік</th><th>Затримка</th></tr>
          </thead>
          <tbody>
            {cell.edges.map((edge: CellEdge, index) => (
              <tr key={index} className={`flow${selectedEdge === index ? ' hl' : ''}`} onClick={() => toggleEdge(index)}>
                <td className="mono muted">{index + 1}</td>
                <td>{labelOf.get(edge.from)} → {labelOf.get(edge.to)}</td>
                <td>{edge.traffic || '—'}</td>
                <td className="mono">{edge.latency || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
