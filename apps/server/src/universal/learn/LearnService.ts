// @effect-diagnostics globalDate:off globalDateInEffect:off - the FSRS library and SQLite rows exchange Date and ISO strings.
import {
  CommandId,
  type LearnMap,
  type LearnMapActionInput,
  type LearnMapStation,
  type LearnStartInput,
  type LearnStationState,
  MessageId,
  type ModelSelection,
  ThreadId,
  UNIVERSAL_SPACE_PROJECT_IDS,
} from "@t3tools/contracts";
import {
  type LearnCardState,
  newCard,
  previewIntervals,
  retrievability,
  schedule,
} from "@t3tools/universal-learn/fsrs";
import {
  type Confidence,
  type Help,
  type Outcome,
  gradeChoice,
  gradeCloze,
  gradeFromAttempt,
  gradeShort,
  masteryOutcome,
} from "@t3tools/universal-learn/grading";
import { validatePlan } from "@t3tools/universal-learn/graph";
import { canAdvance, updateMastery } from "@t3tools/universal-learn/mastery";
import {
  type Card,
  type CardResult,
  type CardState,
  type LearnWidgetPayload,
  type SessionSummary,
} from "@t3tools/universal-widgets";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as NodeSqlite from "node:sqlite";

import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as UniversalDb from "../db/UniversalDb.ts";
import * as MemoryService from "../memory/MemoryService.ts";
import * as UniversalSettingsStore from "../UniversalSettingsStore.ts";

export class LearnError extends Schema.TaggedError<LearnError>()("LearnError", {
  message: Schema.String,
}) {}

const LINE_COLORS = ["primary", "success", "rust", "span", "warning", "info"] as const;
const DAY = 86_400_000;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "concept";

/** What the agent sends for one question; answer keys stay on the server. */
export interface LearnItemInput {
  readonly conceptId: string;
  readonly kind: "cloze" | "choice" | "short" | "recall";
  readonly stem: string;
  readonly options?: ReadonlyArray<string> | undefined;
  readonly correctIndex?: number | undefined;
  readonly accept?: ReadonlyArray<string> | undefined;
  readonly rubric?:
    | {
        readonly mustInclude: ReadonlyArray<ReadonlyArray<string>>;
        readonly misconceptions?:
          | ReadonlyArray<{
              readonly id: string;
              readonly patterns: ReadonlyArray<string>;
              readonly note: string;
            }>
          | undefined;
      }
    | undefined;
  readonly correctAnswer?: string | undefined;
  readonly explanation?: string | undefined;
  readonly hint?: string | undefined;
}

interface StoredItem {
  readonly widget: "check" | "review";
  readonly title: string;
  readonly cards: ReadonlyArray<LearnItemInput>;
}

interface StoredCardState extends CardState {
  readonly cardBefore?: LearnCardState;
  readonly reviewedAt?: string;
}

interface ConceptRow {
  readonly id: string;
  readonly title: string;
  readonly claim: string | null;
  readonly minutes: number;
  readonly status: string;
  readonly note: string | null;
  readonly x: number | null;
  readonly y: number | null;
}

interface CardRow {
  readonly concept_id: string;
  readonly card_json: string;
  readonly mastery: number;
  readonly passes_json: string;
  readonly due_at: string | null;
}

export interface PlanInput {
  readonly lines: ReadonlyArray<{ readonly title: string; readonly id?: string }>;
  readonly concepts: ReadonlyArray<{
    readonly id?: string;
    readonly title: string;
    readonly claim?: string;
    readonly lines: ReadonlyArray<string>;
    readonly minutes?: number;
  }>;
  readonly edges: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

const parseJson = <A>(value: string | null | undefined, fallback: A): A => {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value) as A;
  } catch {
    return fallback;
  }
};

const conceptState = (
  concept: ConceptRow,
  card: CardRow | undefined,
  prereqsSolid: boolean,
  now: Date,
): { state: LearnStationState; recall: number | null; mastery: number; dueAt: string | null } => {
  if (concept.status === "suggested")
    return { state: "suggested", recall: null, mastery: 0, dueAt: null };
  if (card === undefined) {
    return { state: prereqsSolid ? "ready" : "locked", recall: null, mastery: 0, dueAt: null };
  }
  const parsed = parseJson<LearnCardState | null>(card.card_json, null);
  const recall = parsed === null ? null : retrievability(parsed, now);
  const passes = parseJson<ReadonlyArray<number>>(card.passes_json, []);
  const due = card.due_at !== null && Date.parse(card.due_at) <= now.getTime();
  if (due) return { state: "due", recall, mastery: card.mastery, dueAt: card.due_at };
  const solid = canAdvance({ mastery: card.mastery, passedAtSpacingDays: [...passes] });
  return { state: solid ? "solid" : "learning", recall, mastery: card.mastery, dueAt: card.due_at };
};

export class LearnService extends Context.Service<
  LearnService,
  {
    readonly map: Effect.Effect<LearnMap, UniversalDb.UniversalDbError>;
    readonly plan: (input: PlanInput) => Effect.Effect<
      {
        readonly order: ReadonlyArray<string>;
        readonly removedEdges: ReadonlyArray<unknown>;
        readonly errors: ReadonlyArray<string>;
      },
      UniversalDb.UniversalDbError
    >;
    readonly ask: (input: {
      readonly threadId: ThreadId;
      readonly title?: string;
      readonly items: ReadonlyArray<LearnItemInput>;
    }) => Effect.Effect<
      { readonly itemId: string; readonly payload: LearnWidgetPayload },
      UniversalDb.UniversalDbError | LearnError
    >;
    readonly widgetState: (input: {
      readonly threadId: ThreadId;
      readonly itemId: string;
    }) => Effect.Effect<
      { readonly states: ReadonlyArray<CardState>; readonly position: number },
      UniversalDb.UniversalDbError | LearnError
    >;
    readonly answer: (input: {
      readonly threadId: ThreadId;
      readonly itemId: string;
      readonly cardIndex: number;
      readonly answer: { readonly text?: string; readonly choice?: number };
      readonly confidence: Confidence;
      readonly help: Help;
    }) => Effect.Effect<CardState, UniversalDb.UniversalDbError | LearnError>;
    readonly hint: (input: {
      readonly threadId: ThreadId;
      readonly itemId: string;
      readonly cardIndex: number;
    }) => Effect.Effect<{ readonly hint: string }, UniversalDb.UniversalDbError | LearnError>;
    readonly override: (input: {
      readonly threadId: ThreadId;
      readonly itemId: string;
      readonly cardIndex: number;
      readonly rating: "again" | "hard" | "good" | "easy";
    }) => Effect.Effect<CardState, UniversalDb.UniversalDbError | LearnError>;
    readonly record: (input: {
      readonly threadId: ThreadId;
      readonly conceptId: string;
      readonly outcome: Outcome;
      readonly help: Help;
      readonly confidence: Confidence;
      readonly misconception?: string;
    }) => Effect.Effect<
      { readonly dueAt: string; readonly rating: string },
      UniversalDb.UniversalDbError | LearnError
    >;
    readonly reviewQueue: (input: { readonly limit: number }) => Effect.Effect<
      ReadonlyArray<{
        readonly conceptId: string;
        readonly title: string;
        readonly claim: string | null;
        readonly lines: ReadonlyArray<string>;
        readonly recall: number | null;
        readonly misconceptions: ReadonlyArray<string>;
        readonly recentStems: ReadonlyArray<string>;
      }>,
      UniversalDb.UniversalDbError
    >;
    readonly sessionEnd: (input: {
      readonly threadId: ThreadId;
      readonly title: string;
      readonly diff: SessionSummary["diff"];
      readonly next?: string;
    }) => Effect.Effect<
      {
        readonly itemId: string;
        readonly payload: LearnWidgetPayload;
        readonly snoozeUntil: string | null;
      },
      UniversalDb.UniversalDbError | LearnError
    >;
    readonly suggest: (input: {
      readonly title: string;
      readonly topic?: string;
      readonly note?: string;
    }) => Effect.Effect<{ readonly conceptId: string }, UniversalDb.UniversalDbError>;
    readonly action: (
      input: LearnMapActionInput,
    ) => Effect.Effect<void, UniversalDb.UniversalDbError>;
    readonly start: (
      input: LearnStartInput,
    ) => Effect.Effect<{ readonly threadId: ThreadId }, LearnError | UniversalDb.UniversalDbError>;
    readonly markTaught: (input: {
      readonly conceptIds: ReadonlyArray<string>;
      readonly threadId: ThreadId;
      readonly threadTitle: string;
    }) => Effect.Effect<void, UniversalDb.UniversalDbError>;
    readonly dueSummary: Effect.Effect<
      { readonly concepts: number; readonly due: number; readonly nextReviewAt: string | null },
      UniversalDb.UniversalDbError
    >;
    readonly widgetAction: (input: {
      readonly threadId: ThreadId;
      readonly itemId: string;
      readonly action: "snooze" | "start_concept" | "continue";
      readonly conceptId?: string;
    }) => Effect.Effect<
      { readonly ok: boolean; readonly message?: string },
      LearnError | UniversalDb.UniversalDbError
    >;
  }
>()("t3/universal/learn/LearnService") {}

const make = Effect.gen(function* () {
  const db = yield* UniversalDb.UniversalDb;
  const settingsStore = yield* UniversalSettingsStore.UniversalSettingsStore;
  const memory = yield* MemoryService.MemoryService;
  const random = yield* SecureRandom.SecureRandom;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const launches = yield* ThreadLaunchService.ThreadLaunchService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const now = Clock.currentTimeMillis.pipe(Effect.map((ms) => new Date(ms)));
  const uuid = random.uuidV4().pipe(Effect.orDie);
  const newId = (prefix: string) =>
    uuid.pipe(Effect.map((id) => `${prefix}_${id.replaceAll("-", "").slice(0, 20)}`));

  const readConcepts = (sqlite: NodeSqlite.DatabaseSync) =>
    sqlite
      .prepare(
        "SELECT id, title, claim, minutes, status, note, x, y FROM learn_concepts WHERE status != 'dismissed'",
      )
      .all() as unknown as ReadonlyArray<ConceptRow>;
  const readCards = (sqlite: NodeSqlite.DatabaseSync) =>
    new Map(
      (sqlite.prepare("SELECT * FROM learn_cards").all() as unknown as ReadonlyArray<CardRow>).map(
        (row) => [row.concept_id, row],
      ),
    );
  const readEdges = (sqlite: NodeSqlite.DatabaseSync) =>
    sqlite
      .prepare("SELECT from_id, to_id, planned FROM learn_edges")
      .all() as unknown as ReadonlyArray<{
      from_id: string;
      to_id: string;
      planned: number;
    }>;

  const ensureLine = (sqlite: NodeSqlite.DatabaseSync, title: string, at: string) => {
    const id = slugify(title);
    const existing = sqlite.prepare("SELECT id FROM learn_lines WHERE id = ?").get(id);
    if (existing === undefined) {
      const count = sqlite.prepare("SELECT COUNT(*) AS count FROM learn_lines").get() as {
        count: number;
      };
      sqlite
        .prepare(
          "INSERT INTO learn_lines (id, title, color, ord, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          id,
          title,
          LINE_COLORS[count.count % LINE_COLORS.length] ?? "primary",
          count.count,
          at,
        );
    } else {
      sqlite.prepare("UPDATE learn_lines SET deleted_at = NULL WHERE id = ?").run(id);
    }
    return id;
  };

  const ingestSignals = Effect.gen(function* () {
    const signals = yield* memory.takeSignals.pipe(Effect.orElseSucceed(() => []));
    if (signals.length === 0) return;
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    yield* db.transaction("learn.ingestSignals", (sqlite) => {
      for (const signal of signals) {
        const id = slugify(signal.concept);
        const exists = sqlite.prepare("SELECT 1 FROM learn_concepts WHERE id = ?").get(id);
        if (exists !== undefined) continue;
        sqlite
          .prepare(
            `INSERT INTO learn_concepts (id, title, status, note, source, created_at, updated_at)
             VALUES (?, ?, 'suggested', ?, 'chat', ?, ?)`,
          )
          .run(id, signal.concept, signal.topic ?? null, at, at);
        if (signal.topic !== undefined) {
          const lineId = ensureLine(sqlite, signal.topic, at);
          sqlite
            .prepare(
              "INSERT OR IGNORE INTO learn_concept_lines (concept_id, line_id) VALUES (?, ?)",
            )
            .run(id, lineId);
        }
      }
    });
  });

  const map = Effect.gen(function* () {
    yield* ingestSignals;
    const at = yield* now;
    return yield* db.use("learn.map", (sqlite): LearnMap => {
      const lines = (
        sqlite
          .prepare("SELECT id, title, color FROM learn_lines WHERE deleted_at IS NULL ORDER BY ord")
          .all() as unknown as ReadonlyArray<{ id: string; title: string; color: string }>
      ).map((line) => ({ ...line }));
      const concepts = readConcepts(sqlite);
      const cards = readCards(sqlite);
      const edges = readEdges(sqlite);
      const conceptLines = sqlite
        .prepare("SELECT concept_id, line_id FROM learn_concept_lines ORDER BY ord")
        .all() as unknown as ReadonlyArray<{ concept_id: string; line_id: string }>;
      const linesOf = new Map<string, Array<string>>();
      for (const row of conceptLines) {
        const list = linesOf.get(row.concept_id) ?? [];
        list.push(row.line_id);
        linesOf.set(row.concept_id, list);
      }
      const prereqs = new Map<string, Array<string>>();
      for (const edge of edges) {
        const list = prereqs.get(edge.to_id) ?? [];
        list.push(edge.from_id);
        prereqs.set(edge.to_id, list);
      }
      const states = new Map<string, ReturnType<typeof conceptState>>();
      const resolve = (id: string, seen: Set<string>): ReturnType<typeof conceptState> => {
        const cached = states.get(id);
        if (cached !== undefined) return cached;
        const concept = concepts.find((entry) => entry.id === id);
        if (concept === undefined)
          return { state: "locked", recall: null, mastery: 0, dueAt: null };
        seen.add(id);
        const needs = (prereqs.get(id) ?? []).filter((need) => !seen.has(need));
        const prereqsSolid = needs.every((need) => {
          const state = resolve(need, seen).state;
          return state === "solid" || state === "due" || state === "learning";
        });
        const result = conceptState(concept, cards.get(id), prereqsSolid, at);
        states.set(id, result);
        return result;
      };
      const misconceptions = new Map(
        (
          sqlite
            .prepare(
              "SELECT concept_id, text FROM learn_misconceptions WHERE resolved_at IS NULL ORDER BY created_at DESC",
            )
            .all() as unknown as ReadonlyArray<{ concept_id: string; text: string }>
        ).map((row) => [row.concept_id, row.text]),
      );
      const taught = new Map(
        (
          sqlite
            .prepare("SELECT concept_id, thread_id, thread_title, at FROM learn_taught ORDER BY at")
            .all() as unknown as ReadonlyArray<{
            concept_id: string;
            thread_id: string;
            thread_title: string;
            at: string;
          }>
        ).map((row) => [
          row.concept_id,
          { threadId: ThreadId.make(row.thread_id), title: row.thread_title, at: row.at },
        ]),
      );
      const stations: Array<LearnMapStation> = concepts.map((concept) => {
        const state = resolve(concept.id, new Set());
        return {
          id: concept.id,
          title: concept.title,
          lineIds: linesOf.get(concept.id) ?? [],
          state: state.state,
          recall: state.recall,
          mastery: state.mastery,
          misconception: misconceptions.get(concept.id) ?? null,
          dueAt: state.dueAt,
          taughtIn: taught.get(concept.id) ?? null,
          note: concept.note,
          minutes: concept.minutes,
        };
      });
      const anchors: Record<string, { x: number; y: number }> = {};
      for (const concept of concepts) {
        if (concept.x !== null && concept.y !== null)
          anchors[concept.id] = { x: concept.x, y: concept.y };
      }
      const last = sqlite
        .prepare("SELECT concept_id FROM learn_review_log ORDER BY reviewed_at DESC LIMIT 1")
        .get() as { concept_id: string } | undefined;
      return {
        lines,
        stations,
        edges: edges.map((edge) => ({
          from: edge.from_id,
          to: edge.to_id,
          planned: edge.planned === 1,
        })),
        anchors,
        here: last?.concept_id ?? null,
      };
    });
  }).pipe(Effect.withSpan("LearnService.map"));

  const plan: LearnService["Service"]["plan"] = Effect.fn("LearnService.plan")(function* (input) {
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    return yield* db.transaction("learn.plan", (sqlite) => {
      for (const line of input.lines) ensureLine(sqlite, line.title, at);
      const existing = readConcepts(sqlite);
      const ids = input.concepts.map((concept) => concept.id ?? slugify(concept.title));
      const resolveRef = (ref: string) => {
        const slug = slugify(ref);
        if (ids.includes(ref)) return ref;
        if (ids.includes(slug)) return slug;
        const match = [
          ...existing,
          ...input.concepts.map((concept, index) => ({ id: ids[index]!, title: concept.title })),
        ].find(
          (concept) => concept.id === ref || concept.title.toLowerCase() === ref.toLowerCase(),
        );
        return match?.id ?? slug;
      };
      const allConcepts = new Map<string, { id: string; title: string; topicIds: string[] }>();
      for (const concept of existing)
        allConcepts.set(concept.id, { id: concept.id, title: concept.title, topicIds: [] });
      input.concepts.forEach((concept, index) => {
        const id = ids[index]!;
        allConcepts.set(id, { id, title: concept.title, topicIds: concept.lines.map(slugify) });
      });
      const existingEdges = readEdges(sqlite).map((edge) => ({
        from: edge.from_id,
        to: edge.to_id,
      }));
      const newEdges = input.edges.map((edge) => ({
        from: resolveRef(edge.from),
        to: resolveRef(edge.to),
      }));
      const validation = validatePlan(
        { concepts: [...allConcepts.values()], edges: [...existingEdges, ...newEdges] },
        { maxIndegree: 4 },
      );
      input.concepts.forEach((concept, index) => {
        const id = ids[index]!;
        sqlite
          .prepare(
            `INSERT INTO learn_concepts (id, title, claim, minutes, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'active', ?, ?)
             ON CONFLICT (id) DO UPDATE SET title = excluded.title,
               claim = COALESCE(excluded.claim, learn_concepts.claim),
               minutes = excluded.minutes, status = 'active', updated_at = excluded.updated_at`,
          )
          .run(id, concept.title, concept.claim ?? null, concept.minutes ?? 12, at, at);
        concept.lines.forEach((lineTitle, ord) => {
          const lineId = ensureLine(sqlite, lineTitle, at);
          sqlite
            .prepare(
              "INSERT OR IGNORE INTO learn_concept_lines (concept_id, line_id, ord) VALUES (?, ?, ?)",
            )
            .run(id, lineId, ord);
        });
      });
      const removed = new Set(validation.removedEdges.map((edge) => `${edge.from}->${edge.to}`));
      for (const edge of newEdges) {
        if (removed.has(`${edge.from}->${edge.to}`)) continue;
        if (!allConcepts.has(edge.from) || !allConcepts.has(edge.to)) continue;
        sqlite
          .prepare(
            "INSERT OR IGNORE INTO learn_edges (from_id, to_id, planned, created_at) VALUES (?, ?, 0, ?)",
          )
          .run(edge.from, edge.to, at);
      }
      return {
        order: validation.order,
        removedEdges: validation.removedEdges,
        errors: validation.errors,
      };
    });
  });

  const lineRef = (sqlite: NodeSqlite.DatabaseSync, conceptId: string): Card["line"] => {
    const row = sqlite
      .prepare(
        `SELECT l.id, l.title, l.color FROM learn_concept_lines c JOIN learn_lines l ON l.id = c.line_id
         WHERE c.concept_id = ? ORDER BY c.ord LIMIT 1`,
      )
      .get(conceptId) as { id: string; title: string; color: string } | undefined;
    return row === undefined ? null : { id: row.id, name: row.title, color: row.color };
  };

  const toCard = (sqlite: NodeSqlite.DatabaseSync, item: LearnItemInput): Card => {
    const concept = sqlite
      .prepare("SELECT title FROM learn_concepts WHERE id = ?")
      .get(item.conceptId) as { title: string } | undefined;
    const misconception = sqlite
      .prepare(
        "SELECT text FROM learn_misconceptions WHERE concept_id = ? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1",
      )
      .get(item.conceptId) as { text: string } | undefined;
    return {
      conceptId: item.conceptId,
      conceptTitle: concept?.title ?? item.conceptId,
      line: lineRef(sqlite, item.conceptId),
      kind: item.kind,
      stem: item.stem,
      ...(item.options === undefined ? {} : { options: [...item.options] }),
      hintAvailable: item.hint !== undefined && item.hint.trim() !== "",
      ...(misconception === undefined ? {} : { misconceptionWarning: misconception.text }),
    };
  };

  const ask: LearnService["Service"]["ask"] = Effect.fn("LearnService.ask")(function* (input) {
    if (input.items.length === 0)
      return yield* new LearnError({ message: "learn_ask needs at least one item." });
    const itemId = yield* newId("item");
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    const widget: StoredItem["widget"] = input.items.length === 1 ? "check" : "review";
    const stored: StoredItem = { widget, title: input.title ?? "Review", cards: input.items };
    return yield* db.transaction("learn.ask", (sqlite) => {
      for (const item of input.items) {
        const known = sqlite
          .prepare("SELECT 1 FROM learn_concepts WHERE id = ?")
          .get(item.conceptId);
        if (known === undefined) {
          sqlite
            .prepare(
              `INSERT INTO learn_concepts (id, title, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)`,
            )
            .run(item.conceptId, item.conceptId.replaceAll("-", " "), at, at);
        }
      }
      const states: ReadonlyArray<StoredCardState> = input.items.map(() => ({
        status: "open",
        help: "none",
      }));
      sqlite
        .prepare(
          "INSERT INTO learn_items (id, thread_id, widget, payload_json, states_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(itemId, input.threadId, widget, JSON.stringify(stored), JSON.stringify(states), at);
      const cards = input.items.map((item) => toCard(sqlite, item));
      const payload: LearnWidgetPayload =
        widget === "check"
          ? { widget: "check", itemId, card: cards[0]! }
          : { widget: "review", itemId, title: stored.title, cards };
      return { itemId, payload };
    });
  });

  const loadItem = (threadId: ThreadId, itemId: string) =>
    db
      .use(
        "learn.loadItem",
        (sqlite) =>
          sqlite.prepare("SELECT * FROM learn_items WHERE id = ?").get(itemId) as
            | {
                thread_id: string;
                payload_json: string;
                states_json: string;
                widget: string;
                reported_at: string | null;
              }
            | undefined,
      )
      .pipe(
        Effect.flatMap((row) =>
          row === undefined || row.thread_id !== threadId
            ? Effect.fail(new LearnError({ message: "This question belongs to another thread." }))
            : Effect.succeed({
                item: parseJson<StoredItem>(row.payload_json, {
                  widget: "check",
                  title: "",
                  cards: [],
                }),
                states: parseJson<Array<StoredCardState>>(row.states_json, []),
                reported: row.reported_at !== null,
              }),
        ),
      );

  const publicState = ({
    cardBefore: _cardBefore,
    reviewedAt: _reviewedAt,
    ...state
  }: StoredCardState): CardState => state;

  const widgetState: LearnService["Service"]["widgetState"] = Effect.fn("LearnService.widgetState")(
    function* ({ threadId, itemId }) {
      const { states } = yield* loadItem(threadId, itemId);
      const position = states.findIndex((state) => state.status === "open");
      return {
        states: states.map(publicState),
        position: position === -1 ? states.length : position,
      };
    },
  );

  const writeStates = (itemId: string, states: ReadonlyArray<StoredCardState>) =>
    db.use("learn.writeStates", (sqlite) =>
      sqlite
        .prepare("UPDATE learn_items SET states_json = ? WHERE id = ?")
        .run(JSON.stringify(states), itemId),
    );

  const applyRating = (
    sqlite: NodeSqlite.DatabaseSync,
    input: {
      readonly conceptId: string;
      readonly rating: "again" | "hard" | "good" | "easy";
      readonly outcome: Outcome;
      readonly help: Help;
      readonly confidence: Confidence;
      readonly at: Date;
      readonly desiredRetention: number;
      readonly itemId: string | null;
      readonly threadId: string;
      readonly logId: string;
      readonly overridden: boolean;
      readonly cardBefore?: LearnCardState;
      readonly masteryValue: number;
    },
  ) => {
    const row = sqlite
      .prepare("SELECT * FROM learn_cards WHERE concept_id = ?")
      .get(input.conceptId) as CardRow | undefined;
    const before =
      input.cardBefore ??
      parseJson<LearnCardState | null>(row?.card_json, null) ??
      newCard(input.at);
    const scheduled = schedule(before, input.rating, input.at, {
      desiredRetention: input.desiredRetention,
    });
    const prevMastery = row?.mastery ?? 0;
    const mastery = input.overridden ? prevMastery : updateMastery(prevMastery, input.masteryValue);
    const passes = parseJson<Array<number>>(row?.passes_json, []);
    if (input.rating !== "again" && before.lastReview !== null) {
      passes.push((input.at.getTime() - Date.parse(before.lastReview)) / DAY);
    }
    sqlite
      .prepare(
        `INSERT INTO learn_cards (concept_id, card_json, mastery, passes_json, due_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (concept_id) DO UPDATE SET card_json = excluded.card_json, mastery = excluded.mastery,
           passes_json = excluded.passes_json, due_at = excluded.due_at, updated_at = excluded.updated_at`,
      )
      .run(
        input.conceptId,
        JSON.stringify(scheduled.card),
        mastery,
        JSON.stringify(passes.slice(-20)),
        scheduled.card.due,
        input.at.toISOString(),
      );
    sqlite
      .prepare(
        `INSERT INTO learn_review_log (id, concept_id, item_id, thread_id, rating, outcome, help, confidence,
           overridden, reviewed_at, card_before, card_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.logId,
        input.conceptId,
        input.itemId,
        input.threadId,
        input.rating,
        input.outcome,
        input.help,
        input.confidence,
        input.overridden ? 1 : 0,
        input.at.toISOString(),
        JSON.stringify(before),
        JSON.stringify(scheduled.card),
      );
    return { before, after: scheduled.card };
  };

  const intervalLabels = (card: LearnCardState, at: Date, desiredRetention: number) => {
    const preview = previewIntervals(card, at, { desiredRetention });
    return {
      again: preview.again.label,
      hard: preview.hard.label,
      good: preview.good.label,
      easy: preview.easy.label,
    };
  };

  const grade = (
    item: LearnItemInput,
    answer: { readonly text?: string; readonly choice?: number },
  ) => {
    if (item.kind === "choice") {
      const outcome = gradeChoice(answer.choice ?? -1, item.correctIndex ?? -1);
      return { outcome, missing: [] as Array<string>, misconceptionIds: [] as Array<string> };
    }
    if (item.kind === "cloze") {
      const outcome = gradeCloze(answer.text ?? "", { accept: [...(item.accept ?? [])] });
      return { outcome, missing: [] as Array<string>, misconceptionIds: [] as Array<string> };
    }
    const rubric = item.rubric ?? { mustInclude: (item.accept ?? []).map((value) => [value]) };
    const result = gradeShort(answer.text ?? "", {
      mustInclude: rubric.mustInclude.map((group) => [...group]),
      ...(rubric.misconceptions === undefined
        ? {}
        : {
            misconceptions: rubric.misconceptions.map((entry) => ({
              id: entry.id,
              patterns: [...entry.patterns],
            })),
          }),
    });
    return {
      outcome: result.outcome,
      missing: rubric.mustInclude
        .filter(
          (group) =>
            !group.some((word) => (answer.text ?? "").toLowerCase().includes(word.toLowerCase())),
        )
        .map((group) => group[0] ?? "")
        .filter(Boolean),
      misconceptionIds: [...result.misconceptionIds],
    };
  };

  const feedbackFor = (
    outcome: Outcome,
    item: LearnItemInput,
    missing: ReadonlyArray<string>,
    note: string | null,
  ) => {
    if (note !== null) return `Careful: ${note}`;
    if (outcome === "correct") return "Correct.";
    if (outcome === "partial")
      return missing.length > 0
        ? `Partly right. Missing: ${missing.slice(0, 3).join(", ")}.`
        : "Partly right.";
    return item.correctAnswer === undefined
      ? "Not quite."
      : `Not quite. The answer is ${item.correctAnswer}.`;
  };

  const reportIfComplete = Effect.fn("LearnService.reportIfComplete")(function* (
    threadId: ThreadId,
    itemId: string,
    item: StoredItem,
    states: ReadonlyArray<StoredCardState>,
  ) {
    if (states.some((state) => state.status !== "graded")) return;
    const reported = yield* db.use("learn.markReported", (sqlite) => {
      const result = sqlite
        .prepare("UPDATE learn_items SET reported_at = ? WHERE id = ? AND reported_at IS NULL")
        .run(new Date().toISOString(), itemId);
      return result.changes > 0;
    });
    if (!reported) return;
    const lines = states.map((state, index) => {
      const card = item.cards[index];
      const answer =
        state.answer?.text ??
        (state.answer?.choice === undefined ? "" : (card?.options?.[state.answer.choice] ?? ""));
      return `- ${card?.conceptId ?? "?"}: "${(card?.stem ?? "").slice(0, 120)}" → answered "${answer.slice(0, 200)}" (confidence ${state.confidence ?? "?"}, help ${state.help}) → ${state.result?.outcome ?? "?"}, next review ${state.result?.intervals[state.result.rating] ?? "?"}`;
    });
    const text = [
      `[b3 Learn] The learner answered ${item.widget === "check" ? "the question" : `the ${states.length}-card review`} (item ${itemId}). Grades were computed in code:`,
      ...lines,
      "Continue the session: give corrective feedback where needed, then the next step.",
    ].join("\n");
    const project = UNIVERSAL_SPACE_PROJECT_IDS.learn;
    const messageId = yield* uuid;
    const commandId = yield* uuid;
    yield* threads
      .sendToThread({
        projectId: project,
        commandId: CommandId.make(`t3u-learn-answer:${commandId}`),
        threadId,
        messageId: MessageId.make(messageId),
        text,
        attachments: [],
        mode: "auto",
        createdBy: "user",
        creationSource: "server",
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("b3 could not deliver a Learn answer", { cause }),
        ),
      );
  });

  const answer: LearnService["Service"]["answer"] = Effect.fn("LearnService.answer")(
    function* (input) {
      const { item, states } = yield* loadItem(input.threadId, input.itemId);
      const card = item.cards[input.cardIndex];
      const previous = states[input.cardIndex];
      if (card === undefined || previous === undefined)
        return yield* new LearnError({ message: "That card does not exist." });
      if (previous.status === "graded") return publicState(previous);
      const settings = yield* settingsStore.get;
      const at = yield* now;
      const logId = yield* newId("rev");
      const help: Help =
        input.help === "none" && previous.help !== "none" ? previous.help : input.help;
      const graded = grade(card, input.answer);
      const misconception =
        graded.misconceptionIds.length > 0
          ? (card.rubric?.misconceptions?.find((entry) => entry.id === graded.misconceptionIds[0])
              ?.note ?? null)
          : null;
      const mapped = gradeFromAttempt({
        outcome: graded.outcome,
        help,
        confidence: input.confidence,
        structuralMiss: misconception !== null,
      });
      const next = yield* db.transaction("learn.answer", (sqlite) => {
        const applied = applyRating(sqlite, {
          conceptId: card.conceptId,
          rating: mapped.rating,
          outcome: graded.outcome,
          help,
          confidence: input.confidence,
          at,
          desiredRetention: settings.learn.desiredRetention,
          itemId: input.itemId,
          threadId: input.threadId,
          logId,
          overridden: false,
          masteryValue: masteryOutcome({
            outcome: graded.outcome,
            help,
            confidence: input.confidence,
          }),
        });
        if (misconception !== null) {
          sqlite
            .prepare(
              "INSERT INTO learn_misconceptions (id, concept_id, text, created_at) VALUES (?, ?, ?, ?)",
            )
            .run(`${logId}_mis`, card.conceptId, misconception, at.toISOString());
        } else if (graded.outcome === "correct") {
          sqlite
            .prepare(
              "UPDATE learn_misconceptions SET resolved_at = ? WHERE concept_id = ? AND resolved_at IS NULL",
            )
            .run(at.toISOString(), card.conceptId);
        }
        const result: CardResult = {
          outcome: graded.outcome,
          rating: mapped.rating,
          hypercorrection: mapped.hypercorrection,
          feedback: feedbackFor(graded.outcome, card, graded.missing, misconception),
          ...(card.explanation === undefined ? {} : { explanation: card.explanation }),
          ...(card.correctAnswer === undefined || graded.outcome === "correct"
            ? {}
            : { correctAnswer: card.correctAnswer }),
          intervals: intervalLabels(applied.before, at, settings.learn.desiredRetention),
        };
        const state: StoredCardState = {
          status: "graded",
          help,
          ...(previous.hint === undefined ? {} : { hint: previous.hint }),
          answer: input.answer,
          confidence: input.confidence,
          result,
          cardBefore: applied.before,
          reviewedAt: at.toISOString(),
        };
        return state;
      });
      const updated = states.map((state, index) => (index === input.cardIndex ? next : state));
      yield* writeStates(input.itemId, updated);
      yield* reportIfComplete(input.threadId, input.itemId, item, updated);
      return publicState(next);
    },
  );

  const hint: LearnService["Service"]["hint"] = Effect.fn("LearnService.hint")(function* (input) {
    const { item, states } = yield* loadItem(input.threadId, input.itemId);
    const card = item.cards[input.cardIndex];
    const state = states[input.cardIndex];
    const hintText = card?.hint;
    if (card === undefined || state === undefined || hintText === undefined)
      return yield* new LearnError({ message: "No hint for this card." });
    const updated: ReadonlyArray<StoredCardState> = states.map((entry, index) =>
      index === input.cardIndex && entry.status === "open"
        ? { ...entry, help: "hint" as const, hint: hintText }
        : entry,
    );
    yield* writeStates(input.itemId, updated);
    return { hint: hintText };
  });

  const override: LearnService["Service"]["override"] = Effect.fn("LearnService.override")(
    function* (input) {
      const { item, states } = yield* loadItem(input.threadId, input.itemId);
      const card = item.cards[input.cardIndex];
      const state = states[input.cardIndex];
      if (
        card === undefined ||
        state === undefined ||
        state.result === undefined ||
        state.cardBefore === undefined
      )
        return yield* new LearnError({ message: "Grade the card before changing its grade." });
      const settings = yield* settingsStore.get;
      const at = yield* now;
      const logId = yield* newId("rev");
      const before = state.cardBefore;
      yield* db.transaction("learn.override", (sqlite) =>
        applyRating(sqlite, {
          conceptId: card.conceptId,
          rating: input.rating,
          outcome: state.result!.outcome,
          help: state.help,
          confidence: state.confidence ?? "medium",
          at,
          desiredRetention: settings.learn.desiredRetention,
          itemId: input.itemId,
          threadId: input.threadId,
          logId,
          overridden: true,
          cardBefore: before,
          masteryValue: 0,
        }),
      );
      const next: StoredCardState = {
        ...state,
        result: { ...state.result, rating: input.rating, overridden: true },
      };
      yield* writeStates(
        input.itemId,
        states.map((entry, index) => (index === input.cardIndex ? next : entry)),
      );
      return publicState(next);
    },
  );

  const record: LearnService["Service"]["record"] = Effect.fn("LearnService.record")(
    function* (input) {
      const settings = yield* settingsStore.get;
      const at = yield* now;
      const logId = yield* newId("rev");
      const mapped = gradeFromAttempt({
        outcome: input.outcome,
        help: input.help,
        confidence: input.confidence,
        structuralMiss: input.misconception !== undefined,
      });
      const applied = yield* db
        .transaction("learn.record", (sqlite) => {
          const known = sqlite
            .prepare("SELECT 1 FROM learn_concepts WHERE id = ?")
            .get(input.conceptId);
          if (known === undefined)
            throw new Error(`Unknown concept ${input.conceptId}. Add it with learn_plan_set.`);
          if (input.misconception !== undefined) {
            sqlite
              .prepare(
                "INSERT INTO learn_misconceptions (id, concept_id, text, created_at) VALUES (?, ?, ?, ?)",
              )
              .run(`${logId}_mis`, input.conceptId, input.misconception, at.toISOString());
          }
          return applyRating(sqlite, {
            conceptId: input.conceptId,
            rating: mapped.rating,
            outcome: input.outcome,
            help: input.help,
            confidence: input.confidence,
            at,
            desiredRetention: settings.learn.desiredRetention,
            itemId: null,
            threadId: input.threadId,
            logId,
            overridden: false,
            masteryValue: masteryOutcome({
              outcome: input.outcome,
              help: input.help,
              confidence: input.confidence,
            }),
          });
        })
        .pipe(Effect.mapError((error) => new LearnError({ message: error.message })));
      return { dueAt: applied.after.due, rating: mapped.rating };
    },
  );

  const reviewQueue: LearnService["Service"]["reviewQueue"] = Effect.fn("LearnService.reviewQueue")(
    function* ({ limit }) {
      const at = yield* now;
      return yield* db.use("learn.reviewQueue", (sqlite) => {
        const due = sqlite
          .prepare(
            `SELECT c.concept_id, c.card_json, k.title, k.claim FROM learn_cards c
           JOIN learn_concepts k ON k.id = c.concept_id
           WHERE k.status = 'active' AND c.due_at IS NOT NULL AND c.due_at <= ?
           ORDER BY c.due_at LIMIT ?`,
          )
          .all(at.toISOString(), limit) as unknown as ReadonlyArray<{
          concept_id: string;
          card_json: string;
          title: string;
          claim: string | null;
        }>;
        return due.map((row) => {
          const card = parseJson<LearnCardState | null>(row.card_json, null);
          const lines = (
            sqlite
              .prepare(
                "SELECT l.title FROM learn_concept_lines c JOIN learn_lines l ON l.id = c.line_id WHERE c.concept_id = ?",
              )
              .all(row.concept_id) as unknown as ReadonlyArray<{ title: string }>
          ).map((line) => line.title);
          const misconceptions = (
            sqlite
              .prepare(
                "SELECT text FROM learn_misconceptions WHERE concept_id = ? AND resolved_at IS NULL",
              )
              .all(row.concept_id) as unknown as ReadonlyArray<{ text: string }>
          ).map((entry) => entry.text);
          const recent = (
            sqlite
              .prepare(
                `SELECT i.payload_json FROM learn_review_log r JOIN learn_items i ON i.id = r.item_id
               WHERE r.concept_id = ? ORDER BY r.reviewed_at DESC LIMIT 3`,
              )
              .all(row.concept_id) as unknown as ReadonlyArray<{ payload_json: string }>
          ).flatMap((entry) =>
            parseJson<StoredItem>(entry.payload_json, { widget: "check", title: "", cards: [] })
              .cards.filter((card) => card.conceptId === row.concept_id)
              .map((card) => card.stem),
          );
          return {
            conceptId: row.concept_id,
            title: row.title,
            claim: row.claim,
            lines,
            recall: card === null ? null : retrievability(card, at),
            misconceptions,
            recentStems: recent,
          };
        });
      });
    },
  );

  const markTaught: LearnService["Service"]["markTaught"] = Effect.fn("LearnService.markTaught")(
    function* (input) {
      const at = new Date(yield* Clock.currentTimeMillis).toISOString();
      yield* db.use("learn.markTaught", (sqlite) => {
        const insert = sqlite.prepare(
          `INSERT INTO learn_taught (concept_id, thread_id, thread_title, at) VALUES (?, ?, ?, ?)
         ON CONFLICT (concept_id, thread_id) DO UPDATE SET at = excluded.at, thread_title = excluded.thread_title`,
        );
        for (const id of input.conceptIds) insert.run(id, input.threadId, input.threadTitle, at);
      });
    },
  );

  const sessionEnd: LearnService["Service"]["sessionEnd"] = Effect.fn("LearnService.sessionEnd")(
    function* (input) {
      const at = yield* now;
      const itemId = yield* newId("end");
      const shell = yield* threads
        .getThreadShell(input.threadId)
        .pipe(Effect.orElseSucceed(() => null));
      const result = yield* db.transaction("learn.sessionEnd", (sqlite) => {
        const reviews = sqlite
          .prepare(
            `SELECT r.concept_id, r.rating, r.reviewed_at, k.title FROM learn_review_log r
           JOIN learn_concepts k ON k.id = r.concept_id WHERE r.thread_id = ? AND r.overridden = 0 ORDER BY r.reviewed_at`,
          )
          .all(input.threadId) as unknown as ReadonlyArray<{
          concept_id: string;
          rating: string;
          reviewed_at: string;
          title: string;
        }>;
        const touched = [...new Set(reviews.map((row) => row.concept_id))];
        const cards = readCards(sqlite);
        const firstAt = reviews[0]?.reviewed_at;
        const minutes =
          firstAt === undefined
            ? 0
            : Math.max(1, Math.round((at.getTime() - Date.parse(firstAt)) / 60_000));
        const again = touched.filter(
          (id) => reviews.findLast((row) => row.concept_id === id)?.rating === "again",
        );
        const dueTimes = touched
          .map((id) => ({ id, due: cards.get(id)?.due_at ?? null }))
          .filter((entry): entry is { id: string; due: string } => entry.due !== null)
          .sort((a, b) => a.due.localeCompare(b.due));
        const groups = new Map<string, Array<string>>();
        for (const entry of dueTimes) {
          const days = Math.round((Date.parse(entry.due) - at.getTime()) / DAY);
          const when =
            days <= 0
              ? "Today"
              : days === 1
                ? "Tomorrow"
                : days < 7
                  ? `In ${days} days`
                  : days < 21
                    ? `In ${Math.round(days / 7)} weeks`
                    : `In ${Math.round(days / 30)} months`;
          const title = reviews.find((row) => row.concept_id === entry.id)?.title ?? entry.id;
          groups.set(when, [...(groups.get(when) ?? []), title]);
        }
        const titleOf = (id: string) =>
          (
            sqlite.prepare("SELECT title FROM learn_concepts WHERE id = ?").get(id) as
              | { title: string }
              | undefined
          )?.title ?? id;
        for (const id of touched) {
          sqlite
            .prepare(
              `INSERT INTO learn_taught (concept_id, thread_id, thread_title, at) VALUES (?, ?, ?, ?)
             ON CONFLICT (concept_id, thread_id) DO UPDATE SET at = excluded.at`,
            )
            .run(id, input.threadId, shell?.title ?? input.title, at.toISOString());
        }
        const next =
          input.next === undefined
            ? undefined
            : { conceptId: input.next, conceptTitle: titleOf(input.next) };
        const snoozeUntil = dueTimes[0]?.due ?? null;
        const summary: SessionSummary = {
          title: input.title,
          minutes,
          counts: {
            reviewed: touched.length,
            remembered: touched.length - again.length,
            again: again.length,
          },
          diff: [...input.diff],
          stops: touched.map((id) => ({
            conceptTitle: titleOf(id),
            state: again.includes(id) ? ("due" as const) : ("learning" as const),
            line: lineRef(sqlite, id),
            ...(again.includes(id) ? { note: "Again tomorrow" } : {}),
          })),
          schedule: [...groups.entries()].map(([when, concepts]) => ({ when, concepts })),
          ...(next === undefined ? {} : { next }),
          ...(snoozeUntil === null ? {} : { snoozeUntil }),
        };
        const payload: LearnWidgetPayload = { widget: "session-end", itemId, summary };
        sqlite
          .prepare(
            "INSERT INTO learn_items (id, thread_id, widget, payload_json, states_json, created_at) VALUES (?, ?, 'session-end', ?, '[]', ?)",
          )
          .run(itemId, input.threadId, JSON.stringify(summary), at.toISOString());
        return { payload, snoozeUntil };
      });
      if (
        result.snoozeUntil !== null &&
        Date.parse(result.snoozeUntil) > at.getTime() + 3_600_000
      ) {
        const commandId = yield* uuid;
        yield* threads
          .dispatch({
            type: "thread.snooze",
            commandId: CommandId.make(`t3u-learn-snooze:${commandId}`),
            threadId: input.threadId,
            snoozedUntil: result.snoozeUntil,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("b3 could not snooze a Learn thread", { cause }),
            ),
          );
      }
      return { itemId, payload: result.payload, snoozeUntil: result.snoozeUntil };
    },
  );

  const suggest: LearnService["Service"]["suggest"] = Effect.fn("LearnService.suggest")(
    function* (input) {
      const at = new Date(yield* Clock.currentTimeMillis).toISOString();
      const conceptId = slugify(input.title);
      yield* db.transaction("learn.suggest", (sqlite) => {
        sqlite
          .prepare(
            `INSERT OR IGNORE INTO learn_concepts (id, title, status, note, source, created_at, updated_at)
           VALUES (?, ?, 'suggested', ?, 'agent', ?, ?)`,
          )
          .run(conceptId, input.title, input.note ?? null, at, at);
        if (input.topic !== undefined) {
          const lineId = ensureLine(sqlite, input.topic, at);
          sqlite
            .prepare(
              "INSERT OR IGNORE INTO learn_concept_lines (concept_id, line_id) VALUES (?, ?)",
            )
            .run(conceptId, lineId);
        }
      });
      return { conceptId };
    },
  );

  const action: LearnService["Service"]["action"] = Effect.fn("LearnService.action")(
    function* (input) {
      const at = new Date(yield* Clock.currentTimeMillis).toISOString();
      yield* db.transaction("learn.action", (sqlite) => {
        switch (input.action) {
          case "accept_suggestion":
            sqlite
              .prepare("UPDATE learn_concepts SET status = 'active', updated_at = ? WHERE id = ?")
              .run(at, input.id);
            break;
          case "dismiss_suggestion":
            sqlite
              .prepare(
                "UPDATE learn_concepts SET status = 'dismissed', updated_at = ? WHERE id = ?",
              )
              .run(at, input.id);
            break;
          case "reset_concept":
            sqlite.prepare("DELETE FROM learn_cards WHERE concept_id = ?").run(input.id);
            sqlite
              .prepare("UPDATE learn_misconceptions SET resolved_at = ? WHERE concept_id = ?")
              .run(at, input.id);
            break;
          case "delete_line":
            sqlite.prepare("UPDATE learn_lines SET deleted_at = ? WHERE id = ?").run(at, input.id);
            sqlite.prepare("DELETE FROM learn_concept_lines WHERE line_id = ?").run(input.id);
            break;
          case "move_station":
            if (input.position !== undefined) {
              sqlite
                .prepare("UPDATE learn_concepts SET x = ?, y = ? WHERE id = ?")
                .run(input.position.x, input.position.y, input.id);
            }
            break;
        }
      });
    },
  );

  const modelFor = Effect.gen(function* () {
    const settings = yield* settingsStore.get;
    if (settings.learn.tutorModel !== null) return settings.learn.tutorModel;
    const server = yield* serverSettings.getSettings.pipe(Effect.orElseSucceed(() => null));
    const fallback: ModelSelection | null =
      server?.defaultModelSelection ?? server?.textGenerationModelSelection ?? null;
    return fallback;
  });

  const promptFor = (
    input: LearnStartInput,
    titles: ReadonlyArray<string>,
  ): { title: string; text: string } => {
    const ids = input.conceptIds ?? [];
    const list = titles.join(", ");
    switch (input.kind) {
      case "lesson":
        return {
          title: `Lesson: ${titles[0] ?? "new concept"}`,
          text: `Teach me ${list} (concept ${ids.join(", ")}). Follow the session loop: probe first with learn_ask, then teach, practice and schedule.`,
        };
      case "review":
        return {
          title: `Review: ${titles.length} concept${titles.length === 1 ? "" : "s"}`,
          text: `Run a review of ${list || "everything due"}. Call learn_review_next, then send one learn_ask deck with one fresh item per concept. End with learn_session_end.`,
        };
      case "quiz":
        return {
          title: `Quiz: ${titles[0] ?? "mixed"}`,
          text: `Quiz me on ${list || "a mix of my solid concepts"} with learn_ask. Use new phrasings.`,
        };
      case "route":
        return {
          title: `Route to ${titles.at(-1) ?? "goal"}`,
          text: `Take me along this route: ${titles.join(" → ")} (ids ${ids.join(" → ")}). Start at the first stop that is not solid. Probe, teach and practice each stop in order.`,
        };
      case "from_thread":
        return {
          title: `Learn: ${input.text ?? "from a thread"}`,
          text: `Learn this: help me understand the ideas in thread ${input.sourceThreadId ?? ""}${input.text === undefined ? "" : ` ("${input.text}")`}. Read it with t3_thread_read, map the concepts with learn_plan_set (mark what the thread shows I already did), then probe what I actually understand.`,
        };
      case "topic":
        return {
          title: input.text?.slice(0, 60) ?? "New topic",
          text: `I want to understand: ${input.text ?? ""}. Probe what I already know, then plan a short route with learn_plan_set and start teaching.`,
        };
    }
  };

  const start: LearnService["Service"]["start"] = Effect.fn("LearnService.start")(
    function* (input) {
      const selection = yield* modelFor;
      if (selection === null)
        return yield* new LearnError({
          message: "Choose a tutor model in Settings → Learn first.",
        });
      const titles = yield* db.use("learn.titles", (sqlite) =>
        (input.conceptIds ?? []).map(
          (id) =>
            (
              sqlite.prepare("SELECT title FROM learn_concepts WHERE id = ?").get(id) as
                | { title: string }
                | undefined
            )?.title ?? id,
        ),
      );
      const prompt = promptFor(input, titles);
      const commandId = yield* uuid;
      const result = yield* launches
        .launch({
          commandId: CommandId.make(`t3u-learn-start:${commandId}`),
          projectId: UNIVERSAL_SPACE_PROJECT_IDS.learn,
          title: prompt.title,
          modelSelection: selection,
          runtimeMode: "auto-accept-edits",
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          initialMessage: { text: prompt.text, attachments: [] },
          createdBy: "user",
          creationSource: "server",
        })
        .pipe(Effect.mapError((error) => new LearnError({ message: error.message })));
      return { threadId: result.threadId };
    },
  );

  const dueSummary = Effect.gen(function* () {
    const at = yield* now;
    return yield* db.use("learn.dueSummary", (sqlite) => {
      const concepts = sqlite
        .prepare("SELECT COUNT(*) AS count FROM learn_concepts WHERE status = 'active'")
        .get() as {
        count: number;
      };
      const due = sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM learn_cards WHERE due_at IS NOT NULL AND due_at <= ?",
        )
        .get(at.toISOString()) as { count: number };
      const next = sqlite
        .prepare(
          "SELECT MIN(due_at) AS due FROM learn_cards WHERE due_at IS NOT NULL AND due_at > ?",
        )
        .get(at.toISOString()) as { due: string | null };
      return { concepts: concepts.count, due: due.count, nextReviewAt: next.due };
    });
  });

  const widgetAction: LearnService["Service"]["widgetAction"] = Effect.fn(
    "LearnService.widgetAction",
  )(function* (input) {
    const owner = yield* db.use(
      "learn.itemOwner",
      (sqlite) =>
        sqlite
          .prepare("SELECT thread_id, payload_json FROM learn_items WHERE id = ?")
          .get(input.itemId) as { thread_id: string; payload_json: string } | undefined,
    );
    if (owner === undefined || owner.thread_id !== input.threadId)
      return yield* new LearnError({ message: "This card belongs to another thread." });
    if (input.action === "start_concept" && input.conceptId !== undefined) {
      const started = yield* start({ kind: "lesson", conceptIds: [input.conceptId] });
      return { ok: true, message: `Started a lesson (thread ${started.threadId}).` };
    }
    if (input.action === "snooze") {
      const summary = parseJson<SessionSummary | null>(owner.payload_json, null);
      const until =
        summary?.snoozeUntil ?? new Date((yield* Clock.currentTimeMillis) + DAY).toISOString();
      const commandId = yield* uuid;
      yield* threads
        .dispatch({
          type: "thread.snooze",
          commandId: CommandId.make(`t3u-learn-snooze:${commandId}`),
          threadId: input.threadId,
          snoozedUntil: until,
        })
        .pipe(Effect.mapError(() => new LearnError({ message: "Could not snooze this thread." })));
      return { ok: true, message: `Snoozed until ${until}.` };
    }
    return { ok: true };
  });

  return LearnService.of({
    map,
    plan,
    ask,
    widgetState,
    answer,
    hint,
    override,
    record,
    reviewQueue,
    sessionEnd,
    suggest,
    action,
    start,
    markTaught,
    dueSummary,
    widgetAction,
  });
});

export const layer = Layer.effect(LearnService, make);
