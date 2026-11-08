import { describe, expect, it } from "@effect/vitest";

import type { MemoryRow } from "./schema.ts";
import { planSupersede } from "./supersede.ts";

const makeRow = (overrides: Partial<MemoryRow> = {}): MemoryRow => ({
  id: "mem1",
  kind: "preference",
  text: "Prefers light mode",
  topic: null,
  confidence: 0.9,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  supersededBy: null,
  deletedAt: null,
  source: { threadId: "t1", messageIds: ["m1"], extractorModel: null },
  origin: "extracted",
  ...overrides,
});

const always = (value: number) => () => value;

describe("planSupersede", () => {
  it("reports an exact normalized duplicate and skips the insert", () => {
    const existing = [makeRow({ id: "mem1", text: "Prefers  LIGHT mode!" })];
    const plan = planSupersede(
      { kind: "preference", text: "prefers light mode" },
      existing,
      always(0),
    );
    expect(plan).toEqual({ supersedeIds: [], duplicateOf: "mem1" });
  });

  it("supersedes same-kind rows above the similarity threshold", () => {
    const existing = [makeRow({ id: "old1" }), makeRow({ id: "old2", kind: "fact" })];
    const plan = planSupersede(
      { kind: "preference", text: "Prefers dark mode now" },
      existing,
      always(0.9),
    );
    expect(plan).toEqual({ supersedeIds: ["old1"] });
  });

  it("ignores similar rows of other kinds and below the threshold", () => {
    const existing = [makeRow({ id: "fact1", kind: "fact" })];
    expect(
      planSupersede({ kind: "preference", text: "Prefers dark mode" }, existing, always(0.95)),
    ).toEqual({ supersedeIds: [] });
    expect(
      planSupersede(
        { kind: "preference", text: "Prefers dark mode" },
        [makeRow({ id: "mem1" })],
        always(0.5),
      ),
    ).toEqual({ supersedeIds: [] });
  });

  it("honors a custom threshold and skips closed rows", () => {
    const existing = [
      makeRow({ id: "closed", supersededBy: "newer" }),
      makeRow({ id: "deleted", deletedAt: "2026-06-01T00:00:00.000Z" }),
      makeRow({ id: "open" }),
    ];
    const plan = planSupersede(
      { kind: "preference", text: "Prefers dark mode" },
      existing,
      always(0.87),
      { threshold: 0.9 },
    );
    expect(plan).toEqual({ supersedeIds: [] });
    const openPlan = planSupersede(
      { kind: "preference", text: "Prefers dark mode" },
      existing,
      always(0.9),
      { threshold: 0.9 },
    );
    expect(openPlan).toEqual({ supersedeIds: ["open"] });
  });
});
