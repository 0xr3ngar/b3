import { prerequisiteClosure, unlocksWithin } from "./graph.ts";

export type StationState = "solid" | "learning" | "due" | "ready" | "locked" | "suggested";
export type LabelAt = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type SegmentKind = "track" | "planned" | "link";

/** Stations with no topic, other than suggestions, share this bottom line. */
export const OTHER_LINE_ID = "other";

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
  readonly note?: string;
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
  readonly here?: string;
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

interface Cell {
  readonly col: number;
  readonly row: number;
}

interface EdgeEnds {
  readonly from: string;
  readonly to: string;
}

// Square grid so a one-row spur meets the trunk on a 45° diagonal.
const DX = 120;
const DY = 92;
const MARGIN = 48;
const LABEL_CHAR_PX = 7.2;
const LABEL_SIZE_PX = 12.5;
const STUB_GAP = 40;
const LABEL_ORDER: readonly LabelAt[] = ["s", "n", "e", "w", "se", "ne", "sw", "nw"];
const LABEL_HIT = 1_000_000;

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
  const byId = new Map(stations.map((station) => [station.id, station]));
  const edges = dedupeEdges(input.edges);

  const local = new Map<string, Map<string, Cell>>();
  const trunks = new Map<string, readonly string[]>();
  for (const line of lines) {
    const onLine = stations
      .filter((station) => (knownLines.get(station.id) ?? []).includes(line.id))
      .map((station) => station.id);
    const hosted = onLine.filter((id) => primary.get(id) === line.id);
    const laid = layoutLine(hosted, onLine, edges, index);
    local.set(line.id, laid.cells);
    trunks.set(line.id, laid.trunk);
  }

  const ordered = orderLines(lines, edges, primary);
  const shift = new Map<string, number>();
  let cursor = 0;
  for (const line of ordered) {
    const cells = local.get(line.id);
    if (!cells || cells.size === 0) {
      shift.set(line.id, cursor);
      continue;
    }
    let minRow = Number.POSITIVE_INFINITY;
    let maxRow = Number.NEGATIVE_INFINITY;
    for (const cell of cells.values()) {
      if (cell.row < minRow) minRow = cell.row;
      if (cell.row > maxRow) maxRow = cell.row;
    }
    const delta = cursor - minRow;
    shift.set(line.id, delta);
    cursor = maxRow + delta + 2;
  }

  const grid = new Map<string, Cell>();
  for (const line of lines) {
    const delta = shift.get(line.id) ?? 0;
    for (const [id, cell] of local.get(line.id) ?? []) {
      grid.set(id, { col: cell.col, row: cell.row + delta });
    }
  }

  const occupied = new Set<string>();
  let maxCol = 0;
  for (const cell of grid.values()) {
    occupied.add(cellKey(cell));
    if (cell.col > maxCol) maxCol = cell.col;
  }

  const orphans = stations
    .filter((station) => primary.get(station.id) === null && station.state !== "suggested")
    .map((station) => station.id);
  const orphanGraph = graph(orphans, edges);
  const orphanOrder = topoSort(orphans, orphanGraph.preds, orphanGraph.succs, index);
  orphanOrder.forEach((id, col) => {
    const cell = { col, row: cursor };
    grid.set(id, cell);
    occupied.add(cellKey(cell));
    if (col > maxCol) maxCol = col;
  });

  const clusterRow = cursor;
  let clusterCol = maxCol + 2;
  for (const station of stations) {
    if (grid.has(station.id) || station.state !== "suggested") continue;
    const near = predecessorCell(station.id, edges, grid);
    if (near) {
      const cell = freeNeighbor(near, occupied);
      grid.set(station.id, cell);
      occupied.add(cellKey(cell));
      continue;
    }
    const cell = { col: clusterCol, row: clusterRow };
    clusterCol += 1;
    grid.set(station.id, cell);
    occupied.add(cellKey(cell));
  }

  for (const station of stations) {
    if (grid.has(station.id)) continue;
    const cell = freeNeighbor({ col: maxCol + 2, row: clusterRow }, occupied);
    grid.set(station.id, cell);
    occupied.add(cellKey(cell));
  }

  const raw = new Map<string, Point>();
  for (const [id, cell] of grid) raw.set(id, [cell.col * DX, cell.row * DY]);
  for (const station of stations) {
    if (raw.has(station.id)) continue;
    raw.set(station.id, nearestFree([DX, DY], raw));
  }

  const draft = realize(raw, true);
  const anchors = input.anchors ?? {};
  if (Object.keys(anchors).length === 0) return draft;

  const natural = new Map<string, Point>(
    draft.stations.map((station) => [station.id, [station.x, station.y]]),
  );
  const anchored = new Map<string, Point>();
  for (const station of stations) {
    const anchor = anchors[station.id];
    if (!anchor) continue;
    anchored.set(station.id, [anchor.x, anchor.y]);
  }
  for (const station of stations) {
    if (anchored.has(station.id)) continue;
    const slot = natural.get(station.id);
    if (!slot) continue;
    anchored.set(station.id, nearestFree(slot, anchored));
  }
  return realize(anchored, false);

  function realize(placed: Map<string, Point>, applyShift: boolean): TransitLayout {
    const pointOf = (id: string): Point => placed.get(id) ?? [DX, DY];
    const segments: LaidSegment[] = [];
    const routed = new Map<string, Point[][]>();
    const pending: { edge: TransitEdge; lineId: string | null; straight: boolean }[] = [];
    for (const edge of edges) {
      if (!placed.has(edge.from) || !placed.has(edge.to) || edge.from === edge.to) continue;
      const fromLines = knownLines.get(edge.from) ?? [];
      const toLines = knownLines.get(edge.to) ?? [];
      const shared = fromLines.find((id) => toLines.includes(id)) ?? null;
      const lineId =
        shared ??
        (orphanOrder.includes(edge.from) && orphanOrder.includes(edge.to) ? OTHER_LINE_ID : null);
      pending.push({
        edge,
        lineId,
        straight: isOctilinearSegment(pointOf(edge.from), pointOf(edge.to)),
      });
    }
    pending.sort((a, b) => Number(b.straight) - Number(a.straight));
    for (const item of pending) {
      const from = pointOf(item.edge.from);
      const to = pointOf(item.edge.to);
      const avoid = item.lineId === null ? [] : (routed.get(item.lineId) ?? []);
      const points = routePoints(from, to, avoid, placed, item.edge.from, item.edge.to);
      if (item.lineId !== null) {
        const list = routed.get(item.lineId) ?? [];
        list.push(points);
        routed.set(item.lineId, list);
      }
      const kind: SegmentKind =
        item.edge.planned === true ? "planned" : item.lineId === null ? "link" : "track";
      segments.push({
        from: item.edge.from,
        to: item.edge.to,
        lineId: item.lineId,
        points,
        kind,
      });
    }

    const linked = new Set(edges.map((edge) => `${edge.from}\0${edge.to}`));
    for (let position = 1; position < orphanOrder.length; position++) {
      const from = orphanOrder[position - 1];
      const to = orphanOrder[position];
      if (!from || !to) continue;
      if (linked.has(`${from}\0${to}`) || linked.has(`${to}\0${from}`)) continue;
      const points: Point[] = [pointOf(from), pointOf(to)];
      segments.push({ from, to, lineId: OTHER_LINE_ID, points, kind: "track" });
    }

    const bullets: TransitLayout["bullets"][number][] = [];
    const stubs: TransitLayout["stubs"][number][] = [];
    const bulletLines: { id: string; title: string; pool: readonly string[] }[] = ordered.map(
      (line) => ({
        id: line.id,
        title: line.title,
        pool: poolFor(line.id, trunks.get(line.id) ?? [], stations, knownLines, primary),
      }),
    );
    if (orphanOrder.length > 0) {
      bulletLines.push({ id: OTHER_LINE_ID, title: "Other", pool: orphanOrder });
    }
    for (const line of bulletLines) {
      const target = leftmost(line.pool, placed, index);
      if (!target) continue;
      const at = placed.get(target);
      if (!at) continue;
      let minX = at[0];
      for (const id of line.pool) {
        const point = placed.get(id);
        if (point && point[0] < minX) minX = point[0];
      }
      const width = Math.round(line.title.length * LABEL_CHAR_PX + 16);
      const x = minX - STUB_GAP - width;
      bullets.push({ lineId: line.id, x, y: at[1], width });
      stubs.push({
        lineId: line.id,
        points: [
          [x + width, at[1]],
          [at[0], at[1]],
        ],
      });
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
    if (input.here) {
      const here = placed.get(input.here);
      if (here) obstacles.push(pinBox(here));
    }
    const labelAt = new Map<string, LabelAt>();
    const labelBoxes = new Map<string, Box>();
    const labelOrder = stations
      .map((station) => station.id)
      .sort((a, b) => {
        const pa = pointOf(a);
        const pb = pointOf(b);
        return pa[1] - pb[1] || pa[0] - pb[0] || (index.get(a) ?? 0) - (index.get(b) ?? 0);
      });
    for (const id of labelOrder) {
      const station = byId.get(id);
      if (!station) continue;
      const point = pointOf(id);
      const interchange = (knownLines.get(id)?.length ?? 0) >= 2;
      const chosen = chooseLabel(
        station.title,
        point,
        interchange,
        transitSubtitle(station, input.here),
        obstacles,
        polylines,
        placed,
        id,
      );
      labelAt.set(id, chosen.at);
      labelBoxes.set(id, chosen.box);
      obstacles.push(chosen.box);
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = 0;
    let maxY = 0;
    const include = (x: number, y: number) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    for (const point of placed.values()) include(point[0], point[1]);
    for (const segment of segments) {
      for (const point of segment.points) include(point[0], point[1]);
    }
    for (const stub of stubs) {
      for (const point of stub.points) include(point[0], point[1]);
    }
    for (const bullet of bullets) {
      include(bullet.x, bullet.y - 9);
      include(bullet.x + bullet.width, bullet.y + 9);
    }
    for (const box of labelBoxes.values()) {
      include(box.left, box.top);
      include(box.right, box.bottom);
    }
    if (input.here) {
      const here = placed.get(input.here);
      if (here) {
        const pin = pinBox(here);
        include(pin.left, pin.top);
        include(pin.right, pin.bottom);
      }
    }
    if (!Number.isFinite(minX)) minX = 0;
    if (!Number.isFinite(minY)) minY = 0;
    const dx = applyShift ? MARGIN - minX : 0;
    const dy = applyShift ? MARGIN - minY : 0;
    const move = (point: Point): Point => [point[0] + dx, point[1] + dy];

    const laidStations: LaidStation[] = stations.map((station) => {
      const point = move(pointOf(station.id));
      const hosted = primary.get(station.id);
      return {
        id: station.id,
        x: point[0],
        y: point[1],
        lineId: hosted ?? (orphanOrder.includes(station.id) ? OTHER_LINE_ID : null),
        lineIds: station.lineIds,
        interchange: (knownLines.get(station.id)?.length ?? 0) >= 2,
        labelAt: labelAt.get(station.id) ?? "s",
      };
    });

    return {
      width: maxX + dx + MARGIN,
      height: maxY + dy + MARGIN,
      stations: laidStations,
      segments: segments.map((segment) => ({
        ...segment,
        points: segment.points.map((point) => move([point[0], point[1]])),
      })),
      stubs: stubs.map((stub) => ({
        ...stub,
        points: stub.points.map((point) => move([point[0], point[1]])),
      })),
      bullets: bullets.map((bullet) => ({ ...bullet, x: bullet.x + dx, y: bullet.y + dy })),
    };
  }
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

export function transitSubtitle(
  station: Pick<TransitStationInput, "id" | "state" | "recall" | "note">,
  here?: string,
): string | undefined {
  if (station.state === "suggested") return "From Chat";
  if (station.state === "ready" && station.note && station.note.length <= 32) return station.note;
  if (here && station.id === here && station.recall !== undefined) {
    return `${Math.round(station.recall * 100)}% recall`;
  }
  return undefined;
}

export function transitLabelBox(
  title: string,
  x: number,
  y: number,
  at: LabelAt,
  interchange: boolean,
  subtitle?: string,
): Box {
  return labelBox(title, [x, y], interchange, at, subtitle);
}

function layoutLine(
  hosted: readonly string[],
  onLine: readonly string[],
  edges: readonly TransitEdge[],
  index: Map<string, number>,
): { cells: Map<string, Cell>; trunk: string[] } {
  const full = graph(onLine, edges);
  const path = longestPath(onLine, full.preds, full.succs, index);
  const hostedSet = new Set(hosted);
  const trunk = path.filter((id) => hostedSet.has(id));
  const cells = new Map<string, Cell>();
  trunk.forEach((id, col) => cells.set(id, { col, row: 0 }));

  const hostedGraph = graph(hosted, edges);
  const remaining = hosted.filter((id) => !cells.has(id));
  const branches = components(remaining, hostedGraph.preds, hostedGraph.succs, index);
  branches.sort((a, b) => {
    const bySize = b.length - a.length;
    if (bySize !== 0) return bySize;
    const byCol = attachmentCol(a, cells, hostedGraph) - attachmentCol(b, cells, hostedGraph);
    if (byCol !== 0) return byCol;
    return (index.get(a[0] ?? "") ?? 0) - (index.get(b[0] ?? "") ?? 0);
  });

  const occupied = new Set<string>();
  for (const cell of cells.values()) occupied.add(cellKey(cell));
  const committed: Point[][] = [];
  for (let position = 0; position < trunk.length - 1; position++) {
    const from = trunk[position];
    const to = trunk[position + 1];
    if (!from || !to) continue;
    if (!(hostedGraph.succs.get(from) ?? []).includes(to)) continue;
    const start = cells.get(from);
    const end = cells.get(to);
    if (!start || !end) continue;
    committed.push([
      [start.col, start.row],
      [end.col, end.row],
    ]);
  }

  for (const branch of branches) {
    const placed = placeBranch(branch, cells, occupied, committed, hostedGraph);
    for (const [id, cell] of placed) {
      cells.set(id, cell);
      occupied.add(cellKey(cell));
    }
  }
  return { cells, trunk };
}

function placeBranch(
  branch: readonly string[],
  trunkCells: Map<string, Cell>,
  occupied: Set<string>,
  committed: Point[][],
  hostedGraph: { preds: Map<string, string[]>; succs: Map<string, string[]> },
): Map<string, Cell> {
  const unattached = branchAttachments(branch, trunkCells, hostedGraph).length === 0;
  if (unattached) {
    const start = maxCol(trunkCells) + 2;
    const cols = branch.map((_, offset) => start + offset);
    if (cols.every((col) => !occupied.has(`${col}:0`))) {
      const assignment = new Map<string, Cell>();
      branch.forEach((id, offset) => assignment.set(id, { col: start + offset, row: 0 }));
      const routes = branchRoutes(branch, assignment, trunkCells, hostedGraph, committed);
      if (routes) {
        for (const route of routes) committed.push(route);
        return assignment;
      }
    }
  }

  for (let distance = 1; distance <= 8; distance++) {
    for (const side of [1, -1] as const) {
      const row = side * distance;
      for (const cols of columnChoices(branch, trunkCells, hostedGraph)) {
        if (cols.some((col) => occupied.has(`${col}:${row}`))) continue;
        const assignment = new Map<string, Cell>();
        branch.forEach((id, offset) => {
          const col = cols[offset];
          if (col !== undefined) assignment.set(id, { col, row });
        });
        const routes = branchRoutes(branch, assignment, trunkCells, hostedGraph, committed);
        if (!routes) continue;
        for (const route of routes) committed.push(route);
        return assignment;
      }
    }
  }

  const start = maxOccupied(occupied) + 2;
  const assignment = new Map<string, Cell>();
  branch.forEach((id, offset) => assignment.set(id, { col: start + offset, row: 1 }));
  const routes = branchRoutes(branch, assignment, trunkCells, hostedGraph, committed);
  if (routes) for (const route of routes) committed.push(route);
  return assignment;
}

function columnChoices(
  branch: readonly string[],
  trunkCells: Map<string, Cell>,
  hostedGraph: { preds: Map<string, string[]>; succs: Map<string, string[]> },
): number[][] {
  const trunkSet = new Set(trunkCells.keys());
  const leaves: number[] = [];
  const joins: number[] = [];
  for (const id of branch) {
    for (const parent of hostedGraph.preds.get(id) ?? []) {
      if (!trunkSet.has(parent)) continue;
      const col = trunkCells.get(parent)?.col;
      if (col !== undefined) leaves.push(col);
    }
    for (const child of hostedGraph.succs.get(id) ?? []) {
      if (!trunkSet.has(child)) continue;
      const col = trunkCells.get(child)?.col;
      if (col !== undefined) joins.push(col);
    }
  }
  if (branch.length === 1) {
    const cols: number[] = [];
    for (const col of leaves) cols.push(col + 1, col + 2, col - 1);
    for (const col of joins) cols.push(col - 1, col + 1, col - 2, col + 2);
    if (cols.length === 0) cols.push(0, 1, -1, 2, -2);
    const base = cols[0] ?? 0;
    for (let distance = 3; distance <= 6; distance++) cols.push(base + distance, base - distance);
    return dedupe(cols).map((col) => [col]);
  }

  const leave = leaves.length > 0 ? Math.min(...leaves) : null;
  const join = joins.length > 0 ? Math.max(...joins) : null;
  const count = branch.length;
  const choices: number[][] = [];
  const push = (cols: number[]) => {
    if (cols.length === count && new Set(cols).size === count) choices.push(cols);
  };
  if (leave !== null && join !== null && join > leave) {
    if (join - leave - 1 >= count) {
      const cols: number[] = [leave + 1];
      for (let offset = 1; offset < count - 1; offset++) {
        const span = join - 1 - (leave + 1);
        cols.push(leave + 1 + Math.round((offset * span) / (count - 1)));
      }
      cols.push(join - 1);
      push(cols);
    }
    push(Array.from({ length: count }, (_, offset) => leave + 1 + offset));
    push(Array.from({ length: count }, (_, offset) => join - count + offset));
  } else if (leave !== null) {
    push(Array.from({ length: count }, (_, offset) => leave + 1 + offset));
  } else if (join !== null) {
    push(Array.from({ length: count }, (_, offset) => join - count + offset));
  } else {
    push(Array.from({ length: count }, (_, offset) => offset));
  }
  const seen = new Set<string>();
  return choices.filter((cols) => {
    const key = cols.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function branchRoutes(
  branch: readonly string[],
  assignment: Map<string, Cell>,
  trunkCells: Map<string, Cell>,
  hostedGraph: { preds: Map<string, string[]>; succs: Map<string, string[]> },
  committed: readonly Point[][],
): Point[][] | null {
  const members = new Set(branch);
  const at = (id: string): Point | undefined => {
    const cell = assignment.get(id) ?? trunkCells.get(id);
    return cell ? [cell.col, cell.row] : undefined;
  };
  const stations: Point[] = [];
  for (const cell of assignment.values()) stations.push([cell.col, cell.row]);
  for (const cell of trunkCells.values()) stations.push([cell.col, cell.row]);
  const wanted: EdgeEnds[] = [];
  const seen = new Set<string>();
  const add = (from: string, to: string) => {
    const key = `${from}\0${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    wanted.push({ from, to });
  };
  for (const id of branch) {
    for (const child of hostedGraph.succs.get(id) ?? []) {
      if (members.has(child) || trunkCells.has(child)) add(id, child);
    }
    for (const parent of hostedGraph.preds.get(id) ?? []) {
      if (trunkCells.has(parent)) add(parent, id);
    }
  }
  const built: Point[][] = [];
  for (const edge of wanted) {
    const from = at(edge.from);
    const to = at(edge.to);
    if (!from || !to) return null;
    const options = pathVariants(from, to);
    let picked: Point[] | undefined;
    for (const option of options) {
      if (routeBlocked(option, [...committed, ...built], stations)) continue;
      picked = option;
      break;
    }
    if (!picked) return null;
    built.push(picked);
  }
  return built;
}

function branchAttachments(
  branch: readonly string[],
  trunkCells: Map<string, Cell>,
  hostedGraph: { preds: Map<string, string[]>; succs: Map<string, string[]> },
): number[] {
  const cols: number[] = [];
  for (const id of branch) {
    for (const parent of hostedGraph.preds.get(id) ?? []) {
      const col = trunkCells.get(parent)?.col;
      if (col !== undefined) cols.push(col);
    }
    for (const child of hostedGraph.succs.get(id) ?? []) {
      const col = trunkCells.get(child)?.col;
      if (col !== undefined) cols.push(col);
    }
  }
  return cols;
}

function attachmentCol(
  branch: readonly string[],
  trunkCells: Map<string, Cell>,
  hostedGraph: { preds: Map<string, string[]>; succs: Map<string, string[]> },
): number {
  const cols = branchAttachments(branch, trunkCells, hostedGraph);
  if (cols.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...cols);
}

function longestPath(
  ids: readonly string[],
  preds: Map<string, string[]>,
  succs: Map<string, string[]>,
  index: Map<string, number>,
): string[] {
  if (ids.length === 0) return [];
  const topo = topoSort(ids, preds, succs, index);
  const best = new Map<string, string[]>();
  for (const id of topo) {
    let chosen = [id];
    for (const parent of preds.get(id) ?? []) {
      const base = best.get(parent);
      if (!base || base.includes(id)) continue;
      const candidate = [...base, id];
      if (betterPath(candidate, chosen, index)) chosen = candidate;
    }
    best.set(id, chosen);
  }
  let winner: string[] = [];
  for (const id of topo) {
    const path = best.get(id) ?? [id];
    if (winner.length === 0 || betterPath(path, winner, index)) winner = path;
  }
  return winner;
}

function betterPath(
  candidate: readonly string[],
  current: readonly string[],
  index: Map<string, number>,
): boolean {
  if (candidate.length !== current.length) return candidate.length > current.length;
  for (let position = 0; position < candidate.length; position++) {
    const delta =
      (index.get(candidate[position] ?? "") ?? 0) - (index.get(current[position] ?? "") ?? 0);
    if (delta !== 0) return delta < 0;
  }
  return false;
}

function topoSort(
  ids: readonly string[],
  preds: Map<string, string[]>,
  succs: Map<string, string[]>,
  index: Map<string, number>,
): string[] {
  const members = new Set(ids);
  const indegree = new Map(
    ids.map((id) => [id, (preds.get(id) ?? []).filter((parent) => members.has(parent)).length]),
  );
  const ready = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const ordered: string[] = [];
  const seen = new Set<string>();
  while (ready.length > 0) {
    const id = takeEarliest(ready, index);
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
    for (const child of succs.get(id) ?? []) {
      if (!members.has(child)) continue;
      const next = (indegree.get(child) ?? 1) - 1;
      indegree.set(child, next);
      if (next === 0) ready.push(child);
    }
  }
  const rest = [...ids].sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
  for (const id of rest) if (!seen.has(id)) ordered.push(id);
  return ordered;
}

function components(
  ids: readonly string[],
  preds: Map<string, string[]>,
  succs: Map<string, string[]>,
  index: Map<string, number>,
): string[][] {
  const members = new Set(ids);
  const seen = new Set<string>();
  const out: string[][] = [];
  const starts = [...ids].sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
  for (const start of starts) {
    if (seen.has(start)) continue;
    const found: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id) continue;
      found.push(id);
      for (const next of [...(preds.get(id) ?? []), ...(succs.get(id) ?? [])]) {
        if (!members.has(next) || seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    out.push(topoSort(found, preds, succs, index));
  }
  return out;
}

function graph(
  ids: readonly string[],
  edges: readonly EdgeEnds[],
): { preds: Map<string, string[]>; succs: Map<string, string[]> } {
  const members = new Set(ids);
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) {
    if (!members.has(edge.from) || !members.has(edge.to) || edge.from === edge.to) continue;
    const children = succs.get(edge.from);
    const parents = preds.get(edge.to);
    if (!children || !parents || children.includes(edge.to)) continue;
    children.push(edge.to);
    parents.push(edge.from);
  }
  return { preds, succs };
}

function orderLines(
  lines: readonly TransitLine[],
  edges: readonly TransitEdge[],
  primary: Map<string, string | null>,
): TransitLine[] {
  const weight = new Map<string, number>();
  const pair = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);
  for (const edge of edges) {
    const from = primary.get(edge.from);
    const to = primary.get(edge.to);
    if (!from || !to || from === to) continue;
    const key = pair(from, to);
    weight.set(key, (weight.get(key) ?? 0) + 1);
  }
  if (weight.size === 0) return [...lines];
  const index = new Map(lines.map((line, position) => [line.id, position]));
  const remaining = new Set(lines.map((line) => line.id));
  let seedA = lines[0]?.id ?? "";
  let seedB = seedA;
  let seedWeight = -1;
  for (const [key, value] of weight) {
    const [a, b] = key.split("\0");
    if (!a || !b) continue;
    const earlier = (index.get(a) ?? 0) <= (index.get(b) ?? 0) ? a : b;
    if (
      value > seedWeight ||
      (value === seedWeight && (index.get(earlier) ?? 0) < (index.get(seedA) ?? 0))
    ) {
      seedWeight = value;
      seedA = earlier;
      seedB = earlier === a ? b : a;
    }
  }
  const ordered = [seedA];
  remaining.delete(seedA);
  if (remaining.has(seedB)) {
    ordered.push(seedB);
    remaining.delete(seedB);
  }
  while (remaining.size > 0) {
    const last = ordered[ordered.length - 1] ?? seedA;
    let pick = "";
    let pickWeight = -1;
    let pickIndex = Number.POSITIVE_INFINITY;
    for (const id of remaining) {
      let linked = 0;
      for (const have of ordered) linked += weight.get(pair(id, have)) ?? 0;
      const adjacent = weight.get(pair(id, last)) ?? 0;
      const at = index.get(id) ?? 0;
      if (
        adjacent > pickWeight ||
        (adjacent === pickWeight && linked > pickWeight && at < pickIndex) ||
        (adjacent === pickWeight && at < pickIndex)
      ) {
        pick = id;
        pickWeight = adjacent;
        pickIndex = at;
      }
    }
    if (!pick) break;
    ordered.push(pick);
    remaining.delete(pick);
  }
  return ordered.flatMap((id) => {
    const line = lines.find((item) => item.id === id);
    return line ? [line] : [];
  });
}

function predecessorCell(
  id: string,
  edges: readonly TransitEdge[],
  grid: Map<string, Cell>,
): Cell | undefined {
  for (const edge of edges) {
    if (edge.to !== id) continue;
    const cell = grid.get(edge.from);
    if (cell) return cell;
  }
  return undefined;
}

function freeNeighbor(near: Cell, occupied: Set<string>): Cell {
  const options: Cell[] = [];
  for (let distance = 1; distance <= 6; distance++) {
    options.push(
      { col: near.col + distance, row: near.row + distance },
      { col: near.col + distance, row: near.row - distance },
      { col: near.col - distance, row: near.row + distance },
      { col: near.col - distance, row: near.row - distance },
      { col: near.col + distance, row: near.row },
      { col: near.col, row: near.row + distance },
    );
  }
  for (const cell of options) {
    if (!occupied.has(cellKey(cell))) return cell;
  }
  return { col: near.col + 2, row: near.row + 2 };
}

function poolFor(
  lineId: string,
  trunk: readonly string[],
  stations: readonly TransitStationInput[],
  knownLines: Map<string, readonly string[]>,
  primary: Map<string, string | null>,
): string[] {
  if (trunk.length > 0) return [...trunk];
  return stations
    .filter(
      (station) =>
        primary.get(station.id) === lineId || (knownLines.get(station.id) ?? []).includes(lineId),
    )
    .map((station) => station.id);
}

function leftmost(
  ids: readonly string[],
  placed: Map<string, Point>,
  index: Map<string, number>,
): string | undefined {
  let best: string | undefined;
  for (const id of ids) {
    const point = placed.get(id);
    if (!point) continue;
    if (!best) {
      best = id;
      continue;
    }
    const current = placed.get(best);
    if (!current) continue;
    const dx = point[0] - current[0];
    const dy = point[1] - current[1];
    if (
      dx < -1e-6 ||
      (Math.abs(dx) <= 1e-6 && dy < -1e-6) ||
      (Math.abs(dx) <= 1e-6 &&
        Math.abs(dy) <= 1e-6 &&
        (index.get(id) ?? 0) < (index.get(best) ?? 0))
    ) {
      best = id;
    }
  }
  return best;
}

function routePoints(
  from: Point,
  to: Point,
  avoid: readonly Point[][],
  placed: Map<string, Point>,
  fromId: string,
  toId: string,
): Point[] {
  let best = pathVariants(from, to)[0] ?? [from, to];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const option of pathVariants(from, to)) {
    let score = 0;
    for (const prior of avoid) if (polylinesCross(option, prior)) score += 1;
    for (const [id, point] of placed) {
      if (id === fromId || id === toId) continue;
      if (polylineHitsPoint(option, point, 18)) score += 5;
    }
    if (score < bestScore) {
      best = option;
      bestScore = score;
    }
    if (score === 0) break;
  }
  return best;
}

function pathVariants(from: Point, to: Point): Point[][] {
  if (isOctilinearSegment(from, to)) return [[from, to]];
  return [octiline(from, to), ortholine(from, to)];
}

function isOctilinearSegment(from: Point, to: Point): boolean {
  const dx = Math.abs(to[0] - from[0]);
  const dy = Math.abs(to[1] - from[1]);
  if (dx < 1e-6 && dy < 1e-6) return false;
  if (dx < 1e-6 || dy < 1e-6) return true;
  return Math.abs(dx - dy) < 1e-6;
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

function ortholine(from: Point, to: Point): Point[] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < 1e-9 || ady < 1e-9 || Math.abs(adx - ady) < 1e-9) return [from, to];
  if (adx > ady) {
    const mid: Point = [from[0] + Math.sign(dx) * (adx - ady), from[1]];
    return [from, mid, to];
  }
  const mid: Point = [from[0], from[1] + Math.sign(dy) * (ady - adx)];
  return [from, mid, to];
}

function routeBlocked(
  route: readonly Point[],
  prior: readonly Point[][],
  stations: readonly Point[],
): boolean {
  for (const other of prior) if (polylinesCross(route, other)) return true;
  const start = route[0];
  const end = route[route.length - 1];
  for (const station of stations) {
    if (!start || !end) continue;
    if (samePoint(station, start) || samePoint(station, end)) continue;
    if (polylineHitsPoint(route, station, 0.22)) return true;
  }
  return false;
}

function polylinesCross(a: readonly Point[], b: readonly Point[]): boolean {
  for (let i = 1; i < a.length; i++) {
    const a0 = a[i - 1];
    const a1 = a[i];
    if (!a0 || !a1) continue;
    for (let j = 1; j < b.length; j++) {
      const b0 = b[j - 1];
      const b1 = b[j];
      if (!b0 || !b1) continue;
      if (properCross(a0, a1, b0, b1) || collinearOverlap(a0, a1, b0, b1)) return true;
    }
  }
  return false;
}

function properCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]);
  const d2 = cross(b[0] - a[0], b[1] - a[1], d[0] - a[0], d[1] - a[1]);
  const d3 = cross(d[0] - c[0], d[1] - c[1], a[0] - c[0], a[1] - c[1]);
  const d4 = cross(d[0] - c[0], d[1] - c[1], b[0] - c[0], b[1] - c[1]);
  if (Math.abs(d1) < 1e-9 || Math.abs(d2) < 1e-9 || Math.abs(d3) < 1e-9 || Math.abs(d4) < 1e-9) {
    return false;
  }
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function collinearOverlap(a: Point, b: Point, c: Point, d: Point): boolean {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  if (Math.abs(abx * (c[1] - a[1]) - aby * (c[0] - a[0])) > 1e-6) return false;
  if (Math.abs(abx * (d[1] - a[1]) - aby * (d[0] - a[0])) > 1e-6) return false;
  const useX = Math.abs(abx) >= Math.abs(aby);
  const project = (point: Point) => (useX ? point[0] : point[1]);
  let a0 = project(a);
  let a1 = project(b);
  let b0 = project(c);
  let b1 = project(d);
  if (a0 > a1) {
    const swap = a0;
    a0 = a1;
    a1 = swap;
  }
  if (b0 > b1) {
    const swap = b0;
    b0 = b1;
    b1 = swap;
  }
  return Math.min(a1, b1) - Math.max(a0, b0) > 1e-6;
}

function polylineHitsPoint(route: readonly Point[], point: Point, radius: number): boolean {
  for (let index = 1; index < route.length; index++) {
    const start = route[index - 1];
    const end = route[index];
    if (!start || !end) continue;
    if (distanceToSegment(point, start, end) < radius) return true;
  }
  return false;
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = dx * dx + dy * dy;
  if (length < 1e-12) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length),
  );
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

function nearestFree(ideal: Point, placed: Map<string, Point>): Point {
  const occupied = [...placed.values()];
  if (!occupied.some((other) => tooClose(ideal, other))) return ideal;
  for (let radius = 1; radius < 64; radius++) {
    let best: { point: Point; distance: number; col: number; row: number } | null = null;
    for (let colOffset = -radius; colOffset <= radius; colOffset++) {
      for (let rowOffset = -radius; rowOffset <= radius; rowOffset++) {
        if (Math.max(Math.abs(colOffset), Math.abs(rowOffset)) !== radius) continue;
        const point: Point = [ideal[0] + colOffset * DX, ideal[1] + rowOffset * DY];
        if (occupied.some((other) => tooClose(point, other))) continue;
        const distance = Math.hypot(colOffset * DX, rowOffset * DY);
        if (
          !best ||
          distance < best.distance - 1e-6 ||
          (Math.abs(distance - best.distance) <= 1e-6 &&
            (colOffset < best.col || (colOffset === best.col && rowOffset < best.row)))
        ) {
          best = { point, distance, col: colOffset, row: rowOffset };
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

function chooseLabel(
  title: string,
  point: Point,
  interchange: boolean,
  subtitle: string | undefined,
  obstacles: readonly Box[],
  polylines: readonly Point[][],
  placed: Map<string, Point>,
  selfId: string,
): { at: LabelAt; box: Box } {
  let chosen: LabelAt = "s";
  let chosenBox = labelBox(title, point, interchange, "s", subtitle);
  let chosenCost = Number.POSITIVE_INFINITY;
  for (const at of LABEL_ORDER) {
    const box = labelBox(title, point, interchange, at, subtitle);
    const cost = labelCost(box, obstacles, polylines, placed, selfId, interchange);
    if (cost < chosenCost) {
      chosen = at;
      chosenBox = box;
      chosenCost = cost;
    }
    if (cost === 0) break;
  }
  return { at: chosen, box: chosenBox };
}

function labelCost(
  box: Box,
  obstacles: readonly Box[],
  polylines: readonly Point[][],
  placed: Map<string, Point>,
  selfId: string,
  interchange: boolean,
): number {
  const padded = {
    left: box.left - 2,
    top: box.top - 2,
    right: box.right + 2,
    bottom: box.bottom + 2,
  };
  let cost = 0;
  for (const obstacle of obstacles) if (boxesOverlap(padded, obstacle)) cost += LABEL_HIT;
  const radius = interchange ? 16 : 10;
  for (const [id, point] of placed) {
    if (id === selfId) continue;
    if (
      boxesOverlap(padded, {
        left: point[0] - radius,
        top: point[1] - radius,
        right: point[0] + radius,
        bottom: point[1] + radius,
      })
    ) {
      cost += LABEL_HIT;
    }
  }
  const stroke = {
    left: box.left - 3,
    top: box.top - 3,
    right: box.right + 3,
    bottom: box.bottom + 3,
  };
  for (const polyline of polylines) {
    for (let index = 1; index < polyline.length; index++) {
      const start = polyline[index - 1];
      const end = polyline[index];
      if (!start || !end) continue;
      if (segmentHitsBox(start, end, stroke)) cost += 1;
    }
  }
  return cost;
}

function labelBox(
  title: string,
  point: Point,
  interchange: boolean,
  at: LabelAt,
  subtitle?: string,
): Box {
  const titleWidth = Math.max(LABEL_CHAR_PX, title.length * LABEL_CHAR_PX);
  const subtitleWidth = subtitle ? Math.max(LABEL_CHAR_PX, subtitle.length * LABEL_CHAR_PX) : 0;
  const width = Math.max(titleWidth, subtitleWidth);
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
  const extra = subtitle ? 14 : 0;
  return { left, top, right: left + width, bottom: top + LABEL_SIZE_PX + extra };
}

function pinBox(point: Point): Box {
  const width = 78;
  const height = 19;
  const left = point[0] - width / 2;
  const top = point[1] - height - 17;
  return { left, top, right: left + width, bottom: point[1] - 8 };
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

function dedupeEdges(edges: readonly TransitEdge[]): TransitEdge[] {
  const seen = new Set<string>();
  const out: TransitEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}\0${edge.planned === true}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

function dedupe(values: readonly number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function cellKey(cell: Cell): string {
  return `${cell.col}:${cell.row}`;
}

function maxCol(cells: Map<string, Cell>): number {
  let max = 0;
  for (const cell of cells.values()) if (cell.col > max) max = cell.col;
  return max;
}

function maxOccupied(occupied: Set<string>): number {
  let max = 0;
  for (const key of occupied) {
    const col = Number(key.split(":")[0]);
    if (col > max) max = col;
  }
  return max;
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
