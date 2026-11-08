import { UNIVERSAL_SPACE_PROJECT_IDS } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as UniversalDb from "../db/UniversalDb.ts";
import * as Embedder from "../embedder/Embedder.ts";
import * as UniversalSettingsStore from "../UniversalSettingsStore.ts";
import * as MemoryService from "./MemoryService.ts";

const DIMS = 8;

const hashVector = (text: string) => {
  const vector = new Float32Array(DIMS);
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 3) continue;
    let hash = 0;
    for (const character of word) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    vector[hash % DIMS] = (vector[hash % DIMS] ?? 0) + 1;
  }
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum);
  if (length === 0) return vector;
  for (let index = 0; index < DIMS; index += 1) vector[index] = (vector[index] ?? 0) / length;
  return vector;
};

const layerEmbedder = Layer.effect(
  Embedder.Embedder,
  Effect.gen(function* () {
    const status = yield* SubscriptionRef.make<Embedder.EmbedderStatus>({
      modelId: "fake",
      state: "ready",
      dims: DIMS,
    });
    return Embedder.Embedder.of({
      embed: (texts) => Effect.succeed(texts.map(hashVector)),
      status,
      setModel: () => Effect.void,
      benchmark: () =>
        Effect.succeed({ modelId: "fake", texts: 0, totalMs: 0, msPerText: 0, dims: DIMS }),
    });
  }),
);

const layerDeps = Layer.mergeAll(
  UniversalSettingsStore.layer.pipe(
    Layer.provideMerge(UniversalDb.layerMemory),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(SecureRandom.layerWebCrypto),
  ),
  layerEmbedder,
);

const makeLayer = () => MemoryService.layer.pipe(Layer.provideMerge(layerDeps));

const seedThread = (sql: SqlClient.SqlClient, threadId: string, projectId: string, title: string) =>
  sql`INSERT INTO orchestration_v2_projection_threads
      (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json)
      VALUES (${threadId}, ${projectId}, ${title}, 'test', 'auto-accept-edits', 'default',
        '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '{}')`;

const seedMessage = (
  sql: SqlClient.SqlClient,
  input: {
    readonly threadId: string;
    readonly messageId: string;
    readonly text: string;
    readonly updatedAt: string;
    readonly role?: string;
  },
) =>
  sql`INSERT INTO orchestration_v2_projection_messages (message_id, thread_id, role, streaming, created_at, updated_at, payload_json)
      VALUES (${input.messageId}, ${input.threadId}, ${input.role ?? "user"}, 0, ${input.updatedAt}, ${input.updatedAt},
        ${JSON.stringify({ text: input.text })})`;

const expectSaved = (outcome: MemoryService.MemorySaveOutcome) => {
  if (outcome.type !== "saved") {
    throw new Error(
      `Expected a saved memory, got ${outcome.type}${
        outcome.type === "skipped" ? ` (${outcome.reason})` : ""
      }.`,
    );
  }
  return outcome;
};

const expectSkipped = (outcome: MemoryService.MemorySaveOutcome) => {
  if (outcome.type !== "skipped") throw new Error(`Expected a skip, got ${outcome.type}.`);
  return outcome.reason;
};

describe("MemoryService", () => {
  it.effect("search finds a saved memory through FTS and the vector index", () =>
    Effect.gen(function* () {
      const db = yield* UniversalDb.UniversalDb;
      const memory = yield* MemoryService.MemoryService;
      const saved = expectSaved(
        yield* memory.save({
          kind: "fact",
          text: "Bogdan keeps his project notes in Obsidian",
          origin: "saved",
        }),
      );
      yield* memory.embedPending;
      const byWord = yield* memory.search({ query: "obsidian", limit: 5 });
      assert.deepStrictEqual(
        byWord.map((row) => row.id),
        [saved.record.id],
      );
      if (!db.vector.available) return;
      const paraphrase = yield* memory.search({
        query: "recall where the journal lives",
        limit: 5,
      });
      assert.deepStrictEqual(
        paraphrase.map((row) => row.id),
        [saved.record.id],
      );
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("sensitive text is skipped until its category is opted in", () =>
    Effect.gen(function* () {
      const memory = yield* MemoryService.MemoryService;
      const settings = yield* UniversalSettingsStore.UniversalSettingsStore;
      const cardReason = expectSkipped(
        yield* memory.save({
          kind: "fact",
          text: "My card is 4111 1111 1111 1111 for emergencies",
          origin: "saved",
        }),
      );
      assert.strictEqual(cardReason, "credit card number");
      const healthReason = expectSkipped(
        yield* memory.save({
          kind: "fact",
          text: "I take my medication every morning",
          origin: "saved",
        }),
      );
      assert.strictEqual(healthReason, "health is not enabled for memory");
      yield* settings.update({ chat: { sensitiveOptIn: ["health"] } });
      const saved = expectSaved(
        yield* memory.save({
          kind: "fact",
          text: "I take my medication every morning",
          origin: "saved",
        }),
      );
      const current = yield* memory.current;
      assert.deepStrictEqual(
        current.map((row) => row.id),
        [saved.record.id],
      );
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("forget with neverAgain blocks saving the same text", () =>
    Effect.gen(function* () {
      const memory = yield* MemoryService.MemoryService;
      const saved = expectSaved(
        yield* memory.save({
          kind: "preference",
          text: "Bogdan reviews pull requests in the morning",
          origin: "saved",
        }),
      );
      const removed = yield* memory.forget({ id: saved.record.id, neverAgain: true });
      assert.strictEqual(removed, true);
      assert.deepStrictEqual(
        (yield* memory.current).map((row) => row.id),
        [],
      );
      const blocked = expectSkipped(
        yield* memory.save({
          kind: "preference",
          text: "Bogdan reviews pull requests in the morning",
          origin: "saved",
        }),
      );
      assert.strictEqual(blocked, "you asked to never remember this");
      const other = yield* memory.save({
        kind: "preference",
        text: "Bogdan reviews pull requests in the evening",
        origin: "saved",
      });
      assert.strictEqual(other.type, "saved");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("a near-duplicate save supersedes the old memory", () =>
    Effect.gen(function* () {
      const memory = yield* MemoryService.MemoryService;
      const first = expectSaved(
        yield* memory.save({
          kind: "project",
          text: "Bogdan keeps his project notes in Obsidian",
          origin: "saved",
        }),
      );
      const second = expectSaved(
        yield* memory.save({
          kind: "project",
          text: "Bogdan keeps his project notes in Obsidian vault",
          origin: "saved",
        }),
      );
      assert.deepStrictEqual([...second.superseded], [first.record.id]);
      const current = yield* memory.current;
      assert.deepStrictEqual(
        current.map((row) => row.id),
        [second.record.id],
      );
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("nextBatch walks Chat messages and commit advances the cursor once", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const memory = yield* MemoryService.MemoryService;
      yield* seedThread(sql, "thread-chat", UNIVERSAL_SPACE_PROJECT_IDS.chat, "Learning Rust");
      yield* seedThread(sql, "thread-other", "t3u-other-project", "Unrelated");
      yield* seedMessage(sql, {
        threadId: "thread-chat",
        messageId: "msg-1",
        text: "I want to learn async Rust this month",
        updatedAt: "2026-01-01T00:00:01Z",
      });
      yield* seedMessage(sql, {
        threadId: "thread-chat",
        messageId: "msg-2",
        text: "Arc and Mutex confused me at first",
        updatedAt: "2026-01-01T00:00:02Z",
        role: "assistant",
      });
      yield* seedMessage(sql, {
        threadId: "thread-other",
        messageId: "msg-3",
        text: "This belongs to another project",
        updatedAt: "2026-01-01T00:00:03Z",
      });

      const batch = yield* memory.nextBatch({ threadId: null });
      assert.strictEqual(batch.done, false);
      assert.strictEqual(batch.messageCount, 2);
      assert.ok(batch.transcript.includes("msg-1"));
      assert.ok(batch.transcript.includes("msg-2"));
      assert.ok(batch.transcript.includes("Learning Rust"));
      assert.ok(!batch.transcript.includes("msg-3"));

      const commitInput = {
        batchId: batch.batchId ?? "",
        ops: [
          {
            op: "add" as const,
            kind: "fact" as const,
            text: "Bogdan is learning async Rust",
            sourceMessageIds: ["msg-1"],
            confidence: 1,
          },
        ],
        signals: [{ concept: "async Rust", strength: 0.5, sourceMessageIds: ["msg-1"] }],
      };
      const committed = yield* memory.commit(commitInput, { extractorModel: "test-extractor" });
      assert.strictEqual(committed.added, 1);
      assert.strictEqual(committed.signals, 1);
      assert.deepStrictEqual(committed.skipped, []);

      const replay = yield* memory.commit(commitInput, { extractorModel: "test-extractor" });
      assert.strictEqual(replay.added, 0);

      const drained = yield* memory.nextBatch({ threadId: null });
      assert.strictEqual(drained.done, true);

      const current = yield* memory.current;
      assert.strictEqual(current.length, 1);
      assert.strictEqual(current[0]?.sourceThreadTitle, "Learning Rust");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("purge removes every memory", () =>
    Effect.gen(function* () {
      const memory = yield* MemoryService.MemoryService;
      yield* memory.save({ kind: "fact", text: "Bogdan prefers short answers", origin: "saved" });
      yield* memory.save({
        kind: "preference",
        text: "Bogdan dislikes verbose build logs",
        origin: "saved",
      });
      const deleted = yield* memory.purge;
      assert.strictEqual(deleted, 2);
      assert.deepStrictEqual(
        (yield* memory.current).map((row) => row.id),
        [],
      );
      const found = yield* memory.search({ query: "Bogdan", limit: 5 });
      assert.deepStrictEqual(
        found.map((row) => row.id),
        [],
      );
    }).pipe(Effect.provide(makeLayer())),
  );
});
