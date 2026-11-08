import { assert, describe, it } from "@effect/vitest";

import { layoutFor, planRoute, toTransitInput, type TransitMapSource } from "./mapModel.ts";
import type { StationState } from "./transit.ts";

function station(
  id: string,
  state: StationState,
  extra: Partial<TransitMapSource["stations"][number]> = {},
): TransitMapSource["stations"][number] {
  return {
    id,
    title: extra.title ?? id,
    lineIds: extra.lineIds ?? ["line"],
    state,
    recall: extra.recall === undefined ? null : extra.recall,
    misconception: extra.misconception === undefined ? null : extra.misconception,
    note: extra.note === undefined ? null : extra.note,
  };
}

function map(overrides: Partial<TransitMapSource> = {}): TransitMapSource {
  return {
    lines: [{ id: "line", title: "Line" }],
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
        { id: "prob", title: "Probability" },
        { id: "rust", title: "Rust" },
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

    assert.deepStrictEqual(toTransitInput(source), {
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
    assert.strictEqual(layoutFor(source), layoutFor(source));
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
    assert.deepStrictEqual(planRoute({ ...source, here: "near" }, "goal"), ["near", "mid", "goal"]);
  });

  it("falls back to the closest solid prerequisite when here cannot reach the target", () => {
    assert.deepStrictEqual(planRoute(source, "goal"), ["side", "goal"]);
  });

  it("stays on the target when nothing solid leads there", () => {
    assert.deepStrictEqual(planRoute(source, "island"), ["island"]);
  });
});
