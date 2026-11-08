import { describe, expect, it } from "@effect/vitest";

import { reciprocalRankFusion, withRecency } from "./fusion.ts";

describe("reciprocalRankFusion", () => {
  it("ranks items appearing high in several lists first", () => {
    const scored = reciprocalRankFusion([
      [{ id: "a" }, { id: "b" }],
      [{ id: "b" }, { id: "c" }],
    ]);
    expect(scored.map((entry) => entry.id)).toEqual(["b", "a", "c"]);
    expect(scored[0]?.score).toBeCloseTo(1 / 61 + 1 / 62, 12);
  });

  it("applies per-list weights", () => {
    const scored = reciprocalRankFusion([[{ id: "a" }], [{ id: "b" }]], { weights: [3, 1] });
    expect(scored[0]?.id).toBe("a");
    expect(scored[0]?.score).toBeCloseTo(3 / 61, 12);
    expect(scored[1]?.score).toBeCloseTo(1 / 61, 12);
  });

  it("honors a custom k", () => {
    const scored = reciprocalRankFusion([[{ id: "a" }]], { k: 1 });
    expect(scored[0]?.score).toBeCloseTo(1 / 2, 12);
  });

  it("handles empty input", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});

describe("withRecency", () => {
  const now = "2026-11-07T00:00:00.000Z";

  it("boosts recently updated rows above equally scored older ones", () => {
    const rows = new Map([
      ["old", { updatedAt: "2025-01-01T00:00:00.000Z" }],
      ["new", { updatedAt: "2026-11-06T00:00:00.000Z" }],
    ]);
    const boosted = withRecency(
      [
        { id: "old", score: 0.5 },
        { id: "new", score: 0.5 },
      ],
      rows,
      now,
    );
    expect(boosted.map((entry) => entry.id)).toEqual(["new", "old"]);
    expect(boosted[0]?.score).toBeGreaterThan(0.5);
    expect(boosted[1]?.score).toBeLessThan(0.51);
  });

  it("fades the boost with the half-life", () => {
    const rows = new Map([["a", { updatedAt: "2026-08-09T00:00:00.000Z" }]]);
    const boosted = withRecency([{ id: "a", score: 1 }], rows, now, {
      halfLifeDays: 90,
      weight: 0.15,
    });
    expect(boosted[0]?.score).toBeCloseTo(1 + 0.075, 6);
  });

  it("leaves unknown and stale-timestamped rows untouched", () => {
    const rows = new Map([
      ["known", { updatedAt: "not-a-date" }],
      ["garbage", { updatedAt: "2026-11-01T00:00:00.000Z" }],
    ]);
    const boosted = withRecency(
      [
        { id: "known", score: 0.4 },
        { id: "missing", score: 0.3 },
      ],
      rows,
      now,
    );
    expect(boosted).toEqual([
      { id: "known", score: 0.4 },
      { id: "missing", score: 0.3 },
    ]);
  });
});
