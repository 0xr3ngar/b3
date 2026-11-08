// @effect-diagnostics globalDate:off -- Card boundaries are ISO timestamps so the same state runs in the server, web, and React Native without an Effect runtime.
import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card,
  type Grade,
  type ReviewLog,
} from "ts-fsrs";

import type { RatingName } from "./grading.ts";

export type CardStateName = "new" | "learning" | "review" | "relearning";

export interface LearnCardState {
  readonly due: string;
  readonly stability: number;
  readonly difficulty: number;
  readonly elapsedDays: number;
  readonly scheduledDays: number;
  readonly learningSteps: number;
  readonly reps: number;
  readonly lapses: number;
  readonly state: CardStateName;
  readonly lastReview: string | null;
}

export interface LearnReviewLog {
  readonly rating: RatingName;
  readonly state: CardStateName;
  readonly due: string;
  readonly stability: number;
  readonly difficulty: number;
  readonly scheduledDays: number;
  readonly learningSteps: number;
  readonly review: string;
}

export interface ScheduleOptions {
  readonly desiredRetention?: number;
  readonly firstIntervalCapDays?: number;
}

export interface IntervalPreview {
  readonly due: string;
  readonly label: string;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export function newCard(now: Date): LearnCardState {
  return fromCard(createEmptyCard(now), 0);
}

export function schedule(
  card: LearnCardState,
  rating: RatingName,
  now: Date,
  opts?: ScheduleOptions,
): { card: LearnCardState; log: LearnReviewLog } {
  const scheduled = engine(opts).next(toCard(card), now, toRating(rating));
  const elapsed = elapsedUtcDays(card, now);
  const next = capFirstInterval(
    fromCard(scheduled.card, elapsed),
    card,
    rating,
    now,
    capDays(opts),
  );
  return { card: next, log: fromLog(scheduled.log, rating) };
}

export function previewIntervals(
  card: LearnCardState,
  now: Date,
  opts?: ScheduleOptions,
): Record<RatingName, IntervalPreview> {
  const ratings: readonly RatingName[] = ["again", "hard", "good", "easy"];
  const previews = {} as Record<RatingName, IntervalPreview>;
  for (const rating of ratings) {
    const next = schedule(card, rating, now, opts).card;
    previews[rating] = { due: next.due, label: intervalLabel(now.getTime(), Date.parse(next.due)) };
  }
  return previews;
}

export function retrievability(card: LearnCardState, now: Date): number {
  if (card.state === "new") return 0;
  const value = engine().retrievability(toCard(card), now);
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function isDue(card: LearnCardState, now: Date): boolean {
  const due = Date.parse(card.due);
  return Number.isFinite(due) && due <= now.getTime();
}

function engine(opts?: ScheduleOptions) {
  return fsrs({
    request_retention: opts?.desiredRetention ?? 0.9,
    enable_fuzz: false,
    enable_short_term: true,
  });
}

function capDays(opts?: ScheduleOptions): number {
  return opts?.firstIntervalCapDays ?? 3;
}

function capFirstInterval(
  next: LearnCardState,
  previous: LearnCardState,
  rating: RatingName,
  now: Date,
  days: number,
): LearnCardState {
  if (rating === "again") return next;
  if (previous.state !== "new" && previous.state !== "learning") return next;
  const limit = now.getTime() + days * DAY_MS;
  const due = Date.parse(next.due);
  if (!Number.isFinite(due) || due <= limit) return next;
  return {
    ...next,
    due: new Date(limit).toISOString(),
    scheduledDays: days,
    stability: Math.min(next.stability, days),
  };
}

function elapsedUtcDays(card: LearnCardState, now: Date): number {
  if (card.lastReview === null || card.state === "new") return 0;
  const from = Date.parse(card.lastReview);
  if (!Number.isFinite(from)) return 0;
  const fromDay = Math.floor(from / DAY_MS);
  const toDay = Math.floor(now.getTime() / DAY_MS);
  return Math.max(0, toDay - fromDay);
}

function fromCard(card: Card, elapsedDays: number): LearnCardState {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: stateName(card.state),
    lastReview: card.last_review ? card.last_review.toISOString() : null,
  };
}

function fromLog(log: ReviewLog, rating: RatingName): LearnReviewLog {
  return {
    rating,
    state: stateName(log.state),
    due: log.due.toISOString(),
    stability: log.stability,
    difficulty: log.difficulty,
    scheduledDays: log.scheduled_days,
    learningSteps: log.learning_steps,
    review: log.review.toISOString(),
  };
}

function toCard(card: LearnCardState): Card {
  const converted: Card = {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: toState(card.state),
  };
  if (card.lastReview !== null) converted.last_review = new Date(card.lastReview);
  return converted;
}

function toRating(rating: RatingName): Grade {
  switch (rating) {
    case "again":
      return Rating.Again;
    case "hard":
      return Rating.Hard;
    case "good":
      return Rating.Good;
    case "easy":
      return Rating.Easy;
  }
}

function toState(state: CardStateName): State {
  switch (state) {
    case "new":
      return State.New;
    case "learning":
      return State.Learning;
    case "review":
      return State.Review;
    case "relearning":
      return State.Relearning;
  }
}

function stateName(state: State): CardStateName {
  switch (state) {
    case State.New:
      return "new";
    case State.Learning:
      return "learning";
    case State.Review:
      return "review";
    case State.Relearning:
      return "relearning";
    default:
      return "new";
  }
}

function intervalLabel(fromMs: number, dueMs: number): string {
  const elapsed = Math.max(0, dueMs - fromMs);
  const minutes = Math.round(elapsed / MINUTE_MS);
  if (minutes < 60) return `${Math.max(elapsed > 0 ? 1 : 0, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return unit(hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 14) return unit(days, "day");
  if (days < 60) return unit(Math.round(days / 7), "week");
  if (days < 730) return unit(Math.max(1, Math.round(days / 30)), "month");
  return unit(Math.max(1, Math.round(days / 365)), "year");
}

function unit(count: number, name: string): string {
  return `${count} ${name}${count === 1 ? "" : "s"}`;
}
