import { prerequisiteClosure, unlocksWithin } from "./graph.ts";

export type StationState = "solid" | "learning" | "due" | "ready" | "locked" | "suggested";
export type LabelAt = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type SegmentKind = "track" | "planned" | "link";

export interface TransitLine {
  readonly id: string;
  readonly title: string;
}

export interface TransitStationInput {
  readonly id: string;
  readonly title: string;
  readonly lineIds: readonly string[];
  readonly state: StationState;
  readonly recall?: number;
  readonly misconception?: boolean;
  readonly minor?: boolean;
}

export interface TransitEdge {
  readonly from: string;
  readonly to: string;
  readonly planned?: boolean;
}

export interface TransitInput {
  readonly lines: readonly TransitLine[];
  readonly stations: readonly TransitStationInput[];
  readonly edges: readonly TransitEdge[];
  readonly anchors?: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
}

export interface TransitPoint {
  readonly x: number;
  readonly y: number;
}

export interface LaidStation {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly lineId: string | null;
  readonly lineIds: readonly string[];
  readonly interchange: boolean;
  readonly labelAt: LabelAt;
}

export interface LaidSegment {
  readonly from: string;
  readonly to: string;
  readonly lineId: string | null;
  readonly points: readonly (readonly [number, number])[];
  readonly kind: SegmentKind;
}

export interface TransitLayout {
  readonly width: number;
  readonly height: number;
  readonly stations: readonly LaidStation[];
  readonly segments: readonly LaidSegment[];
  readonly stubs: readonly {
    readonly lineId: string;
    readonly points: readonly (readonly [number, number])[];
  }[];
  readonly bullets: readonly {
    readonly lineId: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
  }[];
}

type Point = [number, number];

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const DX = 100;
const DY = 70;
const MARGIN = 60;
const LABEL_CHAR_PX = 7;
const LABEL_SIZE_PX = 12.5;
const STUB_GAP = 40;
const LABEL_ORDER: readonly LabelAt[] = ["s", "n", "e", "w", "se", "sw", "ne", "nw"];

export function layoutTransit(input: TransitInput): TransitLayout {
  const lines = uniqueLines(input.lines);
  const stations = uniqueStations(input.stations);
  const lineIds = new Set(lines.map((line) => line.id));
  const index = new Map(stations.map((station, position) => [station.id, position]));
  const knownLines = new Map(
    stations.map((station) => [station.id, station.lineIds.filter((id) => lineIds.has(id))]),
  );
  const primary = new Map(
    stations.map((station) => [station.id, knownLines.get(station.id)?.[0] ?? null]),
  );

  const lineCells = new Map<string, Map<string, { col: number; row: number }>>();
  for (const line of lines) {
    lineCells.set(line.id, layoutLine(line.id, stations, knownLines, primary, input.edges, index));
  }

  const baseRow = new Map<string, number>();
  let cursor = 0;
  for (const line of lines) {
    baseRow.set(line.id, cursor);
    const hosted = [...(lineCells.get(line.id) ?? []).values()];
    if (hosted.length === 0) continue;
    cursor += Math.max(...hosted.map((cell) => cell.row)) + 1;
  }

  const ideal = new Map<string, Point>();
  for (const station of stations) {
    const lineId = primary.get(station.id);
    if (lineId === undefined || lineId === null) continue;
    const cell = lineCells.get(lineId)?.get(station.id);
    if (!cell) continue;
    ideal.set(station.id, [
      MARGIN + (cell.col + 1) * DX,
      MARGIN + ((baseRow.get(lineId) ?? 0) + cell.row) * DY,
    ]);
  }

  const placed = new Map<string, Point>();
  const anchors = input.anchors ?? {};
  for (const station of stations) {
    const anchor = anchors[station.id];
    if (!anchor) continue;
    placed.set(station.id, [anchor.x, anchor.y]);
  }
  for (const station of stations) {
    if (placed.has(station.id)) continue;
    const slot = ideal.get(station.id);
    if (!slot) continue;
    placed.set(station.id, nearestFree(slot, placed));
  }
  placeOffLine(stations, input.edges, placed);

  const pointsOf = (id: string): Point => placed.get(id) ?? [MARGIN + DX, MARGIN];
  const segments: LaidSegment[] = [];
  for (const edge of input.edges) {
    if (!placed.has(edge.from) || !placed.has(edge.to) || edge.from === edge.to) continue;
    const fromLines = knownLines.get(edge.from) ?? [];
    const toLines = knownLines.get(edge.to) ?? [];
    const lineId = fromLines.find((id) => toLines.includes(id)) ?? null;
    const kind: SegmentKind =
      edge.planned === true
        ? "planned"
        : lineId === null
          ? "link"
          : "track";
    segments.push({
      from: edge.from,
      to: edge.to,
      lineId,
      points: octiline(pointsOf(edge.from), pointsOf(edge.to)),
      kind,
    });
  }

  const rowOffset = new Map<string, number>();
  for (const line of lines) {
    for (const [id, cell] of lineCells.get(line.id) ?? [])
      rowOffset.set(`${line.id}:${id}`, cell.row);
  }
  const stubs: TransitLayout["stubs"][number][] = [];
  const bullets: TransitLayout["bullets"][number][] = [];
  for (const line of lines) {
    const end = lineEnd(line.id, stations, knownLines, primary, rowOffset, placed, index);
    if (!end) continue;
    const width = Math.round(line.title.length * LABEL_CHAR_PX + 16);
    const x = end[0] - STUB_GAP - width;
    const y = end[1];
    bullets.push({ lineId: line.id, x, y, width });
    stubs.push({ lineId: line.id, points: [[x + width, y], end] });
  }

  const polylines: Point[][] = [
    ...segments.map((segment) => segment.points.map((point): Point => [point[0], point[1]])),
    ...stubs.map((stub) => stub.points.map((point): Point => [point[0], point[1]])),
  ];
  const obstacles: Box[] = bullets.map((bullet) => ({
    left: bullet.x,
    top: bullet.y - 9,
    right: bullet.x + bullet.width,
    bottom: bullet.y + 9,
  }));
  const labelAt = new Map<string, LabelAt>();
  for (const station of stations) {
    const point = pointsOf(station.id);
    const interchange = (knownLines.get(station.id)?.length ?? 0) >= 2;
    const chosen = chooseLabel(
      station.title,
      point,
      interchange,
      obstacles,
      polylines,
      placed,
      station.id,
    );
    labelAt.set(station.id, chosen.at);
    obstacles.push(chosen.box);
  }

  let maxX = 0;
  let maxY = 0;
  const include = (x: number, y: number) => {
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const laidStations: LaidStation[] = stations.map((station) => {
    const point = pointsOf(station.id);
    include(point[0], point[1]);
    return {
      id: station.id,
      x: point[0],
      y: point[1],
      lineId: primary.get(station.id) ?? null,
      lineIds: station.lineIds,
      interchange: (knownLines.get(station.id)?.length ?? 0) >= 2,
      labelAt: labelAt.get(station.id) ?? "s",
    };
  });
  for (const segment of segments) {
    for (const point of segment.points) include(point[0], point[1]);
  }
  for (const stub of stubs) {
    for (const point of stub.points) include(point[0], point[1]);
  }
  for (const bullet of bullets) include(bullet.x + bullet.width, bullet.y);

  return {
    width: maxX + MARGIN,
    height: maxY + MARGIN,
    stations: laidStations,
    segments,
    stubs,
    bullets,
  };
}

export function focusSet(
  edges: readonly { readonly from: string; readonly to: string }[],
  id: string,
  opts?: { readonly unlockDepth?: number },
): Set<string> {
  const focused = new Set<string>([id]);
  for (const prerequisite of prerequisiteClosure(edges, id)) focused.add(prerequisite);
  for (const unlocked of unlocksWithin(edges, id, opts?.unlockDepth ?? 2)) focused.add(unlocked);
  return focused;
}

export function roundedPath(points: readonly (readonly [number, number])[], r = 16): string {
  const first = points[0];
  if (!first) return "";
  let d = `M${first[0]},${first[1]}`;
  for (let index = 1; index < points.length - 1; index++) {
    const a = points[index - 1];
    const b = points[index];
    const c = points[index + 1];
    if (!a || !b || !c) continue;
    const l1 = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (l1 === 0 || l2 === 0) continue;
    const radius = Math.min(r, l1 / 2, l2 / 2);
    const sx = b[0] + ((a[0] - b[0]) / l1) * radius;
    const sy = b[1] + ((a[1] - b[1]) / l1) * radius;
    const ex = b[0] + ((c[0] - b[0]) / l2) * radius;
    const ey = b[1] + ((c[1] - b[1]) / l2) * radius;
    d += ` L${sx},${sy} Q${b[0]},${b[1]} ${ex},${ey}`;
  }
  const last = points[points.length - 1] ?? first;
  return `${d} L${last[0]},${last[1]}`;
}

function uniqueLines(lines: readonly TransitLine[]): TransitLine[] {
  const seen = new Set<string>();
  const out: TransitLine[] = [];
  for (const line of lines) {
    if (seen.has(line.id)) continue;
    seen.add(line.id);
    out.push(line);
  }
  return out;
}

function uniqueStations(stations: readonly TransitStationInput[]): TransitStationInput[] {
  const seen = new Set<string>();
  const out: TransitStationInput[] = [];
  for (const station of stations) {
    if (seen.has(station.id)) continue;
    seen.add(station.id);
    out.push(station);
  }
  return out;
}

function layoutLine(
  lineId: string,
  stations: readonly TransitStationInput[],
  knownLines: Map<string, readonly string[]>,
  primary: Map<string, string | null>,
  edges: readonly TransitEdge[],
  index: Map<string, number>,
): Map<string, { col: number; row: number }> {
  const onLine = stations
    .filter((station) => (knownLines.get(station.id) ?? []).includes(lineId))
    .map((station) => station.id);
  const onLineSet = new Set(onLine);
  const preds = new Map<string, string[]>(onLine.map((id) => [id, []]));
  const succs = new Map<string, string[]>(onLine.map((id) => [id, []]));
  for (const edge of edges) {
    if (!onLineSet.has(edge.from) || !onLineSet.has(edge.to) || edge.from === edge.to) continue;
    preds.get(edge.to)?.push(edge.from);
    succs.get(edge.from)?.push(edge.to);
  }
  const layer = longestLayers(onLine, preds, succs, index);
  const reach = reachableLayer(onLine, succs, layer, index);
  const onMain = mainPath(onLine, preds, succs, reach, index);
  const row = assignRows(onLine, preds, succs, onMain, reach, layer, index);
  const hosted = onLine.filter((id) => primary.get(id) === lineId);
  const ordered = hosted
    .slice()
    .sort(
      (a, b) =>
        (layer.get(a) ?? 0) - (layer.get(b) ?? 0) || (index.get(a) ?? 0) - (index.get(b) ?? 0),
    );
  const used = new Set<string>();
  const cells = new Map<string, { col: number; row: number }>();
  for (const id of ordered) {
    const col = layer.get(id) ?? 0;
    let slot = row.get(id) ?? 0;
    while (used.has(`${col}:${slot}`)) slot += 1;
    used.add(`${col}:${slot}`);
    cells.set(id, { col, row: slot });
  }
  return cells;
}

function longestLayers(
  ids: readonly string[],
  preds: Map<string, string[]>,
  succs: Map<string, string[]>,
  index: Map<string, number>,
): Map<string, number> {
  const indegree = new Map(ids.map((id) => [id, preds.get(id)?.length ?? 0]));
  const ready = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const layer = new Map<string, number>();
  while (ready.length > 0) {
    const id = takeEarliest(ready, index);
    if (id === undefined) break;
    let depth = 0;
    for (const pre of preds.get(id) ?? []) depth = Math.max(depth, (layer.get(pre) ?? 0) + 1);
    layer.set(id, depth);
    for (const child of succs.get(id) ?? []) {
      const next = (indegree.get(child) ?? 1) - 1;
      indegree.set(child, next);
      if (next === 0) ready.push(child);
    }
  }
  for (const id of ids) if (!layer.has(id)) layer.set(id, 0);
  return layer;
}

function reachableLayer(
  ids: readonly string[],
  succs: Map<string, string[]>,
  layer: Map<string, number>,
  index: Map<string, number>,
): Map<string, number> {
  const reach = new Map<string, number>();
  const ordered = ids
    .slice()
    .sort(
      (a, b) =>
        (layer.get(b) ?? 0) - (layer.get(a) ?? 0) || (index.get(a) ?? 0) - (index.get(b) ?? 0),
    );
  for (const id of ordered) {
    let best = layer.get(id) ?? 0;
    for (const child of succs.get(id) ?? [])
      best = Math.max(best, reach.get(child) ?? layer.get(child) ?? 0);
    reach.set(id, best);
  }
  return reach;
}

function mainPath(
  ids: readonly string[],
  preds: Map<string, string[]>,
  succs: Map<string, string[]>,
  reach: Map<string, number>,
  index: Map<string, number>,
): Set<string> {
  const sources = ids.filter((id) => (preds.get(id)?.length ?? 0) === 0);
  sources.sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
  let primary = sources[0];
  for (const source of sources) {
    if (primary === undefined || (reach.get(source) ?? 0) > (reach.get(primary) ?? 0))
      primary = source;
  }
  const onMain = new Set<string>();
  let cursor = primary;
  while (cursor !== undefined && !onMain.has(cursor)) {
    onMain.add(cursor);
    const nexts = succs.get(cursor) ?? [];
    if (nexts.length === 0) break;
    cursor = pickTrunk(nexts, reach);
  }
  return onMain;
}

function assignRows(
  ids: readonly string[],
  preds: Map<string, string[]>,
  succs: Map<string, string[]>,
  onMain: Set<string>,
  reach: Map<string, number>,
  layer: Map<string, number>,
  index: Map<string, number>,
): Map<string, number> {
  const row = new Map<string, number>();
  let nextRow = 1;
  const ordered = ids
    .slice()
    .sort(
      (a, b) =>
        (layer.get(a) ?? 0) - (layer.get(b) ?? 0) || (index.get(a) ?? 0) - (index.get(b) ?? 0),
    );
  for (const id of ordered) {
    if (onMain.has(id)) {
      row.set(id, 0);
      continue;
    }
    const parents = (preds.get(id) ?? []).filter((parent) => row.has(parent));
    const parent = parents.find((candidate) => onMain.has(candidate)) ?? parents[0];
    if (parent === undefined) {
      row.set(id, nextRow);
      nextRow += 1;
      continue;
    }
    const siblings = (succs.get(parent) ?? []).filter((child) => !onMain.has(child));
    const trunk = pickTrunk(siblings, reach);
    if (id === trunk && (row.get(parent) ?? 0) > 0) row.set(id, row.get(parent) ?? 0);
    else {
      row.set(id, nextRow);
      nextRow += 1;
    }
  }
  return row;
}

function pickTrunk(nexts: readonly string[], reach: Map<string, number>): string | undefined {
  let trunk = nexts[0];
  for (const candidate of nexts) {
    if (trunk === undefined || (reach.get(candidate) ?? 0) > (reach.get(trunk) ?? 0))
      trunk = candidate;
  }
  return trunk;
}

function takeEarliest(ready: string[], index: Map<string, number>): string | undefined {
  let best = 0;
  for (let position = 1; position < ready.length; position++) {
    const candidate = ready[position];
    const current = ready[best];
    if (candidate === undefined || current === undefined) continue;
    if ((index.get(candidate) ?? 0) < (index.get(current) ?? 0)) best = position;
  }
  return ready.splice(best, 1)[0];
}

function placeOffLine(
  stations: readonly TransitStationInput[],
  edges: readonly TransitEdge[],
  placed: Map<string, Point>,
): void {
  const pending = stations.filter((station) => !placed.has(station.id));
  while (pending.length > 0) {
    const readyAt = pending.findIndex((station) => {
      const incoming = edges.filter((edge) => edge.to === station.id);
      return incoming.length === 0 || incoming.some((edge) => placed.has(edge.from));
    });
    const station = pending.splice(readyAt === -1 ? 0 : readyAt, 1)[0];
    if (!station) break;
    placed.set(station.id, nearestFree(idealNear(station.id, edges, placed), placed));
  }
}

function idealNear(id: string, edges: readonly TransitEdge[], placed: Map<string, Point>): Point {
  for (const edge of edges) {
    if (edge.to !== id) continue;
    const pre = placed.get(edge.from);
    if (pre) return [pre[0] + DX, pre[1] + DY];
  }
  return [MARGIN + DX, MARGIN + DY];
}

function nearestFree(ideal: Point, placed: Map<string, Point>): Point {
  const originCol = Math.round((ideal[0] - MARGIN) / DX);
  const originRow = Math.round((ideal[1] - MARGIN) / DY);
  const occupied = [...placed.values()];
  for (let radius = 0; radius < 64; radius++) {
    let best: { point: Point; distance: number; col: number; row: number } | null = null;
    for (let colOffset = -radius; colOffset <= radius; colOffset++) {
      for (let rowOffset = -radius; rowOffset <= radius; rowOffset++) {
        if (Math.max(Math.abs(colOffset), Math.abs(rowOffset)) !== radius) continue;
        const col = originCol + colOffset;
        const row = originRow + rowOffset;
        const point: Point = [MARGIN + col * DX, MARGIN + row * DY];
        if (occupied.some((other) => tooClose(point, other))) continue;
        const distance = Math.hypot(point[0] - ideal[0], point[1] - ideal[1]);
        if (
          !best ||
          distance < best.distance - 1e-6 ||
          (Math.abs(distance - best.distance) <= 1e-6 &&
            (col < best.col || (col === best.col && row < best.row)))
        ) {
          best = { point, distance, col, row };
        }
      }
    }
    if (best) return best.point;
  }
  return [ideal[0], ideal[1]];
}

function tooClose(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) < DX / 2 && Math.abs(a[1] - b[1]) < DY / 2;
}

function lineEnd(
  lineId: string,
  stations: readonly TransitStationInput[],
  knownLines: Map<string, readonly string[]>,
  primary: Map<string, string | null>,
  rowOffset: Map<string, number>,
  placed: Map<string, Point>,
  index: Map<string, number>,
): Point | undefined {
  const hosted = stations.filter((station) => primary.get(station.id) === lineId);
  const main = hosted.filter((station) => (rowOffset.get(`${lineId}:${station.id}`) ?? 0) === 0);
  const pool =
    main.length > 0
      ? main
      : hosted.length > 0
        ? hosted
        : stations.filter((station) => (knownLines.get(station.id) ?? []).includes(lineId));
  const ranked = pool.slice().sort((a, b) => {
    const pa = placed.get(a.id);
    const pb = placed.get(b.id);
    return (
      (pa?.[0] ?? 0) - (pb?.[0] ?? 0) ||
      (pa?.[1] ?? 0) - (pb?.[1] ?? 0) ||
      (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0)
    );
  });
  const first = ranked[0];
  return first ? placed.get(first.id) : undefined;
}

function octiline(from: Point, to: Point): Point[] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < 1e-9 || ady < 1e-9 || Math.abs(adx - ady) < 1e-9) return [from, to];
  const diag = Math.min(adx, ady);
  const mid: Point = [from[0] + Math.sign(dx) * diag, from[1] + Math.sign(dy) * diag];
  return [from, mid, to];
}

function chooseLabel(
  title: string,
  point: Point,
  interchange: boolean,
  obstacles: readonly Box[],
  polylines: readonly Point[][],
  placed: Map<string, Point>,
  selfId: string,
): { at: LabelAt; box: Box } {
  let chosen: LabelAt = "s";
  let chosenBox = labelBox(title, point, interchange, "s");
  let chosenHits = Number.POSITIVE_INFINITY;
  for (const at of LABEL_ORDER) {
    const box = labelBox(title, point, interchange, at);
    const hits = labelHits(box, obstacles, polylines, placed, selfId);
    if (hits < chosenHits) {
      chosen = at;
      chosenBox = box;
      chosenHits = hits;
    }
    if (hits === 0) break;
  }
  return { at: chosen, box: chosenBox };
}

function labelHits(
  box: Box,
  obstacles: readonly Box[],
  polylines: readonly Point[][],
  placed: Map<string, Point>,
  selfId: string,
): number {
  let hits = 0;
  const padded = {
    left: box.left - 2,
    top: box.top - 2,
    right: box.right + 2,
    bottom: box.bottom + 2,
  };
  for (const obstacle of obstacles) if (boxesOverlap(padded, obstacle)) hits += 1;
  for (const [id, point] of placed) {
    if (id === selfId) continue;
    if (
      boxesOverlap(padded, {
        left: point[0] - 12,
        top: point[1] - 12,
        right: point[0] + 12,
        bottom: point[1] + 12,
      })
    ) {
      hits += 1;
    }
  }
  const stroke = {
    left: box.left - 4,
    top: box.top - 4,
    right: box.right + 4,
    bottom: box.bottom + 4,
  };
  for (const polyline of polylines) {
    for (let index = 1; index < polyline.length; index++) {
      const start = polyline[index - 1];
      const end = polyline[index];
      if (!start || !end) continue;
      if (segmentHitsBox(start, end, stroke)) hits += 1;
    }
  }
  return hits;
}

function labelBox(title: string, point: Point, interchange: boolean, at: LabelAt): Box {
  const width = Math.max(LABEL_CHAR_PX, title.length * LABEL_CHAR_PX);
  const gap = 13 + (interchange ? 3 : 0);
  let x = point[0];
  let anchor: "start" | "middle" | "end" = "middle";
  if (at === "e" || at === "ne" || at === "se") {
    x += gap;
    anchor = "start";
  } else if (at === "w" || at === "nw" || at === "sw") {
    x -= gap;
    anchor = "end";
  }
  let baseline = point[1] + 4;
  if (at === "n") baseline = point[1] - gap;
  else if (at === "ne" || at === "nw") baseline = point[1] - gap + 4;
  else if (at === "s") baseline = point[1] + gap + 9;
  else if (at === "se" || at === "sw") baseline = point[1] + gap + 4;
  const top = baseline - LABEL_SIZE_PX;
  const left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
  return { left, top, right: left + width, bottom: top + LABEL_SIZE_PX };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function segmentHitsBox(start: Point, end: Point, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const p = [-dx, dx, -dy, dy];
  const q = [start[0] - box.left, box.right - start[0], start[1] - box.top, box.bottom - start[1]];
  for (let side = 0; side < 4; side++) {
    const pi = p[side] ?? 0;
    const qi = q[side] ?? 0;
    if (pi === 0) {
      if (qi < 0) return false;
      continue;
    }
    const t = qi / pi;
    if (pi < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}
