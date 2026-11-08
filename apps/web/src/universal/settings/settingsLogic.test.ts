import { describe, expect, it } from "vite-plus/test";

import {
  clampRetention,
  embedderNeedsGeminiKey,
  embedderStatusLabel,
  memorySearchModeLabel,
  parseDailyReviewTime,
  parseTopicKeywords,
} from "./settingsLogic";

describe("parseTopicKeywords", () => {
  it("splits, trims, lowercases, and drops duplicates", () => {
    expect(parseTopicKeywords(" Health, health, ,Religion ")).toEqual(["health", "religion"]);
    expect(parseTopicKeywords("")).toEqual([]);
    expect(parseTopicKeywords(",,,")).toEqual([]);
  });
});

describe("parseDailyReviewTime", () => {
  it("accepts a clock time and rejects anything else", () => {
    expect(parseDailyReviewTime("09:30")).toBe("09:30");
    expect(parseDailyReviewTime("00:00")).toBe("00:00");
    expect(parseDailyReviewTime("9:30")).toBeNull();
    expect(parseDailyReviewTime("24:00")).toBeNull();
    expect(parseDailyReviewTime("12:60")).toBeNull();
    expect(parseDailyReviewTime("")).toBeNull();
  });
});

describe("clampRetention", () => {
  it("keeps a percent-point inside 0.80–0.97", () => {
    expect(clampRetention(0.9)).toBe(0.9);
    expect(clampRetention(0.855)).toBe(0.86);
    expect(clampRetention(0.5)).toBe(0.8);
    expect(clampRetention(1)).toBe(0.97);
    expect(clampRetention(Number.NaN)).toBeNull();
  });
});

describe("memory search and embedder labels", () => {
  it("names the search mode and a download in progress", () => {
    expect(memorySearchModeLabel("vector", null)).toBe("Vector + keyword");
    expect(memorySearchModeLabel("fts-only", " sqlite-vec missing ")).toBe(
      "Keyword only (sqlite-vec missing)",
    );
    expect(memorySearchModeLabel("fts-only", "  ")).toBe("Keyword only");
    expect(
      embedderStatusLabel({
        modelId: "embeddinggemma",
        state: "downloading",
        progress: 0.5,
        error: null,
        msPerText: 12.4,
        indexedCount: 3,
      }),
    ).toBe("Downloading · 50% · 12 ms per text · 3 indexed");
    expect(embedderNeedsGeminiKey({ id: "gemini-embedding-2", provider: "gemini" })).toBe(true);
    expect(embedderNeedsGeminiKey({ id: "embeddinggemma", provider: "local" })).toBe(false);
    expect(embedderNeedsGeminiKey(null)).toBe(false);
  });
});
