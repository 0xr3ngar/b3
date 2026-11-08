// @effect-diagnostics globalDate:off globalDateInEffect:off - SQLite rows and the pure memory helpers use ISO strings and Date.
import {
  type MemoryKind,
  type MemoryRecord,
  UNIVERSAL_SPACE_PROJECT_IDS,
  type UniversalSettings,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { formatBatchForExtractor } from "@t3tools/universal-memory/batch";
import { reciprocalRankFusion, withRecency } from "@t3tools/universal-memory/fusion";
import { renderProfile } from "@t3tools/universal-memory/profile";
import {
  isTombstoned,
  matchesTopicRule,
  normalizeForTombstone,
} from "@t3tools/universal-memory/rules";
import type { KnowledgeSignal, MemoryCommitInput, MemoryRow } from "@t3tools/universal-memory/schema";
import { classifySensitive } from "@t3tools/universal-memory/sensitive";
import { planSupersede } from "@t3tools/universal-memory/supersede";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import type * as NodeSqlite from "node:sqlite";

import * as Embedder from "../embedder/Embedder.ts";
import * as UniversalDb from "../db/UniversalDb.ts";
import * as UniversalSettingsStore from "../UniversalSettingsStore.ts";

export class MemoryError extends Schema.TaggedError<MemoryError>()("MemoryError", {
  message: Schema.String,
}) {}

interface MemoryDbRow {
  readonly rowid: number;
  readonly id: string;
  readonly kind: MemoryKind;
  readonly text: string;
  readonly topic: string | null;
  readonly confidence: number;
  readonly origin: "extracted" | "saved" | "edited";
  readonly created_at: string;
  readonly updated_at: string;
  readonly superseded_by: string | null;
  readonly deleted_at: string | null;
  readonly source_thread_id: string | null;
  readonly source_thread_title: string | null;
  readonly source_message_ids: string;
  readonly extractor_model: string | null;
  readonly reason: string | null;
}

const toRecord = (row: MemoryDbRow): MemoryRecord => ({
  id: row.id,
  kind: row.kind,
  text: row.text,
  topic: row.topic,
  confidence: row.confidence,
  origin: row.origin,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  supersededBy: row.superseded_by,
  sourceThreadId: row.source_thread_id,
  sourceThreadTitle: row.source_thread_title,
  sourceMessageIds: parseIds(row.source_message_ids),
  extractorModel: row.extractor_model,
  reason: row.reason,
});

const toPureRow = (row: MemoryDbRow): MemoryRow => ({
  id: row.id,
  kind: row.kind,
  text: row.text,
  topic: row.topic,
  confidence: row.confidence,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  supersededBy: row.superseded_by,
  deletedAt: row.deleted_at,
  source: {
    threadId: row.source_thread_id ?? "",
    messageIds: parseIds(row.source_message_ids),
    extractorModel: row.extractor_model,
  },
  origin: row.origin,
});

const parseIds = (value: string): ReadonlyArray<string> => {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

const CURRENT = "deleted_at IS NULL AND superseded_by IS NULL";
const CURSOR_KEY = "memory.cursor";
const LAST_RUN_KEY = "memory.lastRun";

interface Cursor {
  readonly updatedAt: string;
  readonly messageId: string;
}

interface MessageRow {
  readonly message_id: string;
  readonly thread_id: string;
  readonly title: string;
  readonly role: string;
  readonly text: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MemoryBatch {
  readonly done: boolean;
  readonly batchId: string | null;
  readonly transcript: string;
  readonly messageCount: number;
  readonly allowedSensitiveCategories: ReadonlyArray<string>;
}

export interface MemoryCommitResult {
  readonly added: number;
  readonly superseded: number;
  readonly skipped: ReadonlyArray<{ readonly text: string; readonly reason: string }>;
  readonly signals: number;
}

export interface MemorySaveInput {
  readonly kind: MemoryKind;
  readonly text: string;
  readonly topic?: string | null;
  readonly origin: "saved" | "edited" | "extracted";
  readonly sourceThreadId?: string | null;
  readonly sourceThreadTitle?: string | null;
  readonly sourceMessageIds?: ReadonlyArray<string>;
  readonly extractorModel?: string | null;
  readonly reason?: string | null;
  readonly supersedes?: ReadonlyArray<string>;
  readonly confidence?: number;
  readonly batchId?: string | null;
}

export type MemorySaveOutcome =
  | { readonly type: "saved"; readonly record: MemoryRecord; readonly superseded: ReadonlyArray<string> }
  | { readonly type: "duplicate"; readonly record: MemoryRecord }
  | { readonly type: "skipped"; readonly reason: string };

export class MemoryService extends Context.Service<
  MemoryService,
  {
    readonly list: (input: {
      readonly query?: string;
      readonly kind?: MemoryKind;
      readonly limit: number;
      readonly offset: number;
    }) => Effect.Effect<
      { readonly rows: ReadonlyArray<MemoryRecord>; readonly total: number },
      UniversalDb.UniversalDbError
    >;
    readonly search: (input: {
      readonly query: string;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<MemoryRecord>, UniversalDb.UniversalDbError>;
    readonly save: (
      input: MemorySaveInput,
    ) => Effect.Effect<MemorySaveOutcome, UniversalDb.UniversalDbError>;
    readonly edit: (input: {
      readonly id: string;
      readonly kind: MemoryKind;
      readonly text: string;
      readonly topic?: string | null;
    }) => Effect.Effect<MemoryRecord, UniversalDb.UniversalDbError | MemoryError>;
    readonly forget: (input: {
      readonly id: string;
      readonly neverAgain: boolean;
    }) => Effect.Effect<boolean, UniversalDb.UniversalDbError>;
    readonly purge: Effect.Effect<number, UniversalDb.UniversalDbError>;
    readonly current: Effect.Effect<ReadonlyArray<MemoryRecord>, UniversalDb.UniversalDbError>;
    readonly profile: Effect.Effect<string, UniversalDb.UniversalDbError>;
    readonly nextBatch: (input: {
      readonly threadId: string | null;
    }) => Effect.Effect<MemoryBatch, UniversalDb.UniversalDbError | MemoryError>;
    readonly commit: (
      input: MemoryCommitInput,
      context: { readonly extractorModel: string | null },
    ) => Effect.Effect<MemoryCommitResult, UniversalDb.UniversalDbError | MemoryError>;
    readonly pendingMessages: Effect.Effect<number>;
    readonly stats: Effect.Effect<
      {
        readonly count: number;
        readonly embedded: number;
        readonly lastRunAt: string | null;
        readonly lastRunError: string | null;
        readonly lastRunTokens: number | null;
      },
      UniversalDb.UniversalDbError
    >;
    readonly recordRun: (run: {
      readonly error: string | null;
      readonly tokens: number | null;
    }) => Effect.Effect<void, UniversalDb.UniversalDbError>;
    readonly takeSignals: Effect.Effect<
      ReadonlyArray<KnowledgeSignal & { readonly id: string }>,
      UniversalDb.UniversalDbError
    >;
    readonly reembedAll: Effect.Effect<void, UniversalDb.UniversalDbError>;
    readonly embedPending: Effect.Effect<void>;
    /** Fires after any change to the current memory set. */
    readonly changes: Stream.Stream<void>;
  }
>()("t3/universal/memory/MemoryService") {}

const ftsQuery = (query: string) => {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3)
    .slice(0, 12);
  return words.length === 0 ? null : words.map((word) => `"${word.replaceAll('"', "")}"`).join(" OR ");
};

const tokenJaccard = (a: string, b: string) => {
  const left = new Set(normalizeForTombstone(a).split(" ").filter(Boolean));
  const right = new Set(normalizeForTombstone(b).split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
};

const vectorBlob = (vector: Float32Array) =>
  new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);

const make = Effect.gen(function* () {
  const db = yield* UniversalDb.UniversalDb;
  const settingsStore = yield* UniversalSettingsStore.UniversalSettingsStore;
  const embedder = yield* Embedder.Embedder;
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const changesHub = yield* PubSub.unbounded<void>();
  const embedLock = yield* Semaphore.make(1);
  let vectorDims: number | null = null;

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const newId = (prefix: string) =>
    random.uuidV4().pipe(
      Effect.map((uuid) => `${prefix}_${uuid.replaceAll("-", "").slice(0, 20)}`),
      Effect.orDie,
    );
  const notify = PubSub.publish(changesHub, undefined).pipe(Effect.asVoid);

  const readRows = (sqlite: NodeSqlite.DatabaseSync, where: string, ...params: Array<string | number>) =>
    sqlite
      .prepare(`SELECT rowid, * FROM memories WHERE ${where}`)
      .all(...params) as unknown as ReadonlyArray<MemoryDbRow>;

  const ensureVectorInit = (sqlite: NodeSqlite.DatabaseSync, dims: number) => {
    if (!db.vector.available || vectorDims === dims) return db.vector.available;
    sqlite
      .prepare("SELECT vector_init('memories', 'embedding', ?)")
      .get(`type=FLOAT32,dimension=${dims},distance=COSINE`);
    vectorDims = dims;
    return true;
  };

  const ftsSearch = (sqlite: NodeSqlite.DatabaseSync, query: string, limit: number) => {
    const match = ftsQuery(query);
    if (match === null) {
      return readRows(
        sqlite,
        `${CURRENT} AND text LIKE ? ORDER BY updated_at DESC LIMIT ?`,
        `%${query}%`,
        limit,
      );
    }
    return sqlite
      .prepare(
        `SELECT m.rowid, m.* FROM memories_fts f JOIN memories m ON m.rowid = f.rowid
         WHERE memories_fts MATCH ? AND m.deleted_at IS NULL AND m.superseded_by IS NULL
         ORDER BY bm25(memories_fts) LIMIT ?`,
      )
      .all(match, limit) as unknown as ReadonlyArray<MemoryDbRow>;
  };

  const vectorNeighbours = (
    sqlite: NodeSqlite.DatabaseSync,
    vector: Float32Array,
    embedderId: string,
    limit: number,
  ): ReadonlyArray<MemoryDbRow & { readonly distance: number }> => {
    if (!ensureVectorInit(sqlite, vector.length)) return [];
    // node:sqlite binds JS numbers as REAL; the extension requires an INTEGER limit.
    return sqlite
      .prepare(
        `SELECT m.rowid, m.*, v.distance AS distance
         FROM vector_full_scan('memories', 'embedding', ?, ${limit * 3}) v
         JOIN memories m ON m.rowid = v.rowid
         WHERE m.deleted_at IS NULL AND m.superseded_by IS NULL AND m.embedder_id = ?
         ORDER BY v.distance`,
      )
      .all(vectorBlob(vector), embedderId) as unknown as ReadonlyArray<
      MemoryDbRow & { readonly distance: number }
    >;
  };

  const embedOne = (text: string, kind: "query" | "doc") =>
    embedder.embed([text], kind).pipe(
      Effect.map((vectors) => vectors[0] ?? null),
      Effect.timeout("20 seconds"),
      Effect.orElseSucceed(() => null),
    );

  const search: MemoryService["Service"]["search"] = Effect.fn("MemoryService.search")(function* ({
    query,
    limit,
  }) {
    const settings = yield* settingsStore.get;
    const vector = db.vector.available ? yield* embedOne(query, "query") : null;
    const now = yield* Clock.currentTimeMillis;
    return yield* db.use("memory.search", (sqlite) => {
      const fts = ftsSearch(sqlite, query, limit * 3);
      let semantic: ReadonlyArray<MemoryDbRow> = [];
      if (vector !== null) {
        try {
          semantic = vectorNeighbours(sqlite, vector, settings.chat.embedderId, limit);
        } catch {
          semantic = [];
        }
      }
      const byId = new Map<string, MemoryDbRow>();
      for (const row of [...fts, ...semantic]) byId.set(row.id, row);
      const fused = withRecency(
        reciprocalRankFusion([
          fts.map((row) => ({ id: row.id })),
          semantic.map((row) => ({ id: row.id })),
        ]),
        new Map([...byId.values()].map((row) => [row.id, { updatedAt: row.updated_at }])),
        new Date(now).toISOString(),
      );
      return fused
        .slice(0, limit)
        .map((entry) => byId.get(entry.id))
        .filter((row): row is MemoryDbRow => row !== undefined)
        .map(toRecord);
    });
  });

  const list: MemoryService["Service"]["list"] = Effect.fn("MemoryService.list")(function* (input) {
    if (input.query !== undefined && input.query.trim().length > 0) {
      const rows = yield* search({ query: input.query, limit: input.limit + input.offset });
      const filtered = input.kind === undefined ? rows : rows.filter((row) => row.kind === input.kind);
      return { rows: filtered.slice(input.offset), total: filtered.length };
    }
    return yield* db.use("memory.list", (sqlite) => {
      const kindClause = input.kind === undefined ? "" : " AND kind = ?";
      const params = input.kind === undefined ? [] : [input.kind];
      const rows = readRows(
        sqlite,
        `${CURRENT}${kindClause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        ...params,
        input.limit,
        input.offset,
      );
      const total = sqlite
        .prepare(`SELECT COUNT(*) AS count FROM memories WHERE ${CURRENT}${kindClause}`)
        .get(...params) as { count: number };
      return { rows: rows.map(toRecord), total: total.count };
    });
  });

  const current = db.use("memory.current", (sqlite) =>
    readRows(sqlite, `${CURRENT} ORDER BY updated_at DESC`).map(toRecord),
  );

  const gate = (text: string, settings: UniversalSettings, tombstones: ReadonlyArray<{ normalized: string }>) => {
    const sensitive = classifySensitive(text);
    if (sensitive.blocked) return sensitive.reason ?? "sensitive";
    if (
      sensitive.optInCategory !== undefined &&
      !settings.chat.sensitiveOptIn.includes(sensitive.optInCategory)
    )
      return `${sensitive.optInCategory} is not enabled for memory`;
    const rules = settings.chat.topicRules.map((rule) => ({ ...rule, keywords: [...rule.keywords] }));
    if (matchesTopicRule(text, rules).length > 0) return "topic rule";
    if (isTombstoned(text, [...tombstones])) return "you asked to never remember this";
    return null;
  };

  const insertSaved = Effect.fn("MemoryService.insertSaved")(function* (
    input: MemorySaveInput,
    settings: UniversalSettings,
  ) {
    const trimmed = input.text.trim();
    if (trimmed.length === 0) return { type: "skipped", reason: "empty" } as const;
    const text = trimmed.slice(0, 500);
    const tombstones = yield* db.use(
      "memory.tombstones",
      (sqlite) =>
        sqlite.prepare("SELECT normalized FROM memory_tombstones").all() as unknown as ReadonlyArray<{
          normalized: string;
        }>,
    );
    const blocked = gate(text, settings, tombstones);
    if (blocked !== null) return { type: "skipped", reason: blocked } as const;
    const vector = db.vector.available ? yield* embedOne(text, "doc") : null;
    const id = yield* newId("mem");
    const at = yield* nowIso;
    const outcome = yield* db.transaction("memory.save", (sqlite): MemorySaveOutcome => {
      const sameKind = readRows(sqlite, `${CURRENT} AND kind = ?`, input.kind);
      const similarities = new Map<string, number>();
      if (vector !== null) {
        try {
          for (const row of vectorNeighbours(sqlite, vector, settings.chat.embedderId, 8)) {
            similarities.set(row.id, 1 - row.distance);
          }
        } catch {
          // Similarity falls back to token overlap below.
        }
      }
      const byText = new Map(
        sameKind.map((row) => [row.text, similarities.get(row.id)] as const),
      );
      const plan = planSupersede(
        { kind: input.kind, text },
        sameKind.map(toPureRow),
        (a, b) => byText.get(b) ?? tokenJaccard(a, b),
      );
      if (plan.duplicateOf !== undefined) {
        const existing = readRows(sqlite, "id = ?", plan.duplicateOf)[0];
        if (existing !== undefined) return { type: "duplicate", record: toRecord(existing) };
      }
      const explicit = (input.supersedes ?? []).filter(
        (candidate) => readRows(sqlite, `${CURRENT} AND id = ?`, candidate).length > 0,
      );
      const superseded = [...new Set([...plan.supersedeIds, ...explicit])];
      sqlite
        .prepare(
          `INSERT INTO memories (id, kind, text, topic, confidence, origin, created_at, updated_at,
             source_thread_id, source_thread_title, source_message_ids, extractor_model, reason, batch_id,
             embedder_id, embedding)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.kind,
          text,
          input.topic ?? null,
          input.confidence ?? 1,
          input.origin,
          at,
          at,
          input.sourceThreadId ?? null,
          input.sourceThreadTitle ?? null,
          JSON.stringify(input.sourceMessageIds ?? []),
          input.extractorModel ?? null,
          input.reason ?? null,
          input.batchId ?? null,
          vector === null ? null : settings.chat.embedderId,
          vector === null ? null : vectorBlob(vector),
        );
      const close = sqlite.prepare(
        `UPDATE memories SET superseded_by = ?, updated_at = ? WHERE id = ? AND ${CURRENT}`,
      );
      for (const old of superseded) close.run(id, at, old);
      const record = readRows(sqlite, "id = ?", id)[0];
      if (record === undefined) throw new Error("The saved memory could not be read back.");
      return { type: "saved", record: toRecord(record), superseded };
    });
    return outcome;
  });

  const embedPending: MemoryService["Service"]["embedPending"] = embedLock
    .withPermits(1)(
      Effect.gen(function* () {
        if (!db.vector.available) return;
        const settings = yield* settingsStore.get;
        const embedderId = settings.chat.embedderId;
        for (let round = 0; round < 100; round++) {
          const pending = yield* db.use(
            "memory.pendingEmbeddings",
            (sqlite) =>
              sqlite
                .prepare(
                  `SELECT id, text FROM memories WHERE ${CURRENT} AND (embedder_id IS NULL OR embedder_id != ?) LIMIT 16`,
                )
                .all(embedderId) as unknown as ReadonlyArray<{ id: string; text: string }>,
          );
          if (pending.length === 0) return;
          const vectors = yield* embedder.embed(
            pending.map((row) => row.text),
            "doc",
          );
          yield* db.transaction("memory.writeEmbeddings", (sqlite) => {
            const write = sqlite.prepare(
              "UPDATE memories SET embedding = ?, embedder_id = ? WHERE id = ?",
            );
            pending.forEach((row, index) => {
              const vector = vectors[index];
              if (vector !== undefined) write.run(vectorBlob(vector), embedderId, row.id);
            });
          });
        }
      }),
    )
    .pipe(
      Effect.catchCause((cause) => Effect.logWarning("b3 memory embedding paused", { cause })),
      Effect.withSpan("MemoryService.embedPending"),
    );

  const afterChange = Effect.andThen(notify, Effect.forkDetach(embedPending)).pipe(Effect.asVoid);

  const save: MemoryService["Service"]["save"] = Effect.fn("MemoryService.save")(function* (input) {
    const settings = yield* settingsStore.get;
    const outcome = yield* insertSaved(input, settings);
    if (outcome.type === "saved") yield* afterChange;
    return outcome;
  });

  const edit: MemoryService["Service"]["edit"] = Effect.fn("MemoryService.edit")(function* (input) {
    const at = yield* nowIso;
    const record = yield* db.transaction("memory.edit", (sqlite) => {
      sqlite
        .prepare(
          `UPDATE memories SET kind = ?, text = ?, topic = ?, origin = 'edited', updated_at = ?,
             embedding = NULL, embedder_id = NULL WHERE id = ? AND ${CURRENT}`,
        )
        .run(input.kind, input.text.trim().slice(0, 500), input.topic ?? null, at, input.id);
      return readRows(sqlite, "id = ?", input.id)[0];
    });
    if (record === undefined) return yield* new MemoryError({ message: "That memory no longer exists." });
    yield* afterChange;
    return toRecord(record);
  });

  const forget: MemoryService["Service"]["forget"] = Effect.fn("MemoryService.forget")(function* ({
    id,
    neverAgain,
  }) {
    const at = yield* nowIso;
    const tombstoneId = yield* newId("tomb");
    const removed = yield* db.transaction("memory.forget", (sqlite) => {
      const row = readRows(sqlite, "id = ? AND deleted_at IS NULL", id)[0];
      if (row === undefined) return false;
      sqlite.prepare("UPDATE memories SET deleted_at = ?, embedding = NULL WHERE id = ?").run(at, id);
      if (neverAgain) {
        sqlite
          .prepare("INSERT INTO memory_tombstones (id, normalized, created_at) VALUES (?, ?, ?)")
          .run(tombstoneId, normalizeForTombstone(row.text), at);
      }
      return true;
    });
    if (removed) yield* notify;
    return removed;
  });

  const purge = db
    .transaction("memory.purge", (sqlite) => {
      const count = sqlite.prepare("SELECT COUNT(*) AS count FROM memories").get() as {
        count: number;
      };
      sqlite.exec(
        "DELETE FROM memories; DELETE FROM memory_signals; DELETE FROM memory_batches; INSERT INTO memories_fts (memories_fts) VALUES ('rebuild');",
      );
      return count.count;
    })
    .pipe(Effect.tap(() => notify));

  const profile = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const rows = yield* db.use("memory.profileRows", (sqlite) =>
      readRows(sqlite, `${CURRENT} ORDER BY updated_at DESC`),
    );
    return renderProfile(rows.map(toPureRow), { now: new Date(now).toISOString() });
  });

  const readCursor = db.use("memory.cursor", (sqlite) => {
    const row = sqlite.prepare("SELECT value FROM kv WHERE key = ?").get(CURSOR_KEY) as
      | { value: string }
      | undefined;
    if (row === undefined) return { updatedAt: "", messageId: "" } satisfies Cursor;
    try {
      return JSON.parse(row.value) as Cursor;
    } catch {
      return { updatedAt: "", messageId: "" } satisfies Cursor;
    }
  });

  const readMessagesAfter = (cursor: Cursor, limit: number) =>
    sql<MessageRow>`
      SELECT m.message_id, m.thread_id, t.title, m.role,
        json_extract(m.payload_json, '$.text') AS text, m.created_at, m.updated_at
      FROM orchestration_v2_projection_messages m
      JOIN orchestration_v2_projection_threads t ON t.thread_id = m.thread_id
      WHERE t.project_id = ${UNIVERSAL_SPACE_PROJECT_IDS.chat}
        AND t.deleted_at IS NULL
        AND m.streaming = 0
        AND m.role IN ('user', 'assistant')
        AND (m.updated_at > ${cursor.updatedAt}
          OR (m.updated_at = ${cursor.updatedAt} AND m.message_id > ${cursor.messageId}))
      ORDER BY m.updated_at, m.message_id
      LIMIT ${limit}
    `.pipe(NodeSqliteClient.readOnly);

  const nextBatch: MemoryService["Service"]["nextBatch"] = Effect.fn("MemoryService.nextBatch")(
    function* ({ threadId }) {
      const settings = yield* settingsStore.get;
      const empty: MemoryBatch = {
        done: true,
        batchId: null,
        transcript: "",
        messageCount: 0,
        allowedSensitiveCategories: settings.chat.sensitiveOptIn,
      };
      if (!settings.chat.memoryEnabled) return empty;
      const cursor = yield* readCursor;
      const rows = yield* readMessagesAfter(cursor, 200).pipe(
        Effect.mapError(() => new MemoryError({ message: "Chat messages could not be read." })),
      );
      const usable = rows.filter((row) => typeof row.text === "string" && row.text.trim() !== "");
      const last = rows.at(-1);
      if (usable.length === 0) {
        if (last !== undefined) yield* writeCursor({ updatedAt: last.updated_at, messageId: last.message_id });
        return empty;
      }
      const transcript = formatBatchForExtractor(
        usable.map((row) => ({
          id: row.message_id,
          threadId: row.thread_id,
          threadTitle: row.title,
          role: row.role,
          text: row.text ?? "",
          createdAt: row.created_at,
        })),
      );
      const includedCount = transcript.match(/\[m:/g)?.length ?? 0;
      const included = usable.slice(0, Math.max(1, includedCount));
      const header = `Allowed opt-in categories: ${
        settings.chat.sensitiveOptIn.length === 0 ? "none" : settings.chat.sensitiveOptIn.join(", ")
      }\n\n`;
      const end = included.at(-1) ?? usable[0]!;
      const batchId = yield* newId("batch");
      const at = yield* nowIso;
      yield* db.use("memory.batch", (sqlite) =>
        sqlite
          .prepare(
            `INSERT INTO memory_batches (id, created_at, thread_id, cursor_from, cursor_to, message_count, messages_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            batchId,
            at,
            threadId,
            JSON.stringify(cursor),
            JSON.stringify({ updatedAt: end.updated_at, messageId: end.message_id }),
            included.length,
            JSON.stringify(
              Object.fromEntries(
                included.map((row) => [row.message_id, { threadId: row.thread_id, title: row.title }]),
              ),
            ),
          ),
      );
      return {
        done: false,
        batchId,
        transcript: `${header}${transcript}`,
        messageCount: included.length,
        allowedSensitiveCategories: settings.chat.sensitiveOptIn,
      } satisfies MemoryBatch;
    },
  );

  const writeCursor = (cursor: Cursor) =>
    db.use("memory.writeCursor", (sqlite) =>
      sqlite
        .prepare(
          "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        )
        .run(CURSOR_KEY, JSON.stringify(cursor)),
    );

  const commit: MemoryService["Service"]["commit"] = Effect.fn("MemoryService.commit")(function* (
    input,
    context,
  ) {
    const batch = yield* db.use(
      "memory.readBatch",
      (sqlite) =>
        sqlite.prepare("SELECT * FROM memory_batches WHERE id = ?").get(input.batchId) as
          | {
              cursor_to: string;
              committed_at: string | null;
              thread_id: string | null;
              messages_json: string;
            }
          | undefined,
    );
    if (batch === undefined)
      return yield* new MemoryError({ message: "Unknown batchId. Call memory_next_batch first." });
    if (batch.committed_at !== null) return { added: 0, superseded: 0, skipped: [], signals: 0 };
    const settings = yield* settingsStore.get;
    const sources = (() => {
      try {
        return JSON.parse(batch.messages_json) as Record<
          string,
          { readonly threadId: string; readonly title: string }
        >;
      } catch {
        return {};
      }
    })();
    let added = 0;
    let superseded = 0;
    const skipped: Array<{ text: string; reason: string }> = [];
    for (const op of input.ops) {
      const outcome = yield* insertSaved(
        {
          kind: op.kind,
          text: op.text,
          topic: op.topic ?? null,
          origin: "extracted",
          sourceMessageIds: op.sourceMessageIds,
          extractorModel: context.extractorModel,
          confidence: op.confidence,
          ...(op.supersedes === undefined ? {} : { supersedes: op.supersedes }),
          batchId: input.batchId,
          sourceThreadId: sources[op.sourceMessageIds[0] ?? ""]?.threadId ?? null,
          sourceThreadTitle: sources[op.sourceMessageIds[0] ?? ""]?.title ?? null,
        },
        settings,
      );
      if (outcome.type === "saved") {
        added++;
        superseded += outcome.superseded.length;
      } else if (outcome.type === "skipped") {
        skipped.push({ text: op.text.slice(0, 80), reason: outcome.reason });
      }
    }
    const at = yield* nowIso;
    const signalIds = yield* Effect.forEach(input.signals, () => newId("sig"));
    yield* db.transaction("memory.commitBatch", (sqlite) => {
      const insertSignal = sqlite.prepare(
        `INSERT INTO memory_signals (id, concept, topic, strength, source_message_ids, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      if (settings.chat.learnSignals) {
        input.signals.forEach((signal, index) =>
          insertSignal.run(
            signalIds[index] ?? `sig_${index}`,
            signal.concept,
            signal.topic ?? null,
            signal.strength,
            JSON.stringify(signal.sourceMessageIds),
            at,
          ),
        );
      }
      sqlite
        .prepare("UPDATE memory_batches SET committed_at = ?, ops_added = ? WHERE id = ?")
        .run(at, added, input.batchId);
      sqlite
        .prepare(
          "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        )
        .run(CURSOR_KEY, batch.cursor_to);
    });
    if (added > 0) yield* afterChange;
    return { added, superseded, skipped, signals: input.signals.length };
  });

  const pendingMessages = Effect.gen(function* () {
    const cursor = yield* readCursor;
    const rows = yield* readMessagesAfter(cursor, 500);
    return rows.length;
  }).pipe(Effect.orElseSucceed(() => 0));

  const stats = db.use("memory.stats", (sqlite) => {
    const count = sqlite.prepare(`SELECT COUNT(*) AS count FROM memories WHERE ${CURRENT}`).get() as {
      count: number;
    };
    const embedded = sqlite
      .prepare(`SELECT COUNT(*) AS count FROM memories WHERE ${CURRENT} AND embedding IS NOT NULL`)
      .get() as { count: number };
    const lastRun = sqlite.prepare("SELECT value FROM kv WHERE key = ?").get(LAST_RUN_KEY) as
      | { value: string }
      | undefined;
    let parsed: { at?: string; error?: string | null; tokens?: number | null } = {};
    try {
      parsed = lastRun === undefined ? {} : (JSON.parse(lastRun.value) as typeof parsed);
    } catch {
      parsed = {};
    }
    return {
      count: count.count,
      embedded: embedded.count,
      lastRunAt: parsed.at ?? null,
      lastRunError: parsed.error ?? null,
      lastRunTokens: parsed.tokens ?? null,
    };
  });

  const recordRun: MemoryService["Service"]["recordRun"] = (run) =>
    Effect.flatMap(nowIso, (at) =>
      db.use("memory.recordRun", (sqlite) =>
        sqlite
          .prepare(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
          )
          .run(LAST_RUN_KEY, JSON.stringify({ at, ...run })),
      ),
    ).pipe(Effect.asVoid);

  const takeSignals = Effect.flatMap(nowIso, (at) =>
    db.transaction("memory.takeSignals", (sqlite) => {
      const rows = sqlite
        .prepare("SELECT * FROM memory_signals WHERE consumed_at IS NULL ORDER BY created_at LIMIT 50")
        .all() as unknown as ReadonlyArray<{
        id: string;
        concept: string;
        topic: string | null;
        strength: number;
        source_message_ids: string;
      }>;
      const mark = sqlite.prepare("UPDATE memory_signals SET consumed_at = ? WHERE id = ?");
      for (const row of rows) mark.run(at, row.id);
      return rows.map((row) => ({
        id: row.id,
        concept: row.concept,
        ...(row.topic === null ? {} : { topic: row.topic }),
        strength: row.strength,
        sourceMessageIds: [...parseIds(row.source_message_ids)],
      }));
    }),
  );

  const reembedAll = db
    .use("memory.clearEmbeddings", (sqlite) => {
      sqlite.exec("UPDATE memories SET embedding = NULL, embedder_id = NULL");
      vectorDims = null;
    })
    .pipe(Effect.andThen(Effect.forkDetach(embedPending)), Effect.asVoid);

  return MemoryService.of({
    list,
    search,
    save,
    edit,
    forget,
    purge,
    current,
    profile,
    nextBatch,
    commit,
    pendingMessages,
    stats,
    recordRun,
    takeSignals,
    reembedAll,
    embedPending,
    changes: Stream.fromPubSub(changesHub),
  });
});

export const layer = Layer.effect(MemoryService, make);
