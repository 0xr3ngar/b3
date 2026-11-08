import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { KnowledgeSignal, MemoryCommitInput, MemoryKind, MemoryOp, MemoryRow } from "./schema.ts";

const decodeMemoryOp = Schema.decodeUnknownSync(MemoryOp);
const decodeMemoryCommitInput = Schema.decodeUnknownSync(MemoryCommitInput);
const decodeMemoryRow = Schema.decodeUnknownSync(MemoryRow);
const decodeKnowledgeSignal = Schema.decodeUnknownSync(KnowledgeSignal);

const validOp = {
  op: "add",
  kind: "fact",
  text: "Lives in Sofia",
  sourceMessageIds: ["m1"],
  confidence: 0.8,
};

describe("memory schemas", () => {
  it("decodes valid ops with and without optional fields", () => {
    expect(decodeMemoryOp(validOp)).toEqual(validOp);
    expect(decodeMemoryOp({ ...validOp, supersedes: ["m0"], topic: "home" })).toEqual({
      ...validOp,
      supersedes: ["m0"],
      topic: "home",
    });
  });

  it("rejects ops that violate field constraints", () => {
    expect(() => decodeMemoryOp({ ...validOp, op: "update" })).toThrow();
    expect(() => decodeMemoryOp({ ...validOp, kind: "secret" })).toThrow();
    expect(() => decodeMemoryOp({ ...validOp, text: "" })).toThrow();
    expect(() => decodeMemoryOp({ ...validOp, text: "x".repeat(501) })).toThrow();
    expect(() => decodeMemoryOp({ ...validOp, confidence: 1.5 })).toThrow();
    expect(() => decodeMemoryOp({ ...validOp, confidence: -0.1 })).toThrow();
    expect(() => decodeMemoryOp({ ...validOp, sourceMessageIds: [] })).toThrow();
    expect(() =>
      decodeMemoryOp({ ...validOp, sourceMessageIds: ["m"].concat(Array(20).fill("x")) }),
    ).toThrow();
    expect(() => decodeMemoryOp({ ...validOp, supersedes: Array(21).fill("x") })).toThrow();
  });

  it("rejects commits over the op and signal limits", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => ({ ...validOp, text: `m${i}` }));
    expect(decodeMemoryCommitInput({ batchId: "b1", ops: fifty, signals: [] })).toBeDefined();
    expect(() =>
      decodeMemoryCommitInput({ batchId: "b1", ops: [...fifty, validOp], signals: [] }),
    ).toThrow();
    const twentySignals = Array.from({ length: 20 }, (_, i) => ({
      concept: `c${i}`,
      strength: 0.5,
      sourceMessageIds: ["m1"],
    }));
    expect(
      decodeMemoryCommitInput({ batchId: "b1", ops: [], signals: twentySignals }),
    ).toBeDefined();
    expect(() =>
      decodeMemoryCommitInput({
        batchId: "b1",
        ops: [],
        signals: [...twentySignals, twentySignals[0]],
      }),
    ).toThrow();
    expect(() => decodeMemoryCommitInput({ batchId: "", ops: [], signals: [] })).toThrow();
  });

  it("decodes knowledge signals and rejects bad strengths", () => {
    expect(
      decodeKnowledgeSignal({ concept: "Bayes", strength: 1, sourceMessageIds: ["m1"] }),
    ).toBeDefined();
    expect(() =>
      decodeKnowledgeSignal({ concept: "Bayes", strength: 2, sourceMessageIds: ["m1"] }),
    ).toThrow();
  });

  it("decodes memory rows with nullable fields", () => {
    const row = {
      id: "mem1",
      kind: "preference",
      text: "Prefers dark mode",
      topic: null,
      confidence: 0.9,
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:00:00.000Z",
      supersededBy: null,
      deletedAt: null,
      source: { threadId: "t1", messageIds: ["m1"], extractorModel: null },
      origin: "extracted",
    };
    expect(decodeMemoryRow(row)).toEqual(row);
    expect(() => decodeMemoryRow({ ...row, origin: "guessed" })).toThrow();
    expect(() => decodeMemoryRow({ ...row, topic: undefined })).toThrow();
  });

  it("exposes the kind union as a type", () => {
    const kinds: MemoryKind[] = [
      "fact",
      "preference",
      "goal",
      "person",
      "project",
      "instruction",
      "style",
    ];
    expect(kinds).toHaveLength(7);
  });
});
