'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckItem } from '@/components/CheckItem';
import { setPlanStepDone } from '@/app/actions';
import type { Campaign, CampaignRegion, CampaignSite, SiteKind } from '@/lib/campaign';
import type { PlanStepKind } from '@/generated/prisma/enums';

/**
 * Campaign map of a study plan: regions are the weeks from plan.md, each a trail of nodes.
 * Fortress = task (attempt, reference, summary as a three-part ring), 📖/🔎 = reading and depth, 🐉 = exam.
 * A cracked fortress means the task is due for a redo. A fully cleared region gets a flag.
 */

const WIDTH = 760;
/** More nodes per row do not fit with labels; the mini map has almost no labels, so 9 */
const MAX_PER_ROW = 8;
const MAX_PER_ROW_COMPACT = 9;
const PAD_X = 52;
const PAD_TOP = 44;
const ROW_HEIGHT = 112;

const RADIUS: Record<SiteKind, number> = { fortress: 24, read: 17, depth: 17, boss: 27 };
const ICON: Record<SiteKind, string> = { fortress: '🏰', read: '📖', depth: '🔎', boss: '🐉' };

const STEP_LABEL: Record<PlanStepKind, string> = {
  READ: 'читання',
  ATTEMPT: 'спроба',
  REFERENCE: 'еталон',
  SUMMARY: 'саммарі',
  DEPTH: 'поглиблення',
  EXAM: 'екзамен',
};

interface Point {
  x: number;
  y: number;
}

function pointAt(index: number, perRow: number): Point {
  const row = Math.floor(index / perRow);
  const step = index % perRow;
  const column = row % 2 === 0 ? step : perRow - 1 - step;
  const x = perRow === 1 ? WIDTH / 2 : PAD_X + (column * (WIDTH - 2 * PAD_X)) / (perRow - 1);
  const wave = column % 2 === 0 ? -8 : 8;
  return { x, y: PAD_TOP + row * ROW_HEIGHT + wave };
}

function segmentPath(from: Point, to: Point): string {
  if (Math.abs(from.y - to.y) < ROW_HEIGHT / 2) {
    const middle = (to.x - from.x) / 2;
    return `M ${from.x} ${from.y} C ${from.x + middle} ${from.y}, ${to.x - middle} ${to.y}, ${to.x} ${to.y}`;
  }
  const outward = from.x > WIDTH / 2 ? 56 : -56;
  return `M ${from.x} ${from.y} C ${from.x + outward} ${from.y}, ${to.x + outward} ${to.y}, ${to.x} ${to.y}`;
}

/** Fortress ring arc: part i of n, clockwise from 12 o'clock, with gaps between parts. */
function ringArc(center: Point, radius: number, index: number, parts: number): string {
  const gap = parts > 1 ? 0.18 : 0;
  const start = (index / parts) * Math.PI * 2 + gap / 2 - Math.PI / 2;
  const end = ((index + 1) / parts) * Math.PI * 2 - gap / 2 - Math.PI / 2;
  const sx = center.x + radius * Math.cos(start);
  const sy = center.y + radius * Math.sin(start);
  const ex = center.x + radius * Math.cos(end);
  const ey = center.y + radius * Math.sin(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${sx} ${sy} A ${radius} ${radius} 0 ${large} 1 ${ex} ${ey}`;
}

/** Rows of even length: 9 nodes become 5 + 4, not 8 + 1. */
function perRowFor(count: number, compact: boolean): number {
  const max = compact ? MAX_PER_ROW_COMPACT : MAX_PER_ROW;
  const rows = Math.max(1, Math.ceil(count / max));
  return Math.max(1, Math.ceil(count / rows));
}

const NAME_LIMIT = 14;

function shortName(name: string): string {
  return name.length > NAME_LIMIT ? `${name.slice(0, NAME_LIMIT - 1)}…` : name;
}

function Site({ site, point, selected, compact, onSelect }: {
  site: CampaignSite;
  point: Point;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
}) {
  const radius = RADIUS[site.kind];
  const { state } = site;
  const fill = state === 'done' ? 'var(--tag-green-bg)' : state === 'current' ? 'var(--tag-blue-bg)' : 'var(--callout)';
  const stroke = state === 'done' ? 'var(--map-done)' : state === 'current' ? 'var(--accent)' : 'var(--border-strong)';
  const showRing = site.kind === 'fortress' && site.steps.length > 1;
  // on the mini map the whole strip is a link, so the nodes are not buttons
  const interaction = compact ? {} : {
    role: 'button',
    tabIndex: 0,
    onClick: onSelect,
    onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => {
      if (event.key === 'Enter' || event.key === ' ') onSelect();
    },
    style: { cursor: 'pointer', outline: 'none' },
  };
  return (
    <g {...interaction} aria-label={`${site.name}, ${state}${site.cracked ? ', redo' : ''}`} data-site={site.id}>
      {state === 'current' && <circle cx={point.x} cy={point.y} r={radius} className="map-pulse" style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 3 }} />}
      {selected && <circle cx={point.x} cy={point.y} r={radius + 9} style={{ fill: 'none', stroke: 'var(--text)', strokeWidth: 1.5, opacity: 0.5 }} strokeDasharray="3 4" />}
      <circle cx={point.x} cy={point.y} r={radius} style={{ fill, stroke: showRing ? 'none' : stroke, strokeWidth: state === 'locked' ? 1.5 : 2.5 }}
        strokeDasharray={!showRing && state === 'locked' ? '4 4' : undefined} />
      {showRing && site.steps.map((step, index) => (
        <path key={step.id} d={ringArc(point, radius, index, site.steps.length)}
          style={{ fill: 'none', stroke: step.done ? 'var(--map-done)' : state === 'current' ? 'var(--accent)' : 'var(--border-strong)', strokeWidth: step.done ? 4 : 2.5, strokeLinecap: 'round', opacity: step.done || state !== 'locked' ? 1 : 0.7 }} />
      ))}
      <text x={point.x} y={point.y + radius * 0.3} textAnchor="middle" style={{ fontSize: radius * 0.9, opacity: state === 'locked' ? 0.45 : 1 }}>{ICON[site.kind]}</text>
      {site.kind === 'boss' && <text x={point.x} y={point.y - radius - 5} textAnchor="middle" style={{ fontSize: 15, opacity: state === 'locked' ? 0.5 : 1 }}>👑</text>}
      {site.cracked && (
        <g>
          <path d={`M ${point.x - radius * 0.55} ${point.y - radius * 0.7} l ${radius * 0.35} ${radius * 0.45} l ${-radius * 0.2} ${radius * 0.2} l ${radius * 0.45} ${radius * 0.4} l ${-radius * 0.12} ${radius * 0.3}`}
            style={{ fill: 'none', stroke: 'var(--tag-red-fg)', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
          <circle cx={point.x + radius * 0.75} cy={point.y - radius * 0.75} r={8} style={{ fill: 'var(--tag-red-bg)', stroke: 'var(--tag-red-fg)', strokeWidth: 1 }} />
          <text x={point.x + radius * 0.75} y={point.y - radius * 0.75 + 3.5} textAnchor="middle" style={{ fontSize: 10, fill: 'var(--tag-red-fg)', fontWeight: 700 }}>!</text>
        </g>
      )}
      {state === 'done' && !site.cracked && (
        <g>
          <circle cx={point.x + radius * 0.72} cy={point.y - radius * 0.72} r={8} style={{ fill: 'var(--map-done)' }} />
          <path d={`M ${point.x + radius * 0.72 - 3.5} ${point.y - radius * 0.72} l 2.5 2.5 l 4.5 -5`}
            style={{ fill: 'none', stroke: '#fff', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
        </g>
      )}
      {/* on the mini map only the current node and cracked ones get labels, otherwise labels overlap */}
      {(!compact || state === 'current' || site.cracked) && (
        <text x={point.x} y={point.y + radius + 16} textAnchor="middle"
          style={{ fontSize: compact ? 11.5 : 12, fontWeight: state === 'current' ? 600 : 500, fill: site.cracked ? 'var(--tag-red-fg)' : state === 'locked' ? 'var(--faint)' : 'var(--text)' }}>
          {shortName(site.name)}
        </text>
      )}
    </g>
  );
}

function RegionStrip({ region, compact, selectedId, onSelect }: {
  region: CampaignRegion;
  compact: boolean;
  selectedId: string | null;
  onSelect: (site: CampaignSite) => void;
}) {
  const perRow = perRowFor(region.sites.length, compact);
  const points = region.sites.map((_, index) => pointAt(index, perRow));
  const rows = Math.ceil(region.sites.length / perRow);
  const height = PAD_TOP + (rows - 1) * ROW_HEIGHT + 52;
  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" role="img" aria-label={region.name} style={{ display: 'block' }}>
      {points.slice(1).map((to, index) => {
        const from = points[index];
        const fromSite = region.sites[index];
        const toSite = region.sites[index + 1];
        if (!from || !fromSite || !toSite) return null;
        const walked = fromSite.state === 'done' && toSite.state !== 'locked';
        return (
          <path key={`seg-${index}`} d={segmentPath(from, to)}
            style={{ fill: 'none', stroke: walked ? 'var(--map-done)' : 'var(--map-line)', strokeWidth: walked ? 4 : 3, strokeLinecap: 'round' }}
            strokeDasharray={walked ? undefined : '2 9'} />
        );
      })}
      {region.sites.map((site, index) => {
        const point = points[index];
        if (!point) return null;
        return <Site key={site.id} site={site} point={point} selected={site.id === selectedId} compact={compact} onSelect={() => onSelect(site)} />;
      })}
    </svg>
  );
}

function regionTitle(name: string): { title: string; subtitle: string } {
  const [title, ...rest] = name.split(' · ');
  return { title: title || 'Кроки', subtitle: rest.join(' · ') };
}

const REGION_ICON: Record<CampaignRegion['state'], string> = { conquered: '🚩', current: '⚔️', locked: '🔒' };

function SiteDetails({ site }: { site: CampaignSite }) {
  return (
    <div className="campaign-details">
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 4 }}>
        <span>{ICON[site.kind]}</span>
        <b>{site.name}</b>
        {site.cracked && <span className="tag red">настав термін переробки: recall її полагодить</span>}
      </div>
      {site.steps.map((step) => (
        <div key={step.id} className="campaign-step">
          <div style={{ flex: 1, minWidth: 0 }}>
            <CheckItem checked={step.done} label={<span>{step.title}</span>} action={setPlanStepDone.bind(null, step.id)} />
          </div>
          <span className="tag gray">{STEP_LABEL[step.kind]}</span>
          <span className="faint mono" style={{ width: 40, textAlign: 'right' }}>{step.minutes}m</span>
          {step.href.startsWith('http') ? (
            <a href={step.href} target="_blank" rel="noreferrer" className="btn sm ghost" title="Open">↗</a>
          ) : (
            <Link href={step.href} className="btn sm ghost" title="Open">→</Link>
          )}
        </div>
      ))}
    </div>
  );
}

/** The whole campaign: regions stacked vertically, clicking a node shows its steps. */
export function CampaignMap({ campaign }: { campaign: Campaign }) {
  const [selected, setSelected] = useState<CampaignSite | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<number | null>(null);
  // after the data changes (a step is ticked) use the fresh copy of the selected node, not the stale one in state
  const fresh = selected && selectedRegion !== null
    ? campaign.regions[selectedRegion]?.sites.find((site) => site.id === selected.id) ?? null
    : null;

  return (
    <div className="campaign">
      {campaign.regions.map((region, index) => {
        const { title, subtitle } = regionTitle(region.name);
        return (
          <section key={region.name || index} className={`campaign-region ${region.state}`} data-region={index}>
            <div className="campaign-head">
              <span>{REGION_ICON[region.state]}</span>
              <b>{title}</b>
              {subtitle && <span className="muted">{subtitle}</span>}
              <span style={{ flex: 1 }} />
              <span className="faint mono">{region.done}/{region.total}</span>
            </div>
            <RegionStrip
              region={region}
              compact={false}
              selectedId={selectedRegion === index ? fresh?.id ?? null : null}
              onSelect={(site) => {
                const same = selectedRegion === index && fresh?.id === site.id;
                setSelected(same ? null : site);
                setSelectedRegion(same ? null : index);
              }}
            />
            {selectedRegion === index && fresh && <SiteDetails site={fresh} />}
          </section>
        );
      })}
    </div>
  );
}

/** Mini map on Today: only the current region, a click leads to the plan page. */
export function CampaignStrip({ campaign }: { campaign: Campaign }) {
  const region = campaign.regions[campaign.currentRegion];
  if (!region) return null;
  const { title } = regionTitle(region.name);
  return (
    <Link href="/plan" className="campaign-strip" title="Відкрити карту кампанії" data-testid={`campaign-strip-${campaign.sourceId}`}>
      <div className="faint" style={{ fontSize: 12, marginBottom: -4 }}>
        ⚔️ {title}: {region.done}/{region.total} · регіон {campaign.currentRegion + 1} з {campaign.regions.length}
      </div>
      <RegionStrip region={region} compact selectedId={null} onSelect={() => undefined} />
    </Link>
  );
}
