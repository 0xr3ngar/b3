// @effect-diagnostics globalDate:off -- Fixtures pin review instants so FSRS intervals stay deterministic.
import { assert, describe, it } from "@effect/vitest";

import {
  isDue,
  newCard,
  previewIntervals,
  retrievability,
  schedule,
  type LearnCardState,
} from "./fsrs.ts";
import {
  gradeChoice,
  gradeCloze,
  gradeFromAttempt,
  gradeShort,
  masteryOutcome,
} from "./grading.ts";
import {
  prerequisiteClosure,
  routeTo,
  shortestUnlockPath,
  unlocksWithin,
  validatePlan,
  type PlanConcept,
} from "./graph.ts";
import { canAdvance, updateMastery } from "./mastery.ts";
import { realMap } from "./realMapFixture.ts";
import {
  focusSet,
  layoutTransit,
  OTHER_LINE_ID,
  roundedPath,
  transitLabelBox,
  transitSubtitle,
  type TransitInput,
} from "./transit.ts";

const now = new Date("2026-01-15T12:00:00.000Z");
const dayMs = 86_400_000;

function concept(id: string): PlanConcept {
  return { id, title: id, topicIds: [] };
}

describe("gradeFromAttempt", () => {
  const rows: {
    name: string;
    attempt: Parameters<typeof gradeFromAttempt>[0];
    rating: string;
    hypercorrection: boolean;
  }[] = [
    {
      name: "incorrect and confident",
      attempt: { outcome: "incorrect", help: "none", confidence: "high" },
      rating: "again",
      hypercorrection: true,
    },
    {
      name: "incorrect and unsure",
      attempt: { outcome: "incorrect", help: "hint", confidence: "low" },
      rating: "again",
      hypercorrection: false,
    },
    {
      name: "structural miss with high confidence",
      attempt: { outcome: "correct", help: "none", confidence: "high", structuralMiss: true },
      rating: "again",
      hypercorrection: true,
    },
    {
      name: "structural miss without high confidence",
      attempt: { outcome: "correct", help: "none", confidence: "medium", structuralMiss: true },
      rating: "again",
      hypercorrection: false,
    },
    {
      name: "answer revealed",
      attempt: { outcome: "correct", help: "answer", confidence: "high" },
      rating: "again",
      hypercorrection: false,
    },
    {
      name: "partial",
      attempt: { outcome: "partial", help: "none", confidence: "high" },
      rating: "hard",
      hypercorrection: false,
    },
    {
      name: "hint",
      attempt: { outcome: "correct", help: "hint", confidence: "high" },
      rating: "hard",
      hypercorrection: false,
    },
    {
      name: "low confidence",
      attempt: { outcome: "correct", help: "none", confidence: "low" },
      rating: "hard",
      hypercorrection: false,
    },
    {
      name: "medium confidence",
      attempt: { outcome: "correct", help: "none", confidence: "medium" },
      rating: "good",
      hypercorrection: false,
    },
    {
      name: "high confidence",
      attempt: { outcome: "correct", help: "none", confidence: "high" },
      rating: "good",
      hypercorrection: false,
    },
    {
      name: "mature and fast",
      attempt: { outcome: "correct", help: "none", confidence: "high", mature: true, fast: true },
      rating: "easy",
      hypercorrection: false,
    },
    {
      name: "mature but slow",
      attempt: { outcome: "correct", help: "none", confidence: "high", mature: true, fast: false },
      rating: "good",
      hypercorrection: false,
    },
  ];

  it.each(rows)("$name", (row) => {
    assert.deepEqual(gradeFromAttempt(row.attempt), {
      rating: row.rating,
      hypercorrection: row.hypercorrection,
    });
  });
});

describe("masteryOutcome", () => {
  it("maps attempt quality onto the moving average", () => {
    assert.equal(masteryOutcome({ outcome: "correct", help: "none", confidence: "high" }), 1);
    assert.equal(masteryOutcome({ outcome: "correct", help: "hint", confidence: "high" }), 0.6);
    assert.equal(masteryOutcome({ outcome: "correct", help: "answer", confidence: "low" }), 0.3);
    assert.equal(
      masteryOutcome({ outcome: "incorrect", help: "none", confidence: "high", corrected: true }),
      0.2,
    );
    assert.equal(masteryOutcome({ outcome: "incorrect", help: "none", confidence: "low" }), 0);
  });
});

describe("gradeCloze", () => {
  it("normalizes case, whitespace, and surrounding punctuation", () => {
    assert.equal(gradeCloze("  Hello! ", { accept: ["hello"] }), "correct");
    assert.equal(gradeCloze("Hello", { accept: ["hello"], caseSensitive: true }), "incorrect");
    assert.equal(gradeCloze("¿Hola?", { accept: ["hola"] }), "correct");
  });

  it("compares numbers, including fractions, within tolerance", () => {
    assert.equal(gradeCloze(".5", { accept: ["1/2"] }), "correct");
    assert.equal(gradeCloze("0.5", { accept: ["1 / 2"] }), "correct");
    assert.equal(gradeCloze("０．５", { accept: ["0.5"] }), "correct");
    assert.equal(gradeCloze("0.52", { accept: ["0.5"], numericTolerance: 0.05 }), "correct");
    assert.equal(gradeCloze("0.6", { accept: ["0.5"], numericTolerance: 0.05 }), "incorrect");
  });
});

describe("gradeChoice", () => {
  it("matches the selected index", () => {
    assert.equal(gradeChoice(2, 2), "correct");
    assert.equal(gradeChoice(0, 2), "incorrect");
  });
});

describe("gradeShort", () => {
  const rubric = {
    mustInclude: [["probability", "chance"], ["data"]],
    misconceptions: [
      { id: "reversed", patterns: ["P(θ | data)", "/likelihood is a probability/i"] },
    ],
  };

  it("scores partial credit from the fraction of synonym groups", () => {
    const full = gradeShort("The probability of the data", rubric);
    assert.equal(full.outcome, "correct");
    assert.equal(full.matchedGroups, 2);
    assert.equal(full.missingGroups, 0);
    assert.equal(full.structuralMiss, false);

    const partial = gradeShort("only the probability", rubric);
    assert.equal(partial.outcome, "partial");
    assert.equal(partial.matchedGroups, 1);
    assert.equal(partial.missingGroups, 1);

    const miss = gradeShort("nothing relevant", rubric);
    assert.equal(miss.outcome, "incorrect");
    assert.equal(miss.matchedGroups, 0);
  });

  it("flags a matched misconception as a structural miss", () => {
    const graded = gradeShort(
      "The probability of the data, and the likelihood is a probability",
      rubric,
    );
    assert.equal(graded.outcome, "correct");
    assert.deepEqual(graded.misconceptionIds, ["reversed"]);
    assert.equal(graded.structuralMiss, true);
  });
});

describe("mastery", () => {
  it("updates with a moving average and gates advancement", () => {
    assert.equal(updateMastery(0, 1), 0.3);
    assert.equal(updateMastery(1, 0), 0.7);
    assert.equal(canAdvance({ mastery: 0.8, passedAtSpacingDays: [1, 3] }), true);
    assert.equal(canAdvance({ mastery: 0.8, passedAtSpacingDays: [1, 2] }), false);
    assert.equal(canAdvance({ mastery: 0.79, passedAtSpacingDays: [5] }), false);
  });
});

describe("validatePlan", () => {
  it("repairs a cycle by dropping the latest closing edge and keeps a stable topo order", () => {
    const concepts = [concept("a"), concept("b"), concept("c")];
    const repaired = validatePlan({
      concepts,
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    });
    assert.equal(repaired.ok, true);
    assert.deepEqual(repaired.removedEdges, [{ from: "c", to: "a", reason: "cycle" }]);
    assert.deepEqual(repaired.order, ["a", "b", "c"]);

    const latest = validatePlan({
      concepts,
      edges: [
        { from: "c", to: "a" },
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    });
    assert.deepEqual(latest.removedEdges, [{ from: "b", to: "c", reason: "cycle" }]);
    assert.deepEqual(latest.order, ["c", "a", "b"]);
  });

  it("breaks source ties by concept input order", () => {
    const order = validatePlan({
      concepts: [concept("b"), concept("a"), concept("c")],
      edges: [
        { from: "a", to: "c" },
        { from: "b", to: "c" },
      ],
    }).order;
    assert.deepEqual(order, ["b", "a", "c"]);
  });

  it("drops self-loops, duplicates, unknown concepts, and indegree overflow", () => {
    const result = validatePlan(
      {
        concepts: [concept("a"), concept("b"), concept("c")],
        edges: [
          { from: "a", to: "a" },
          { from: "a", to: "c" },
          { from: "a", to: "c" },
          { from: "missing", to: "c" },
          { from: "b", to: "c" },
        ],
      },
      { maxIndegree: 1 },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.removedEdges, [
      { from: "a", to: "a", reason: "self_loop" },
      { from: "a", to: "c", reason: "duplicate" },
      { from: "missing", to: "c", reason: "unknown_concept" },
      { from: "b", to: "c", reason: "indegree" },
    ]);
    assert.deepEqual(result.order, ["a", "b", "c"]);
  });

  it("reports duplicate concept ids", () => {
    const result = validatePlan({
      concepts: [concept("a"), concept("a")],
      edges: [],
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, ["duplicate concept id: a"]);
    assert.deepEqual(result.order, ["a"]);
  });
});

describe("routes", () => {
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "d", to: "c" },
  ];

  it("walks prerequisites and bounded unlocks", () => {
    assert.deepEqual(prerequisiteClosure(edges, "c"), ["b", "d", "a"]);
    assert.deepEqual(unlocksWithin(edges, "a", 2), ["b", "c"]);
    assert.deepEqual(shortestUnlockPath(edges, "a", "c"), ["a", "b", "c"]);
    assert.equal(shortestUnlockPath(edges, "d", "a"), null);
    assert.deepEqual(
      prerequisiteClosure(
        [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
        "a",
      ),
      ["b"],
    );
  });

  it("prefers here, then the closest solid prerequisite, then the target alone", () => {
    assert.deepEqual(routeTo(edges, "c", { here: "a", solid: new Set(["d"]) }), ["a", "b", "c"]);
    assert.deepEqual(routeTo(edges, "c", { here: "missing", solid: new Set(["a", "d"]) }), [
      "d",
      "c",
    ]);
    assert.deepEqual(routeTo(edges, "c", { solid: new Set() }), ["c"]);
  });

  it("focuses the stop, its prerequisites, and unlocks to depth 2", () => {
    const chain = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "d" },
      { from: "d", to: "e" },
    ];
    assert.deepEqual([...focusSet(chain, "c")].sort(), ["a", "b", "c", "d", "e"]);
    assert.deepEqual([...focusSet(chain, "c", { unlockDepth: 1 })].sort(), ["a", "b", "c", "d"]);
  });
});

describe("fsrs", () => {
  it("caps the first successful review and leaves a later review alone", () => {
    const card = newCard(now);
    assert.equal(card.state, "new");
    assert.equal(isDue(card, now), true);
    assert.equal(retrievability(card, now), 0);

    const loose = schedule(card, "easy", now, { firstIntervalCapDays: 10_000 });
    const capped = schedule(card, "easy", now);
    const looseDays = (Date.parse(loose.card.due) - now.getTime()) / dayMs;
    const cappedDays = (Date.parse(capped.card.due) - now.getTime()) / dayMs;
    assert.equal(looseDays > 3, true);
    assert.equal(cappedDays <= 3, true);
    assert.equal(capped.card.scheduledDays <= 3, true);

    const mature: LearnCardState = {
      due: now.toISOString(),
      stability: 40,
      difficulty: 5,
      elapsedDays: 10,
      scheduledDays: 10,
      learningSteps: 0,
      reps: 4,
      lapses: 0,
      state: "review",
      lastReview: new Date(now.getTime() - 10 * dayMs).toISOString(),
    };
    const next = schedule(mature, "good", now);
    assert.equal((Date.parse(next.card.due) - now.getTime()) / dayMs > 3, true);
  });

  it("previews intervals in ascending order", () => {
    const preview = previewIntervals(newCard(now), now);
    const due = (rating: keyof typeof preview) => Date.parse(preview[rating].due);
    assert.equal(
      due("again") < due("hard") && due("hard") < due("good") && due("good") < due("easy"),
      true,
    );
    const minutes = (label: string) => {
      const match = /^(\d+) (min|hours?|days?|weeks?|months?|years?)$/.exec(label);
      assert.equal(match === null, false);
      const count = Number(match?.[1]);
      const unit = match?.[2] ?? "";
      const scale = unit.startsWith("min")
        ? 1
        : unit.startsWith("hour")
          ? 60
          : unit.startsWith("day")
            ? 1_440
            : unit.startsWith("week")
              ? 10_080
              : unit.startsWith("month")
                ? 43_200
                : 525_600;
      return count * scale;
    };
    assert.equal(
      minutes(preview.again.label) < minutes(preview.hard.label) &&
        minutes(preview.hard.label) < minutes(preview.good.label) &&
        minutes(preview.good.label) < minutes(preview.easy.label),
      true,
    );
  });
});

describe("layoutTransit", () => {
  const map: TransitInput = {
    lines: [
      { id: "rust", title: "Rust" },
      { id: "prob", title: "Probability" },
    ],
    stations: [
      { id: "own", title: "Ownership", lineIds: ["rust"], state: "solid" },
      { id: "traits", title: "Traits", lineIds: ["rust"], state: "solid" },
      { id: "borrow", title: "Borrowing", lineIds: ["rust"], state: "learning" },
      { id: "gen", title: "Generics", lineIds: ["rust", "prob"], state: "solid" },
      { id: "cond", title: "Conditional", lineIds: ["prob"], state: "ready" },
      { id: "post", title: "Posterior", lineIds: ["prob"], state: "locked" },
      { id: "mc", title: "Monte Carlo", lineIds: [], state: "suggested" },
    ],
    edges: [
      { from: "own", to: "traits" },
      { from: "traits", to: "gen" },
      { from: "own", to: "borrow" },
      { from: "cond", to: "gen" },
      { from: "gen", to: "post", planned: true },
      { from: "cond", to: "mc" },
    ],
  };

  it("is deterministic, keeps one interchange, and draws octilinear segments", () => {
    const first = layoutTransit(map);
    const second = layoutTransit(map);
    assert.deepEqual(first, second);
    assert.equal(first.stations.filter((station) => station.id === "gen").length, 1);
    assert.equal(first.stations.find((station) => station.id === "gen")?.interchange, true);

    const byId = new Map(first.stations.map((station) => [station.id, station]));
    const positions = first.stations.map((station) => `${station.x},${station.y}`);
    assert.equal(new Set(positions).size, positions.length);
    for (const segment of first.segments) {
      assert.equal(isOctilinear(segment.points), true);
      const from = byId.get(segment.from);
      const to = byId.get(segment.to);
      const start = segment.points[0];
      const end = segment.points[segment.points.length - 1];
      assert.equal(
        from !== undefined && to !== undefined && start !== undefined && end !== undefined,
        true,
      );
      if (!from || !to || !start || !end) continue;
      assert.equal(start[0], from.x);
      assert.equal(start[1], from.y);
      assert.equal(end[0], to.x);
      assert.equal(end[1], to.y);
    }

    const own = byId.get("own");
    const traits = byId.get("traits");
    const borrow = byId.get("borrow");
    assert.equal(
      own !== undefined &&
        traits !== undefined &&
        own.y === traits.y &&
        borrow !== undefined &&
        borrow.y > own.y,
      true,
    );
    assert.equal(first.segments.find((segment) => segment.to === "mc")?.kind, "link");
    assert.equal(first.segments.find((segment) => segment.to === "post")?.kind, "planned");
    assert.equal(
      roundedPath([
        [0, 0],
        [10, 0],
        [10, 10],
      ]),
      "M0,0 L5,0 Q10,0 10,5 L10,10",
    );
  });

  it("keeps anchors and moves a colliding new slot to a free cell", () => {
    const base = layoutTransit(map);
    const own = base.stations.find((station) => station.id === "own");
    const traits = base.stations.find((station) => station.id === "traits");
    assert.equal(own !== undefined && traits !== undefined, true);
    if (!own || !traits) return;
    const pinned = layoutTransit({
      ...map,
      anchors: { own: { x: traits.x, y: traits.y }, borrow: { x: 42, y: 77 } },
    });
    const placedOwn = pinned.stations.find((station) => station.id === "own");
    const placedBorrow = pinned.stations.find((station) => station.id === "borrow");
    const placedTraits = pinned.stations.find((station) => station.id === "traits");
    assert.deepEqual(placedOwn && { x: placedOwn.x, y: placedOwn.y }, { x: traits.x, y: traits.y });
    assert.deepEqual(placedBorrow && { x: placedBorrow.x, y: placedBorrow.y }, { x: 42, y: 77 });
    assert.equal(
      placedTraits !== undefined && (placedTraits.x !== traits.x || placedTraits.y !== traits.y),
      true,
    );
    const keys = pinned.stations.map((station) => `${station.x},${station.y}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("lays the real map out as trunks, spurs, and a bottom Other line", () => {
    const layout = layoutTransit(realMap);
    const byId = new Map(layout.stations.map((station) => [station.id, station]));

    const overlaps: string[] = [];
    const outside: string[] = [];
    const boxes = realMap.stations.flatMap((station) => {
      const laid = byId.get(station.id);
      if (!laid) return [];
      const box = transitLabelBox(
        station.title,
        laid.x,
        laid.y,
        laid.labelAt,
        laid.interchange,
        transitSubtitle(station),
      );
      if (
        box.left < -0.01 ||
        box.top < -0.01 ||
        box.right > layout.width + 0.01 ||
        box.bottom > layout.height + 0.01
      ) {
        outside.push(station.id);
      }
      return [{ id: station.id, box }];
    });
    for (let left = 0; left < boxes.length; left++) {
      for (let right = left + 1; right < boxes.length; right++) {
        const a = boxes[left];
        const b = boxes[right];
        if (!a || !b) continue;
        if (boxesOverlap(a.box, b.box)) overlaps.push(`${a.id} ${b.id}`);
      }
    }
    assert.deepEqual(overlaps, []);
    assert.deepEqual(outside, []);

    const crossings: string[] = [];
    const byLine = new Map<
      string,
      { from: string; to: string; points: readonly (readonly [number, number])[] }[]
    >();
    for (const segment of layout.segments) {
      if (!segment.lineId) continue;
      const list = byLine.get(segment.lineId) ?? [];
      list.push(segment);
      byLine.set(segment.lineId, list);
    }
    for (const [lineId, segments] of byLine) {
      for (let left = 0; left < segments.length; left++) {
        for (let right = left + 1; right < segments.length; right++) {
          const a = segments[left];
          const b = segments[right];
          if (!a || !b) continue;
          if (legsCross(a.points, b.points))
            crossings.push(`${lineId} ${a.from}->${a.to} ${b.from}->${b.to}`);
        }
      }
    }
    assert.deepEqual(crossings, []);

    const orphans = ["bayes-rule", "bayes.likelihood", "bayes.prior"];
    const orphanStations = orphans.flatMap((id) => {
      const station = byId.get(id);
      return station ? [station] : [];
    });
    assert.equal(orphanStations.length, orphans.length);
    for (const station of orphanStations) assert.equal(station.lineId, OTHER_LINE_ID);
    const orphanY = orphanStations[0]?.y;
    assert.equal(
      orphanStations.every((station) => station.y === orphanY),
      true,
    );
    const lined = layout.stations.filter(
      (station) => station.lineId !== null && station.lineId !== OTHER_LINE_ID,
    );
    const lowestLine = Math.max(...lined.map((station) => station.y));
    assert.equal(orphanY !== undefined && orphanY > lowestLine, true);
    assert.equal(
      layout.bullets.some((bullet) => bullet.lineId === OTHER_LINE_ID),
      true,
    );
    const spanish = byId.get("spanish-beginner");
    const rightOrphan = Math.max(...orphanStations.map((station) => station.x));
    assert.equal(
      spanish !== undefined &&
        spanish.lineId === null &&
        spanish.x > rightOrphan &&
        spanish.y >= (orphanY ?? 0),
      true,
    );
  });
});

function boxesOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function legsCross(
  a: readonly (readonly [number, number])[],
  b: readonly (readonly [number, number])[],
): boolean {
  for (let i = 1; i < a.length; i++) {
    const a0 = a[i - 1];
    const a1 = a[i];
    if (!a0 || !a1) continue;
    for (let j = 1; j < b.length; j++) {
      const b0 = b[j - 1];
      const b1 = b[j];
      if (!b0 || !b1) continue;
      if (properCross(a0, a1, b0, b1)) return true;
    }
  }
  return false;
}

function properCross(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
): boolean {
  const d1 = cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]);
  const d2 = cross(b[0] - a[0], b[1] - a[1], d[0] - a[0], d[1] - a[1]);
  const d3 = cross(d[0] - c[0], d[1] - c[1], a[0] - c[0], a[1] - c[1]);
  const d4 = cross(d[0] - c[0], d[1] - c[1], b[0] - c[0], b[1] - c[1]);
  if (Math.abs(d1) < 1e-6 || Math.abs(d2) < 1e-6 || Math.abs(d3) < 1e-6 || Math.abs(d4) < 1e-6) {
    return false;
  }
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function isOctilinear(points: readonly (readonly [number, number])[]): boolean {
  if (points.length < 2) return false;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const point = points[index];
    if (!previous || !point) return false;
    const dx = point[0] - previous[0];
    const dy = point[1] - previous[1];
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return false;
    if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6) continue;
    if (Math.abs(Math.abs(dx) - Math.abs(dy)) > 1e-6) return false;
  }
  return true;
}
