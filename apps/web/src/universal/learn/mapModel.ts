import type { LearnMap } from "@t3tools/contracts";
import { routeTo } from "@t3tools/universal-learn/graph";
import {
  layoutTransit,
  type TransitInput,
  type TransitLayout,
} from "@t3tools/universal-learn/transit";

const layouts = new WeakMap<LearnMap, TransitLayout>();

/** Geometry is pure in the map object, so a new server snapshot is the only reason to recompute it. */
export function layoutFor(map: LearnMap): TransitLayout {
  const cached = layouts.get(map);
  if (cached) return cached;
  const layout = layoutTransit(toTransitInput(map));
  layouts.set(map, layout);
  return layout;
}

export function toTransitInput(map: LearnMap): TransitInput {
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
export function planRoute(map: LearnMap, targetId: string): readonly string[] {
  const solid = new Set<string>();
  for (const station of map.stations) {
    if (station.state === "solid") solid.add(station.id);
  }
  return routeTo(map.edges, targetId, {
    ...(map.here === null ? {} : { here: map.here }),
    solid,
  });
}

export function linePaint(color: string): string {
  switch (color) {
    case "primary":
    case "success":
    case "rust":
    case "span":
    case "warning":
    case "info":
      return `var(--l-${color})`;
    default:
      return "var(--foreground)";
  }
}
