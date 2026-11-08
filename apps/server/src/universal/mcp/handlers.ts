import { CommandId, OrchestratorMcpFailure, UNIVERSAL_SYSTEM_THREAD_TAG } from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as LearnService from "../learn/LearnService.ts";
import * as MemoryService from "../memory/MemoryService.ts";
import * as UniversalWidgetPublisher from "../UniversalWidgetPublisher.ts";
import {
  ExtractionToolkit,
  LearnToolkit,
  MemorySearchToolkit,
  MemoryWriteToolkit,
} from "./tools.ts";

const failure = (error: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

const callerThread = (operation: string) =>
  McpInvocationContext.McpInvocationContext.pipe(
    Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, operation)),
    Effect.map((scope) => scope.thread),
  );

export const layerMemorySearch = McpToolAccess.toLayer(MemorySearchToolkit, {
  memory_search: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const memory = yield* MemoryService.MemoryService;
      const rows = yield* memory
        .search({ query: input.query, limit: input.limit ?? 8 })
        .pipe(Effect.mapError(failure));
      return {
        memories: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          text: row.text,
          topic: row.topic,
          since: row.createdAt.slice(0, 10),
        })),
      };
    }),
  ),
});

export const layerMemoryWrite = McpToolAccess.toLayer(MemoryWriteToolkit, {
  memory_save: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const thread = yield* callerThread("memory_save");
      const memory = yield* MemoryService.MemoryService;
      const outcome = yield* memory
        .save({
          kind: input.kind ?? "fact",
          text: input.text,
          ...(input.topic === undefined ? {} : { topic: input.topic }),
          origin: "saved",
          sourceThreadId: thread.threadId,
        })
        .pipe(Effect.mapError(failure));
      switch (outcome.type) {
        case "saved":
          return { saved: true, id: outcome.record.id, replaced: [...outcome.superseded], reason: null };
        case "duplicate":
          return { saved: false, id: outcome.record.id, replaced: [], reason: "already remembered" };
        case "skipped":
          return { saved: false, id: null, replaced: [], reason: outcome.reason };
      }
    }),
  ),
  memory_forget: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const memory = yield* MemoryService.MemoryService;
      const forgotten = yield* memory
        .forget({ id: input.memoryId, neverAgain: input.neverAgain ?? false })
        .pipe(Effect.mapError(failure));
      return { forgotten };
    }),
  ),
});

/** The extraction agent's own thread is hidden the first time it asks for work. */
const tagSystemThread = Effect.gen(function* () {
  const thread = yield* callerThread("memory_next_batch");
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const random = yield* SecureRandom.SecureRandom;
  const shell = yield* threads.getThreadShell(thread.threadId).pipe(Effect.orElseSucceed(() => null));
  if (shell === null || (shell.tags ?? []).includes(UNIVERSAL_SYSTEM_THREAD_TAG)) return thread;
  const id = yield* random.uuidV4().pipe(Effect.orDie);
  yield* threads
    .dispatch({
      type: "thread.tag.set",
      commandId: CommandId.make(`t3u-system-tag:${id}`),
      threadId: thread.threadId,
      tag: UNIVERSAL_SYSTEM_THREAD_TAG,
      tagged: true,
    })
    .pipe(Effect.ignore);
  return thread;
});

export const layerExtraction = McpToolAccess.toLayer(ExtractionToolkit, {
  memory_next_batch: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const thread = yield* tagSystemThread;
      const memory = yield* MemoryService.MemoryService;
      const batch = yield* memory.nextBatch({ threadId: thread.threadId }).pipe(Effect.mapError(failure));
      return {
        done: batch.done,
        batchId: batch.batchId,
        messageCount: batch.messageCount,
        allowedSensitiveCategories: [...batch.allowedSensitiveCategories],
        transcript: batch.transcript,
      };
    }),
  ),
  memory_commit: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const thread = yield* callerThread("memory_commit");
      const memory = yield* MemoryService.MemoryService;
      const result = yield* memory
        .commit(
          {
            batchId: input.batchId,
            ops: input.ops.map((op) => ({
              op: "add" as const,
              kind: op.kind,
              text: op.text,
              sourceMessageIds: [...op.sourceMessageIds],
              confidence: op.confidence,
              ...(op.supersedes === undefined ? {} : { supersedes: [...op.supersedes] }),
              ...(op.topic === undefined ? {} : { topic: op.topic }),
            })),
            signals: input.signals.map((signal) => ({
              concept: signal.concept,
              ...(signal.topic === undefined ? {} : { topic: signal.topic }),
              strength: signal.strength,
              sourceMessageIds: [...signal.sourceMessageIds],
            })),
          },
          { extractorModel: thread.providerInstanceId },
        )
        .pipe(Effect.mapError(failure));
      return { ...result, skipped: [...result.skipped] };
    }),
  ),
});

const widgetUnavailable = () =>
  new OrchestratorMcpFailure({
    code: "orchestration_error",
    message: "The Learn widget could not be published.",
  });

export const layerLearn = McpToolAccess.toLayer(LearnToolkit, {
  learn_map_read: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const learn = yield* LearnService.LearnService;
      const map = yield* learn.map.pipe(Effect.mapError(failure));
      return {
        here: map.here,
        lines: map.lines.map((line) => ({ id: line.id, title: line.title })),
        concepts: map.stations.map((station) => ({
          id: station.id,
          title: station.title,
          lines: [...station.lineIds],
          state: station.state,
          recall: station.recall === null ? null : Math.round(station.recall * 100) / 100,
          misconception: station.misconception,
        })),
        edges: map.edges.map((edge) => ({ from: edge.from, to: edge.to })),
      };
    }),
  ),
  learn_plan_set: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const learn = yield* LearnService.LearnService;
      const result = yield* learn
        .plan({
          lines: input.lines ?? [],
          concepts: input.concepts.map((concept) => ({
            ...(concept.id === undefined ? {} : { id: concept.id }),
            title: concept.title,
            ...(concept.claim === undefined ? {} : { claim: concept.claim }),
            lines: concept.lines,
            ...(concept.minutes === undefined ? {} : { minutes: concept.minutes }),
          })),
          edges: input.edges,
        })
        .pipe(Effect.mapError(failure));
      return { order: [...result.order], removedEdges: [...result.removedEdges], errors: [...result.errors] };
    }),
  ),
  learn_ask: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const thread = yield* callerThread("learn_ask");
      const learn = yield* LearnService.LearnService;
      const publisher = yield* UniversalWidgetPublisher.UniversalWidgetPublisher;
      const asked = yield* learn
        .ask({
          threadId: thread.threadId,
          ...(input.title === undefined ? {} : { title: input.title }),
          items: input.items,
        })
        .pipe(Effect.mapError(failure));
      const reference = yield* publisher.publish({ threadId: thread.threadId, tool: "learn_ask" });
      if (reference === undefined) return yield* widgetUnavailable();
      return {
        ...asked.payload,
        t3McpApp: reference,
        itemId: asked.itemId,
        status: "waiting_for_learner" as const,
        message:
          "The card is on screen. End your turn now; the graded answers arrive as the learner's next message.",
      };
    }),
  ),
  learn_record: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const thread = yield* callerThread("learn_record");
      const learn = yield* LearnService.LearnService;
      return yield* learn
        .record({
          threadId: thread.threadId,
          conceptId: input.conceptId,
          outcome: input.outcome,
          help: input.help,
          confidence: input.confidence,
          ...(input.misconception === undefined ? {} : { misconception: input.misconception }),
        })
        .pipe(Effect.mapError(failure));
    }),
  ),
  learn_review_next: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const learn = yield* LearnService.LearnService;
      const due = yield* learn.reviewQueue({ limit: input.limit ?? 8 }).pipe(Effect.mapError(failure));
      return {
        due: due.map((entry) => ({
          ...entry,
          lines: [...entry.lines],
          misconceptions: [...entry.misconceptions],
          recentStems: [...entry.recentStems],
        })),
      };
    }),
  ),
  learn_session_end: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const thread = yield* callerThread("learn_session_end");
      const learn = yield* LearnService.LearnService;
      const publisher = yield* UniversalWidgetPublisher.UniversalWidgetPublisher;
      const ended = yield* learn
        .sessionEnd({
          threadId: thread.threadId,
          title: input.title,
          diff: input.diff.map((entry) => ({
            kind: entry.kind,
            conceptTitle: entry.conceptTitle,
            ...(entry.detail === undefined ? {} : { detail: entry.detail }),
          })),
          ...(input.next === undefined ? {} : { next: input.next }),
        })
        .pipe(Effect.mapError(failure));
      const reference = yield* publisher.publish({ threadId: thread.threadId, tool: "learn_session_end" });
      if (reference === undefined) return yield* widgetUnavailable();
      return {
        ...ended.payload,
        t3McpApp: reference,
        itemId: ended.itemId,
        snoozeUntil: ended.snoozeUntil,
        message:
          ended.snoozeUntil === null
            ? "Session summary is on screen."
            : `Session summary is on screen. This thread wakes for review at ${ended.snoozeUntil}.`,
      };
    }),
  ),
  learn_suggest: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const learn = yield* LearnService.LearnService;
      return yield* learn
        .suggest({
          title: input.title,
          ...(input.topic === undefined ? {} : { topic: input.topic }),
          ...(input.note === undefined ? {} : { note: input.note }),
        })
        .pipe(Effect.mapError(failure));
    }),
  ),
});
