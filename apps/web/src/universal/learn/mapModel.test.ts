import type { LearnMap, LearnMapStation } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { layoutFor, linePaint, planRoute, toTransitInput } from "./mapModel";

function station(
  id: string,
  state: LearnMapStation["state"],
  extra: Partial<LearnMapStation> = {},
): LearnMapStation {
  return {
    id,
    title: extra.title ?? id,
    lineIds: extra.lineIds ?? ["line"],
    state,
    recall: extra.recall === undefined ? null : extra.recall,
    mastery: extra.mastery ?? 0,
    misconception: extra.misconception === undefined ? null : extra.misconception,
    dueAt: null,
    taughtIn: null,
    note: extra.note === undefined ? null : extra.note,
    minutes: extra.minutes ?? 10,
  };
}

function map(overrides: Partial<LearnMap> = {}): LearnMap {
  return {
    lines: [{ id: "line", title: "Line", color: "primary" }],
    stations: [],
    edges: [],
    anchors: {},
    here: null,
    ...overrides,
  };
}

describe("toTransitInput", () => {
  it("maps lines, states, recall, misconceptions, and anchors", () => {
    const source = map({
      lines: [
        { id: "prob", title: "Probability", color: "primary" },
        { id: "rust", title: "Rust", color: "rust" },
      ],
      stations: [
        station("lik", "learning", {
          title: "Likelihood",
          lineIds: ["prob", "rust"],
          recall: 0,
          misconception: "The likelihood is not a probability of θ.",
        }),
        station("own", "solid", { title: "Ownership", lineIds: ["rust"], recall: null }),
      ],
      edges: [
        { from: "own", to: "lik", planned: false },
        { from: "lik", to: "own", planned: true },
      ],
      anchors: { own: { x: 12, y: 34 } },
    });

    expect(toTransitInput(source)).toEqual({
      lines: [
        { id: "prob", title: "Probability" },
        { id: "rust", title: "Rust" },
      ],
      stations: [
        {
          id: "lik",
          title: "Likelihood",
          lineIds: ["prob", "rust"],
          state: "learning",
          recall: 0,
          misconception: true,
        },
        {
          id: "own",
          title: "Ownership",
          lineIds: ["rust"],
          state: "solid",
        },
      ],
      edges: [
        { from: "own", to: "lik" },
        { from: "lik", to: "own", planned: true },
      ],
      anchors: { own: { x: 12, y: 34 } },
    });
    expect(layoutFor(source)).toBe(layoutFor(source));
    expect(linePaint("rust")).toBe("var(--l-rust)");
    expect(linePaint("other")).toBe("var(--foreground)");
  });
});

describe("planRoute", () => {
  const source = map({
    stations: [
      station("near", "solid"),
      station("mid", "locked"),
      station("goal", "ready"),
      station("side", "solid"),
      station("far", "solid"),
      station("island", "locked"),
    ],
    edges: [
      { from: "near", to: "mid", planned: false },
      { from: "mid", to: "goal", planned: true },
      { from: "side", to: "goal", planned: false },
    ],
    here: "far",
  });

  it("starts at here when that stop can reach the target", () => {
    expect(planRoute({ ...source, here: "near" }, "goal")).toEqual(["near", "mid", "goal"]);
  });

  it("falls back to the closest solid prerequisite when here cannot reach the target", () => {
    expect(planRoute(source, "goal")).toEqual(["side", "goal"]);
  });

  it("stays on the target when nothing solid leads there", () => {
    expect(planRoute(source, "island")).toEqual(["island"]);
  });
});
