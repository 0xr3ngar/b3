export type LineRef = {
  id: string;
  name: string;
  color: "primary" | "success" | "rust" | "span" | "warning" | string;
};

export type Card = {
  conceptId: string;
  conceptTitle: string;
  line: LineRef | null;
  kind: "cloze" | "choice" | "short" | "recall";
  stem: string;
  options?: string[];
  hintAvailable: boolean;
  misconceptionWarning?: string;
};

export type CardResult = {
  outcome: "correct" | "partial" | "incorrect";
  rating: "again" | "hard" | "good" | "easy";
  hypercorrection: boolean;
  feedback: string;
  explanation?: string;
  correctAnswer?: string;
  intervals: { again: string; hard: string; good: string; easy: string };
  overridden?: boolean;
};

export type CardState = {
  status: "open" | "graded";
  help: "none" | "hint" | "answer";
  hint?: string;
  answer?: { text?: string; choice?: number };
  confidence?: "low" | "medium" | "high";
  result?: CardResult;
};

export type SessionSummary = {
  title: string;
  minutes: number;
  counts: { reviewed: number; remembered: number; again: number };
  diff: {
    kind: "learned" | "stronger" | "fixed" | "weaker";
    conceptTitle: string;
    detail?: string;
  }[];
  stops: {
    conceptTitle: string;
    state: "solid" | "learning" | "due" | "ready";
    line: LineRef | null;
    note?: string;
  }[];
  schedule: { when: string; concepts: string[] }[];
  unlocked?: { conceptId: string; conceptTitle: string };
  next?: { conceptId: string; conceptTitle: string };
  snoozeUntil?: string;
};

export type LearnWidgetPayload =
  | { widget: "check"; itemId: string; card: Card }
  | { widget: "review"; itemId: string; title: string; cards: Card[] }
  | { widget: "session-end"; itemId: string; summary: SessionSummary };
