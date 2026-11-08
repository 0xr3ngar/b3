export type TopicRule = { id: string; topic: string; keywords: string[] };
export type Tombstone = { normalized: string };

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const matchesTopicRule = (text: string, rules: TopicRule[]): string[] => {
  const matchedIds: string[] = [];
  for (const rule of rules) {
    const isMatch = rule.keywords.some((keyword) => {
      const pattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i");
      return pattern.test(text);
    });
    if (isMatch) matchedIds.push(rule.id);
  }
  return matchedIds;
};

export const normalizeForTombstone = (text: string): string => {
  const lowercased = text.toLowerCase();
  const punctuationStripped = lowercased.replace(/[^\p{L}\p{N}\s]/gu, " ");
  return punctuationStripped.replace(/\s+/g, " ").trim();
};

export const isTombstoned = (text: string, tombstones: Tombstone[]): boolean => {
  const normalized = normalizeForTombstone(text);
  return tombstones.some((tombstone) => tombstone.normalized === normalized);
};
