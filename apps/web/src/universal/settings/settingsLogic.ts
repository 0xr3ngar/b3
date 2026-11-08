import type {
  ExtractionInterval,
  MemoryKind,
  MemoryRecord,
  SensitiveCategory,
  UniversalStatus,
} from "@t3tools/contracts";

export const MEMORY_KIND_LABELS = {
  fact: "Fact",
  preference: "Preference",
  goal: "Goal",
  person: "Person",
  project: "Project",
  instruction: "Instruction",
  style: "Style",
} as const satisfies Record<MemoryKind, string>;

export const MEMORY_KINDS = Object.keys(MEMORY_KIND_LABELS) as ReadonlyArray<MemoryKind>;

export function isMemoryKind(value: string): value is MemoryKind {
  return Object.hasOwn(MEMORY_KIND_LABELS, value);
}

export const SENSITIVE_CATEGORY_LABELS = {
  health: "Health",
  religion: "Religion",
  politics: "Politics",
  sexuality: "Sexuality",
  gender_identity: "Gender identity",
} as const satisfies Record<SensitiveCategory, string>;

export const SENSITIVE_CATEGORIES = Object.keys(
  SENSITIVE_CATEGORY_LABELS,
) as ReadonlyArray<SensitiveCategory>;

export const EXTRACTION_INTERVAL_LABELS = {
  hourly: "Hourly",
  "6h": "Every 6 hours",
  daily: "Daily",
  off: "Off",
} as const satisfies Record<ExtractionInterval, string>;

export const EXTRACTION_INTERVALS = Object.keys(
  EXTRACTION_INTERVAL_LABELS,
) as ReadonlyArray<ExtractionInterval>;

export function isExtractionInterval(value: string): value is ExtractionInterval {
  return Object.hasOwn(EXTRACTION_INTERVAL_LABELS, value);
}

export const MEMORY_ORIGIN_LABELS = {
  extracted: "Extracted from a chat",
  saved: "Saved by you",
  edited: "Edited by you",
} as const satisfies Record<MemoryRecord["origin"], string>;

/** Split a comma-separated topic rule into unique lowercase keywords. */
export function parseTopicKeywords(raw: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const part of raw.split(",")) {
    const keyword = part.trim().toLowerCase();
    if (keyword.length === 0 || seen.has(keyword)) continue;
    seen.add(keyword);
    keywords.push(keyword);
  }
  return keywords;
}

export function formatTopicKeywords(keywords: readonly string[]): string {
  return keywords.join(", ");
}

/** `HH:MM` from a time input, or null when the field is incomplete or impossible. */
export function parseDailyReviewTime(raw: string): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(raw);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${match[1]}:${match[2]}`;
}

/** Desired retention is a percent-point in 0.80–0.97. */
export function clampRetention(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const clamped = Math.min(0.97, Math.max(0.8, value));
  return Math.round(clamped * 100) / 100;
}

export function memorySearchModeLabel(
  mode: UniversalStatus["memory"]["vectorSearch"],
  reason: string | null,
): string {
  if (mode === "vector") return "Vector + keyword";
  const detail = reason?.trim() ?? "";
  return detail.length > 0 ? `Keyword only (${detail})` : "Keyword only";
}

const EMBEDDER_STATE_LABELS = {
  idle: "Idle",
  downloading: "Downloading",
  loading: "Loading",
  ready: "Ready",
  error: "Error",
} as const satisfies Record<UniversalStatus["embedder"]["state"], string>;

export function embedderStatusLabel(embedder: UniversalStatus["embedder"]): string {
  const parts: string[] = [EMBEDDER_STATE_LABELS[embedder.state]];
  if (
    embedder.progress !== null &&
    (embedder.state === "downloading" || embedder.state === "loading")
  ) {
    const percent =
      embedder.progress <= 1 ? Math.round(embedder.progress * 100) : Math.round(embedder.progress);
    parts.push(`${percent}%`);
  }
  if (embedder.msPerText !== null) parts.push(`${Math.round(embedder.msPerText)} ms per text`);
  parts.push(`${embedder.indexedCount} indexed`);
  if (embedder.error !== null && embedder.error.trim().length > 0)
    parts.push(embedder.error.trim());
  return parts.join(" · ");
}

export function embedderNeedsGeminiKey(
  model: { readonly id: string; readonly provider: "local" | "gemini" } | null,
): boolean {
  return model !== null && (model.id === "gemini-embedding-2" || model.provider === "gemini");
}
