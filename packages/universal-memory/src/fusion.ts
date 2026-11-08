// @effect-diagnostics globalDate:off -- updatedAt and `now` are ISO timestamps; comparing them needs Date.parse.
export type ScoredId = { id: string; score: number };

export const reciprocalRankFusion = (
  lists: { id: string }[][],
  options?: { k?: number; weights?: number[] },
): ScoredId[] => {
  const k = options?.k ?? 60;
  const weights = options?.weights;
  const scores = new Map<string, number>();
  lists.forEach((list, listIndex) => {
    const weight = weights?.[listIndex] ?? 1;
    list.forEach((item, rank) => {
      const contribution = weight / (k + rank + 1);
      const current = scores.get(item.id) ?? 0;
      scores.set(item.id, current + contribution);
    });
  });
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
};

export const withRecency = (
  scored: ScoredId[],
  rows: Map<string, { updatedAt: string }>,
  now: string,
  options?: { halfLifeDays?: number; weight?: number },
): ScoredId[] => {
  const halfLifeDays = options?.halfLifeDays ?? 90;
  const weight = options?.weight ?? 0.15;
  const nowMs = Date.parse(now);
  return scored
    .map((entry) => {
      const row = rows.get(entry.id);
      const canBoost = row !== undefined && !Number.isNaN(nowMs);
      if (!canBoost) return entry;
      const updatedAtMs = Date.parse(row.updatedAt);
      const hasValidTimestamp = !Number.isNaN(updatedAtMs);
      if (!hasValidTimestamp) return entry;
      const ageDays = Math.max(0, (nowMs - updatedAtMs) / 86_400_000);
      const boost = weight * 2 ** (-ageDays / halfLifeDays);
      return { id: entry.id, score: entry.score + boost };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
};
