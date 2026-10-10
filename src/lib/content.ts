/**
 * Навчальний матеріал: карта навантажень, патерни мислення, «Сеньйорський мінімум», довідник.
 * Контент живе в src/content/*.json і версіонується разом з апкою; прогрес по ньому живе в БД.
 * Ідентифікатори стабільні: клітинка "A3" (продукт A, група 3), патерн "P7", дрил "mon-2".
 */
import mapJson from '@/content/map.json';
import patternsJson from '@/content/patterns.json';
import minimumJson from '@/content/minimum.json';
import referenceJson from '@/content/reference.json';

// ------------------------------------------------------------------ карта

export interface Product {
  id: string;
  name: string;
  sub: string;
  metric: string;
}

export interface LoadGroup {
  id: string;
  name: string;
  rps: string;
  dau: string;
  data: string;
  team: string;
}

/** Блок на схемі. lane 0..5 = колонка (клієнт → зовнішнє), row = рядок у колонці. */
export interface CellNode {
  id: string;
  lane: number;
  row: number;
  label: string;
  sub: string;
  /** що цей блок робить саме на цьому масштабі */
  note: string;
}

export interface CellEdge {
  from: string;
  to: string;
  traffic: string;
  latency: string;
  note: string;
}

export interface PathHop {
  step: string;
  ms: string;
}

export interface RequestPath {
  name: string;
  hops: PathHop[];
  total: string;
  note: string;
}

export interface WhyItem {
  patterns: string[];
  text: string;
}

export interface CellExample {
  kind: string;
  text: string;
}

export interface Cell {
  id: string;
  product: string;
  group: string;
  scale: string[];
  pain: string;
  nodes: CellNode[];
  edges: CellEdge[];
  path: RequestPath;
  why: WhyItem[];
  notYet: string;
  example: CellExample | null;
  refs: string[];
}

/** Словник блоків: що це, навіщо в системі, що буде без нього. Ключ = CellNode.id. */
export interface NodeGloss {
  what: string;
  why: string;
  without: string;
}

export interface MapContent {
  products: Product[];
  groups: LoadGroup[];
  lanes: string[];
  cells: Cell[];
  glossary: Record<string, NodeGloss>;
}

// ------------------------------------------------------------------ патерни

export interface PatternAnswer {
  when: string;
  then: string;
}

export interface Pattern {
  id: string;
  name: string;
  q: string;
  steps: string[];
  formulas: string[];
  answers: PatternAnswer[];
  example: string;
  anti: string;
  refs: string[];
}

export interface FrameworkStep {
  step: string;
  time: string;
  text: string;
}

export interface PatternsContent {
  patterns: Pattern[];
  framework: FrameworkStep[];
}

// ------------------------------------------------------------------ мінімум

export interface FlowStep {
  title: string;
  tag: string;
  text: string;
}

export interface TrophyLayer {
  layer: string;
  what: string;
  note: string;
  /** ширина шару у відсотках: скільки цінності він дає в бекенді */
  width: number;
}

export interface TitledText {
  title: string;
  text: string;
}

export interface Concept {
  term: string;
  text: string;
}

export interface MetricRow {
  where: string;
  metric: string;
  how: string;
}

export interface ModulePattern {
  id: string;
  name: string;
  q: string;
  ifthen: PatternAnswer[];
  anti: string;
}

export interface Drill {
  /** "<module>-<n>", стабільний: по ньому в БД лежать спроби */
  id: string;
  q: string;
  ref: string[];
  check: string[];
}

export interface Module {
  id: string;
  name: string;
  short: string;
  thesis: string;
  flow: FlowStep[];
  trophy: TrophyLayer[];
  side: TitledText[];
  decision: boolean;
  concepts: Concept[];
  aws: MetricRow[];
  phrases: TitledText[];
  patterns: ModulePattern[];
  interview: string;
  experience: TitledText[];
  drills: Drill[];
}

export interface SourceLink {
  title: string;
  url: string;
}

export interface MinimumContent {
  modules: Module[];
  sources: SourceLink[];
}

// ------------------------------------------------------------------ довідник

export interface NumberRow {
  area: string;
  op: string;
  value: string;
  source: string;
  estimate: boolean;
}

export interface LimitRow {
  service: string;
  what: string;
  scaling: string;
  note: string;
}

export interface DbScaleRow {
  db: string;
  reads: string;
  writes: string;
  storage: string;
  trap: string;
}

export interface LatencyBar {
  label: string;
  min: number;
  max: number;
  note: string;
  estimate: boolean;
}

/** w = пише, r = читає, x = маршрутизує, s = шард, p = партиція, st = сховище */
export type DbBoxKind = 'w' | 'r' | 'x' | 's' | 'p' | 'st';

export interface DbBox {
  label: string;
  kind: DbBoxKind;
  col: number;
  row: number;
}

export interface DbArrow {
  from: number;
  to: number;
  label: string;
}

export type ScalerWho = 'САМ' | 'ТИ' | 'НАЛАШТУЄШ';

export interface DbTag {
  what: string;
  who: ScalerWho;
  text: string;
}

export interface DbDiagram {
  name: string;
  boxes: DbBox[];
  arrows: DbArrow[];
  tags: DbTag[];
  trap: string;
}

export interface AwsBadge {
  value: string;
  caption: string;
}

export interface AwsCard {
  name: string;
  what: string;
  badges: AwsBadge[];
  scaler: { who: ScalerWho; text: string };
  note: string;
}

export interface RefKey {
  key: string;
  text: string;
}

export interface ReferenceContent {
  numbers: NumberRow[];
  limits: LimitRow[];
  dbscale: DbScaleRow[];
  refs: RefKey[];
  sources: SourceLink[];
  latency: LatencyBar[];
  dbs: DbDiagram[];
  aws: AwsCard[];
}

// ------------------------------------------------------------------ доступ

export const MAP: MapContent = mapJson as MapContent;
export const PATTERNS: PatternsContent = patternsJson as PatternsContent;
export const MINIMUM: MinimumContent = minimumJson as MinimumContent;
export const REFERENCE: ReferenceContent = referenceJson as ReferenceContent;

const cellById = new Map<string, Cell>(MAP.cells.map((cell) => [cell.id, cell]));
const patternById = new Map<string, Pattern>(PATTERNS.patterns.map((pattern) => [pattern.id, pattern]));
const moduleById = new Map<string, Module>(MINIMUM.modules.map((module) => [module.id, module]));

export function getCell(id: string): Cell | null {
  return cellById.get(id) ?? null;
}

export function getPattern(id: string): Pattern | null {
  return patternById.get(id) ?? null;
}

export function getModule(id: string): Module | null {
  return moduleById.get(id) ?? null;
}

export function getDrill(id: string): { module: Module; drill: Drill } | null {
  for (const module of MINIMUM.modules) {
    const drill = module.drills.find((entry) => entry.id === id);
    if (drill) return { module, drill };
  }
  return null;
}

export function productOf(cell: Cell): Product {
  const product = MAP.products.find((entry) => entry.id === cell.product);
  if (!product) throw new Error(`unknown product ${cell.product}`);
  return product;
}

export function groupOf(cell: Cell): LoadGroup {
  const group = MAP.groups.find((entry) => entry.id === cell.group);
  if (!group) throw new Error(`unknown group ${cell.group}`);
  return group;
}

/** Клітинка тієї ж колонки групою нижче (A3 → A2), null для групи 1. */
export function previousCell(cell: Cell): Cell | null {
  const group = Number(cell.group);
  return group > 1 ? getCell(`${cell.product}${group - 1}`) : null;
}

/** Сусіди для навігації: менший і більший масштаб, інший продукт у тій самій групі. */
export interface CellNeighbours {
  up: Cell | null;
  down: Cell | null;
  left: Cell | null;
  right: Cell | null;
}

export function cellNeighbours(cell: Cell): CellNeighbours {
  const productIndex = MAP.products.findIndex((entry) => entry.id === cell.product);
  const group = Number(cell.group);
  const left = MAP.products[productIndex - 1];
  const right = MAP.products[productIndex + 1];
  return {
    up: group > 1 ? getCell(`${cell.product}${group - 1}`) : null,
    down: group < MAP.groups.length ? getCell(`${cell.product}${group + 1}`) : null,
    left: left ? getCell(`${left.id}${cell.group}`) : null,
    right: right ? getCell(`${right.id}${cell.group}`) : null,
  };
}

/**
 * Блоки, яких у цій колонці ще не було на жодній з менших груп (той самий id і той самий підпис).
 * Те, що з'явилось або помітно змінилось, на схемі підсвічується як нове.
 */
export function newNodeIds(cell: Cell): Set<string> {
  const seen = new Set<string>();
  for (let group = 1; group < Number(cell.group); group += 1) {
    const earlier = getCell(`${cell.product}${group}`);
    if (!earlier) continue;
    for (const node of earlier.nodes) seen.add(`${node.id}|${node.label}`);
  }
  return new Set(cell.nodes.filter((node) => !seen.has(`${node.id}|${node.label}`)).map((node) => node.id));
}

/** Де патерн спрацював у матриці: id клітинок, у яких він стоїть у «Чому саме так». */
export function cellsUsingPattern(patternId: string): string[] {
  return MAP.cells.filter((cell) => cell.why.some((why) => why.patterns.includes(patternId))).map((cell) => cell.id);
}

/** Порядок проходження карти: по групах, у групі по продуктах (A1, B1, C1, D1, A2, …). */
export function cellOrder(): Cell[] {
  const ordered: Cell[] = [];
  for (const group of MAP.groups) {
    for (const product of MAP.products) {
      const cell = getCell(`${product.id}${group.id}`);
      if (cell) ordered.push(cell);
    }
  }
  return ordered;
}

/** Усі дрили по порядку модулів. */
export function drillOrder(): Drill[] {
  return MINIMUM.modules.flatMap((module) => module.drills);
}
