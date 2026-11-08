export type Outcome = "correct" | "partial" | "incorrect";
export type Help = "none" | "hint" | "answer";
export type Confidence = "low" | "medium" | "high";
export type RatingName = "again" | "hard" | "good" | "easy";

export interface AttemptGrade {
  readonly outcome: Outcome;
  readonly help: Help;
  readonly confidence: Confidence;
  readonly structuralMiss?: boolean;
  readonly mature?: boolean;
  readonly fast?: boolean;
  /** The learner was wrong, then corrected the answer in the same attempt. */
  readonly corrected?: boolean;
}

export function gradeFromAttempt(attempt: AttemptGrade): {
  rating: RatingName;
  hypercorrection: boolean;
} {
  if (attempt.structuralMiss === true || attempt.outcome === "incorrect") {
    return { rating: "again", hypercorrection: attempt.confidence === "high" };
  }
  if (attempt.help === "answer") {
    return { rating: "again", hypercorrection: false };
  }
  if (attempt.outcome === "partial" || attempt.help === "hint" || attempt.confidence === "low") {
    return { rating: "hard", hypercorrection: false };
  }
  if (attempt.confidence === "high" && attempt.mature === true && attempt.fast === true) {
    return { rating: "easy", hypercorrection: false };
  }
  return { rating: "good", hypercorrection: false };
}

/** Credit applied to the mastery moving average. Rubric outcome, not the FSRS rating. */
export function masteryOutcome(attempt: AttemptGrade): number {
  if (attempt.outcome === "incorrect") return attempt.corrected === true ? 0.2 : 0;
  if (attempt.help === "answer") return 0.3;
  if (attempt.outcome === "correct" && attempt.help === "hint") return 0.6;
  if (attempt.outcome === "correct" && attempt.help === "none" && attempt.confidence === "high") {
    return 1;
  }
  if (attempt.outcome === "correct" && attempt.help === "none" && attempt.confidence === "medium") {
    return 0.8;
  }
  if (attempt.outcome === "correct" && attempt.help === "none" && attempt.confidence === "low") {
    return 0.6;
  }
  if (attempt.outcome === "partial" && attempt.help === "hint") return 0.4;
  return 0.5;
}

export interface ClozeSpec {
  readonly accept: readonly string[];
  readonly caseSensitive?: boolean;
  readonly numericTolerance?: number;
}

export function gradeCloze(answer: string, spec: ClozeSpec): Outcome {
  const folded = normalizeText(answer, spec.caseSensitive === true);
  const gotText = stripEdges(folded);
  const gotNumber = numericValue(folded);
  const tolerance = spec.numericTolerance ?? 0;
  for (const option of spec.accept) {
    const want = normalizeText(option, spec.caseSensitive === true);
    if (gotText === stripEdges(want)) return "correct";
    const wantNumber = numericValue(want);
    if (
      gotNumber !== null &&
      wantNumber !== null &&
      Math.abs(gotNumber - wantNumber) <= tolerance
    ) {
      return "correct";
    }
  }
  return "incorrect";
}

export function gradeChoice(selectedIndex: number, correctIndex: number): Outcome {
  return selectedIndex === correctIndex ? "correct" : "incorrect";
}

export interface ShortRubric {
  /** Each inner list is a synonym group. Every group is required for a correct answer. */
  readonly mustInclude: readonly (readonly string[])[];
  /** Fraction of groups that still counts as partial. Defaults to 0.5. */
  readonly partialAt?: number;
  readonly misconceptions?: readonly {
    readonly id: string;
    readonly patterns: readonly string[];
  }[];
}

export interface ShortGrade {
  readonly outcome: Outcome;
  readonly matchedGroups: number;
  readonly missingGroups: number;
  readonly misconceptionIds: readonly string[];
  readonly structuralMiss: boolean;
}

export function gradeShort(answer: string, rubric: ShortRubric): ShortGrade {
  const text = normalizeText(answer, false);
  let matchedGroups = 0;
  for (const group of rubric.mustInclude) {
    if (group.some((pattern) => matchesPattern(text, pattern))) matchedGroups += 1;
  }
  const total = rubric.mustInclude.length;
  const missingGroups = total - matchedGroups;
  const partialAt = rubric.partialAt ?? 0.5;
  const outcome: Outcome =
    matchedGroups === total
      ? "correct"
      : total > 0 && matchedGroups / total >= partialAt
        ? "partial"
        : "incorrect";
  const misconceptionIds: string[] = [];
  for (const misconception of rubric.misconceptions ?? []) {
    if (misconception.patterns.some((pattern) => matchesPattern(text, pattern))) {
      misconceptionIds.push(misconception.id);
    }
  }
  return {
    outcome,
    matchedGroups,
    missingGroups,
    misconceptionIds,
    structuralMiss: misconceptionIds.length > 0,
  };
}

function normalizeText(raw: string, caseSensitive: boolean): string {
  const compacted = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  return caseSensitive ? compacted : compacted.toLowerCase();
}

function stripEdges(text: string): string {
  return text.replace(/^[^\p{L}\p{N}+-]+|[^\p{L}\p{N}]+$/gu, "");
}

function numericValue(text: string): number | null {
  return parseNumber(text) ?? parseNumber(stripEdges(text));
}

function parseNumber(text: string): number | null {
  const fraction = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(text);
  if (fraction?.[1] !== undefined && fraction[2] !== undefined) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    const value = Number(fraction[1]) / denominator;
    return Number.isFinite(value) ? value : null;
  }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function matchesPattern(text: string, pattern: string): boolean {
  const compiled = compilePattern(pattern);
  if (compiled) {
    try {
      return compiled.test(text);
    } catch {
      return false;
    }
  }
  return text.includes(pattern.normalize("NFKC").toLowerCase());
}

function compilePattern(pattern: string): RegExp | null {
  const wrapped = /^\/(.+)\/([a-z]*)$/.exec(pattern);
  if (wrapped?.[1] === undefined) return null;
  try {
    return new RegExp(wrapped[1], wrapped[2] ?? "");
  } catch {
    return null;
  }
}
