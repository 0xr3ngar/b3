import type { MemoryKind, MemoryRow } from "./schema.ts";
import { normalizeForTombstone } from "./rules.ts";

export type SupersedePlan = { supersedeIds: string[]; duplicateOf?: string };

export const planSupersede = (
  newOp: { kind: MemoryKind; text: string },
  existing: MemoryRow[],
  similarity: (a: string, b: string) => number,
  options?: { threshold?: number },
): SupersedePlan => {
  const threshold = options?.threshold ?? 0.86;
  const supersedeIds: string[] = [];
  const normalizedNew = normalizeForTombstone(newOp.text);
  for (const row of existing) {
    const isSameKind = row.kind === newOp.kind;
    if (!isSameKind) continue;
    const isClosed = row.supersededBy !== null || row.deletedAt !== null;
    if (isClosed) continue;
    const isExactDuplicate = normalizeForTombstone(row.text) === normalizedNew;
    if (isExactDuplicate) return { supersedeIds: [], duplicateOf: row.id };
    const isSimilar = similarity(newOp.text, row.text) >= threshold;
    if (isSimilar) supersedeIds.push(row.id);
  }
  return { supersedeIds };
};
