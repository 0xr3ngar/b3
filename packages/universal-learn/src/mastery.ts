export function updateMastery(prev: number, outcome: number, k = 0.3): number {
  return prev * (1 - k) + outcome * k;
}

export function canAdvance(input: {
  readonly mastery: number;
  readonly passedAtSpacingDays: readonly number[];
}): boolean {
  return input.mastery >= 0.8 && input.passedAtSpacingDays.some((days) => days >= 3);
}
