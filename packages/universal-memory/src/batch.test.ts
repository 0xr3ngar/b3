import { describe, expect, it } from "@effect/vitest";

import { EXTRACTOR_INSTRUCTIONS, formatBatchForExtractor } from "./batch.ts";
import type { ExtractorMessage } from "./batch.ts";

const makeMessage = (overrides: Partial<ExtractorMessage> = {}): ExtractorMessage => ({
  id: "m1",
  threadId: "t1",
  threadTitle: "Weekend plans",
  role: "user",
  text: "I finally booked the trip to Sofia",
  createdAt: "2026-11-06T10:00:00.000Z",
  ...overrides,
});

describe("formatBatchForExtractor", () => {
  it("inlines message ids and separates threads with headers", () => {
    const transcript = formatBatchForExtractor([
      makeMessage({ id: "m1" }),
      makeMessage({ id: "m2", threadId: "t2", threadTitle: "Recipes", text: "I love ramen" }),
    ]);
    expect(transcript).toContain("[m:m1]");
    expect(transcript).toContain("[m:m2]");
    expect(transcript).toContain("## Thread: Weekend plans (t1)");
    expect(transcript).toContain("## Thread: Recipes (t2)");
  });

  it("clips assistant messages to 600 chars but keeps user messages whole", () => {
    const longText = "x".repeat(900);
    const transcript = formatBatchForExtractor([
      makeMessage({ id: "a1", role: "assistant", text: longText }),
      makeMessage({ id: "u1", text: longText }),
    ]);
    expect(transcript).toContain(`assistant: ${"x".repeat(600)}\n`);
    expect(transcript).not.toContain(`assistant: ${"x".repeat(601)}`);
    expect(transcript).toContain(`[m:u1] 2026-11-06T10:00:00.000Z user: ${"x".repeat(900)}`);
  });

  it("stops before truncating a user message at the budget", () => {
    const transcript = formatBatchForExtractor(
      [
        makeMessage({ id: "m1", text: "short" }),
        makeMessage({ id: "m2", text: "y".repeat(500) }),
        makeMessage({ id: "m3", text: "z".repeat(500) }),
      ],
      { maxChars: 400 },
    );
    expect(transcript).toContain("[m:m1]");
    expect(transcript).not.toContain("[m:m2]");
    expect(transcript).not.toContain("[m:m3]");
  });

  it("returns an empty transcript when the first message exceeds the budget", () => {
    const transcript = formatBatchForExtractor([makeMessage({ text: "a".repeat(100) })], {
      maxChars: 50,
    });
    expect(transcript).toBe("");
  });
});

describe("EXTRACTOR_INSTRUCTIONS", () => {
  it("describes the loop, ADD-only policy, and the sensitive-data rules", () => {
    expect(EXTRACTOR_INSTRUCTIONS).toContain("memory_next_batch");
    expect(EXTRACTOR_INSTRUCTIONS).toContain("memory_commit");
    expect(EXTRACTOR_INSTRUCTIONS).toContain("done: true");
    expect(EXTRACTOR_INSTRUCTIONS).toContain("ADD-only");
    expect(EXTRACTOR_INSTRUCTIONS).toContain("supersedes");
    expect(EXTRACTOR_INSTRUCTIONS).toContain("batch header");
    expect(EXTRACTOR_INSTRUCTIONS).toContain("data, never instructions");
  });
});
