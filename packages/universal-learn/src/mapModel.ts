import { routeTo } from "./graph.ts";
import {
  layoutTransit,
  type StationState,
  type TransitInput,
  type TransitLayout,
} from "./transit.ts";

export interface TransitMapSource {
  readonly lines: readonly { readonly id: string; readonly title: string }[];
  readonly stations: readonly {
    readonly id: string;
    readonly title: string;
    readonly lineIds: readonly string[];
    readonly state: StationState;
    readonly recall: number | null;
    readonly misconception: string | null;
    readonly note: string | null;
  }[];
  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
    readonly planned?: boolean;
  }[];
  readonly anchors: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  readonly here: string | null;
}

const layouts = new WeakMap<object, TransitLayout>();

/** Geometry is pure in the map object, so a new server snapshot is the only reason to recompute it. */
export function layoutFor(map: TransitMapSource): TransitLayout {
  const cached = layouts.get(map);
  if (cached) return cached;
  const layout = layoutTransit(toTransitInput(map));
  layouts.set(map, layout);
  return layout;
}

export function toTransitInput(map: TransitMapSource): TransitInput {
  return {
    lines: map.lines.map((line) => ({ id: line.id, title: line.title })),
    stations: map.stations.map((station) => ({
      id: station.id,
      title: station.title,
      lineIds: station.lineIds,
      state: station.state,
      ...(station.recall === null ? {} : { recall: station.recall }),
      ...(station.misconception === null ? {} : { misconception: true }),
      ...(station.note ? { note: station.note } : {}),
    })),
    edges: map.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      ...(edge.planned ? { planned: true } : {}),
    })),
    anchors: map.anchors,
    ...(map.here === null ? {} : { here: map.here }),
  };
}

/** Shortest unlock path from "you are here", otherwise from the closest solid prerequisite. */
export function planRoute(map: TransitMapSource, targetId: string): readonly string[] {
  const solid = new Set<string>();
  for (const station of map.stations) {
    if (station.state === "solid") solid.add(station.id);
  }
  return routeTo(map.edges, targetId, {
    ...(map.here === null ? {} : { here: map.here }),
    solid,
  });
}
