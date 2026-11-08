import { describe, expect, it } from "@effect/vitest";

import { isTombstoned, matchesTopicRule, normalizeForTombstone } from "./rules.ts";

describe("matchesTopicRule", () => {
  const rules = [
    { id: "r-work", topic: "work", keywords: ["job", "work", "employer"] },
    { id: "r-health", topic: "health", keywords: ["diagnosis"] },
  ];

  it("matches keywords case-insensitively on word boundaries", () => {
    expect(matchesTopicRule("I hate my JOB", rules)).toEqual(["r-work"]);
    expect(matchesTopicRule("My employer is great", rules)).toEqual(["r-work"]);
    expect(matchesTopicRule("my diagnosis is asthma", rules)).toEqual(["r-health"]);
  });

  it("does not match inside other words", () => {
    expect(matchesTopicRule("this is particularly nice", rules)).toEqual([]);
    expect(matchesTopicRule("networking event", rules)).toEqual([]);
  });

  it("returns every matching rule", () => {
    const both = [
      { id: "a", topic: "x", keywords: ["job"] },
      { id: "b", topic: "y", keywords: ["hate"] },
    ];
    expect(matchesTopicRule("I hate my job", both)).toEqual(["a", "b"]);
  });

  it("returns nothing without matches", () => {
    expect(matchesTopicRule("I like cats", rules)).toEqual([]);
  });
});

describe("normalizeForTombstone", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeForTombstone("Hello,   World!")).toBe("hello world");
    expect(normalizeForTombstone("  Prefers   DARK mode. ")).toBe("prefers dark mode");
    expect(normalizeForTombstone("don't - remember; this!")).toBe("don t remember this");
  });

  it("is idempotent", () => {
    const once = normalizeForTombstone("Sofia, Bulgaria (home)");
    expect(normalizeForTombstone(once)).toBe(once);
  });
});

describe("isTombstoned", () => {
  it("matches a tombstone by normalized form", () => {
    const tombstones = [{ normalized: "never remember my job" }];
    expect(isTombstoned("Never  remember my job!", tombstones)).toBe(true);
    expect(isTombstoned("remember my salary", tombstones)).toBe(false);
  });

  it("returns false without tombstones", () => {
    expect(isTombstoned("anything", [])).toBe(false);
  });
});
