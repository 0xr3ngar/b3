import {
  canOfferLearnThis,
  type ContextMenuItem,
  type ThreadId,
  type UniversalSpace,
} from "@t3tools/contracts";

const LEARN_THIS_ACTION = "learn-this";

const SPACE_BY_DIGIT: Record<string, UniversalSpace> = {
  Digit1: "code",
  Digit2: "chat",
  Digit3: "learn",
};

export interface LearnThisThread {
  readonly id: ThreadId;
  readonly title: string;
}

type LearnThisHandler = (thread: LearnThisThread) => void;

let learnThisHandler: LearnThisHandler | null = null;

export function registerLearnThis(handler: LearnThisHandler): () => void {
  learnThisHandler = handler;
  return () => {
    if (learnThisHandler === handler) learnThisHandler = null;
  };
}

export function requestLearnThis(thread: LearnThisThread): void {
  learnThisHandler?.(thread);
}

export function isLearnThisAction(action: string): action is typeof LEARN_THIS_ACTION {
  return action === LEARN_THIS_ACTION;
}

function learnThisMenuEntries(
  projectId: string | null,
): readonly ContextMenuItem<typeof LEARN_THIS_ACTION>[] {
  if (!canOfferLearnThis(projectId)) return [];
  return [{ id: LEARN_THIS_ACTION, label: "Learn this", icon: "graduation-cap" }];
}

/** Inserts Learn this above Archive. Learn threads get the menu unchanged. */
export function withLearnThisMenu<T extends string>(
  items: readonly ContextMenuItem<T>[],
  projectId: string | null,
): ReadonlyArray<ContextMenuItem<T | typeof LEARN_THIS_ACTION>> {
  const extra = learnThisMenuEntries(projectId);
  if (extra.length === 0) return items;
  const archiveAt = items.findIndex((item) => item.id === "archive");
  if (archiveAt < 0) return [...items, ...extra];
  return [...items.slice(0, archiveAt), ...extra, ...items.slice(archiveAt)];
}

/** Alt+1/2/3. Cmd/Ctrl+1/2/3 already jump to threads on desktop. */
export function spaceFromAltDigit(event: {
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly code: string;
  readonly repeat?: boolean;
}): UniversalSpace | null {
  if (event.repeat === true) return null;
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return null;
  return SPACE_BY_DIGIT[event.code] ?? null;
}
