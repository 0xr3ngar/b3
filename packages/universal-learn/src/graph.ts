export interface PlanConcept {
  readonly id: string;
  readonly title: string;
  readonly topicIds: readonly string[];
}

export interface PlanEdge {
  readonly from: string;
  readonly to: string;
}

export type RemovedEdgeReason =
  | "cycle"
  | "indegree"
  | "self_loop"
  | "duplicate"
  | "unknown_concept";

export interface RemovedEdge {
  readonly from: string;
  readonly to: string;
  readonly reason: RemovedEdgeReason;
}

export interface LearnPlan {
  readonly concepts: readonly PlanConcept[];
  readonly edges: readonly PlanEdge[];
}

export interface ValidatedPlan {
  readonly ok: boolean;
  readonly order: readonly string[];
  readonly removedEdges: readonly RemovedEdge[];
  readonly errors: readonly string[];
}

export function validatePlan(
  input: LearnPlan,
  opts?: { readonly maxIndegree?: number },
): ValidatedPlan {
  const maxIndegree = opts?.maxIndegree ?? 4;
  const errors: string[] = [];
  const concepts: PlanConcept[] = [];
  const seenConcepts = new Set<string>();
  for (const concept of input.concepts) {
    if (seenConcepts.has(concept.id)) {
      errors.push(`duplicate concept id: ${concept.id}`);
      continue;
    }
    seenConcepts.add(concept.id);
    concepts.push(concept);
  }

  const removedEdges: RemovedEdge[] = [];
  const kept: PlanEdge[] = [];
  const seenEdges = new Set<string>();
  const indegree = new Map<string, number>(concepts.map((concept) => [concept.id, 0]));
  const outgoing = new Map<string, string[]>(concepts.map((concept) => [concept.id, []]));

  for (const edge of input.edges) {
    if (!seenConcepts.has(edge.from) || !seenConcepts.has(edge.to)) {
      removedEdges.push({ from: edge.from, to: edge.to, reason: "unknown_concept" });
      continue;
    }
    if (edge.from === edge.to) {
      removedEdges.push({ from: edge.from, to: edge.to, reason: "self_loop" });
      continue;
    }
    const key = `${edge.from}\0${edge.to}`;
    if (seenEdges.has(key)) {
      removedEdges.push({ from: edge.from, to: edge.to, reason: "duplicate" });
      continue;
    }
    if ((indegree.get(edge.to) ?? 0) >= maxIndegree) {
      removedEdges.push({ from: edge.from, to: edge.to, reason: "indegree" });
      continue;
    }
    if (reaches(outgoing, edge.to, edge.from)) {
      removedEdges.push({ from: edge.from, to: edge.to, reason: "cycle" });
      continue;
    }
    seenEdges.add(key);
    kept.push(edge);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  return {
    ok: errors.length === 0,
    order: topoOrder(concepts, outgoing, indegree),
    removedEdges,
    errors,
  };
}

export function prerequisiteClosure(edges: readonly PlanEdge[], id: string): string[] {
  return walk(predecessors(edges), id, Number.POSITIVE_INFINITY);
}

export function unlocksWithin(edges: readonly PlanEdge[], id: string, depth: number): string[] {
  return walk(successors(edges), id, depth);
}

export function shortestUnlockPath(
  edges: readonly PlanEdge[],
  from: string,
  to: string,
): string[] | null {
  if (from === to) return [from];
  const next = successors(edges);
  const toward = new Map<string, string>();
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    for (const child of next.get(node) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      toward.set(child, node);
      if (child === to) return trace(toward, from, to);
      queue.push(child);
    }
  }
  return null;
}

export function routeTo(
  edges: readonly PlanEdge[],
  target: string,
  opts: { readonly here?: string; readonly solid: ReadonlySet<string> },
): string[] {
  if (opts.here !== undefined) {
    const viaHere = shortestUnlockPath(edges, opts.here, target);
    if (viaHere) return viaHere;
  }
  const incoming = predecessors(edges);
  const towardTarget = new Map<string, string>();
  const seen = new Set<string>([target]);
  const queue = [target];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    for (const parent of incoming.get(node) ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      towardTarget.set(parent, node);
      queue.push(parent);
      if (!opts.solid.has(parent)) continue;
      const path = [parent];
      let cursor = parent;
      while (cursor !== target) {
        const next = towardTarget.get(cursor);
        if (next === undefined) break;
        path.push(next);
        cursor = next;
      }
      return path;
    }
  }
  return [target];
}

function successors(edges: readonly PlanEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const list = map.get(edge.from);
    if (list) list.push(edge.to);
    else map.set(edge.from, [edge.to]);
  }
  return map;
}

function predecessors(edges: readonly PlanEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const list = map.get(edge.to);
    if (list) list.push(edge.from);
    else map.set(edge.to, [edge.from]);
  }
  return map;
}

function walk(map: Map<string, string[]>, id: string, depth: number): string[] {
  if (depth <= 0) return [];
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let frontier = [id];
  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const child of map.get(node) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        out.push(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return out;
}

function reaches(outgoing: Map<string, string[]>, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || seen.has(node)) continue;
    if (node === to) return true;
    seen.add(node);
    for (const child of outgoing.get(node) ?? []) stack.push(child);
  }
  return false;
}

function topoOrder(
  concepts: readonly PlanConcept[],
  outgoing: Map<string, string[]>,
  indegree: Map<string, number>,
): string[] {
  const index = new Map(concepts.map((concept, position) => [concept.id, position]));
  const ready = concepts
    .filter((concept) => (indegree.get(concept.id) ?? 0) === 0)
    .map((concept) => concept.id);
  const order: string[] = [];
  const remaining = new Map(indegree);
  while (ready.length > 0) {
    let best = 0;
    for (let position = 1; position < ready.length; position++) {
      const candidate = ready[position];
      const current = ready[best];
      if (candidate === undefined || current === undefined) continue;
      if ((index.get(candidate) ?? 0) < (index.get(current) ?? 0)) best = position;
    }
    const id = ready.splice(best, 1)[0];
    if (id === undefined) break;
    order.push(id);
    for (const child of outgoing.get(id) ?? []) {
      const next = (remaining.get(child) ?? 1) - 1;
      remaining.set(child, next);
      if (next === 0) ready.push(child);
    }
  }
  return order;
}

function trace(toward: Map<string, string>, from: string, to: string): string[] {
  const path = [to];
  let cursor = to;
  while (cursor !== from) {
    const parent = toward.get(cursor);
    if (parent === undefined) return [from, to];
    path.push(parent);
    cursor = parent;
  }
  path.reverse();
  return path;
}
