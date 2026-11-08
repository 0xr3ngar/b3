import {
  type McpAppCallToolInput,
  type McpAppCallToolResult,
  type McpAppToolInfoInput,
  UNIVERSAL_SPACE_PROJECT_IDS,
  UNIVERSAL_WS_METHODS,
  UniversalError,
  UniversalRpcGroup,
  type UniversalStatus,
} from "@t3tools/contracts";
import { mcpAppFromToolItem } from "@t3tools/shared/toolOutput";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as McpAppRequests from "../mcpApps/McpAppRequests.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { UNIVERSAL_MCP_SERVER } from "./UniversalWidgetPublisher.ts";

import { EMBEDDER_MODELS } from "./embedder/models.ts";
import * as Embedder from "./embedder/Embedder.ts";
import * as UniversalDb from "./db/UniversalDb.ts";
import * as LearnService from "./learn/LearnService.ts";
import * as MemoryService from "./memory/MemoryService.ts";
import * as UniversalScheduler from "./UniversalScheduler.ts";
import * as UniversalSettingsStore from "./UniversalSettingsStore.ts";

const toUniversalError = (error: { readonly message: string }) =>
  new UniversalError({ message: error.message });

const CardTarget = { itemId: Schema.String, cardIndex: Schema.Int };
const WidgetArgs = {
  learn_widget_state: Schema.Struct({ itemId: Schema.optionalKey(Schema.String) }),
  learn_widget_answer: Schema.Struct({
    ...CardTarget,
    answer: Schema.Struct({
      text: Schema.optionalKey(Schema.String),
      choice: Schema.optionalKey(Schema.Int),
    }),
    confidence: Schema.Literals(["low", "medium", "high"]),
    help: Schema.Literals(["none", "hint", "answer"]),
  }),
  learn_widget_hint: Schema.Struct(CardTarget),
  learn_widget_reveal: Schema.Struct(CardTarget),
  learn_widget_override: Schema.Struct({
    ...CardTarget,
    rating: Schema.Literals(["again", "hard", "good", "easy"]),
  }),
  learn_widget_action: Schema.Struct({
    itemId: Schema.String,
    action: Schema.Literals(["snooze", "start_concept", "continue"]),
    conceptId: Schema.optionalKey(Schema.String),
  }),
} as const;
type WidgetTool = keyof typeof WidgetArgs;
const decodeWidgetArgs = Object.fromEntries(
  Object.entries(WidgetArgs).map(([name, schema]) => [name, Schema.decodeUnknownOption(schema)]),
) as { readonly [K in WidgetTool]: (input: unknown) => ReturnType<ReturnType<typeof Schema.decodeUnknownOption>> };
const isWidgetTool = (name: string): name is WidgetTool => Object.hasOwn(WidgetArgs, name);
const WIDGET_APP_TOOLS = new Set(["learn_ask", "learn_session_end"]);

const toolResult = (value: unknown): McpAppCallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
});
const toolError = (message: string): McpAppCallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/** WebSocket handlers for Settings → Chat / Learn and the Learn map; each calls one service method. */
export const makeUniversalWsHandlers = Effect.gen(function* () {
  const db = yield* UniversalDb.UniversalDb;
  const settings = yield* UniversalSettingsStore.UniversalSettingsStore;
  const memory = yield* MemoryService.MemoryService;
  const learn = yield* LearnService.LearnService;
  const scheduler = yield* UniversalScheduler.UniversalScheduler;
  const embedder = yield* Embedder.Embedder;
  const mcpAppRequests = yield* McpAppRequests.McpAppRequests;
  const orchestrator = yield* Orchestrator.OrchestratorV2;

  /** Only the Learn widget documents this fork published may reach these actions. */
  const isForkWidget = (input: McpAppToolInfoInput) =>
    !isWidgetTool(input.name)
      ? Effect.succeed(false)
      : orchestrator.getTurnItem({ threadId: input.threadId, itemId: input.itemId }).pipe(
          Effect.map((item) => {
            const app = item?.type === "dynamic_tool" ? mcpAppFromToolItem(item) : undefined;
            return app?.server === UNIVERSAL_MCP_SERVER && WIDGET_APP_TOOLS.has(app.tool);
          }),
          Effect.orElseSucceed(() => false),
        );

  /** The Learn item id the tool result carried, read back from the stored turn item. */
  const learnItemOfTurn = (input: McpAppCallToolInput) =>
    orchestrator.getTurnItem({ threadId: input.threadId, itemId: input.itemId }).pipe(
      Effect.map((item) => {
        const output = item?.type === "dynamic_tool" ? JSON.stringify(item.output ?? null) : "";
        return /"itemId\\?":\\?"((?:item|end)_[0-9a-f]{20})/.exec(output)?.[1] ?? null;
      }),
      Effect.orElseSucceed(() => null),
    );

  const runWidgetTool = Effect.fn("UniversalRpc.runWidgetTool")(
    function* (input: McpAppCallToolInput) {
      const name = input.name as WidgetTool;
      const decoded = decodeWidgetArgs[name](input.arguments);
      if (decoded._tag === "None") return toolError("Invalid arguments for this Learn card.");
      const args = decoded.value as never;
      const threadId = input.threadId;
      switch (name) {
        case "learn_widget_state": {
          const requested = (args as { itemId?: string }).itemId;
          const learnItemId = requested ?? (yield* learnItemOfTurn(input));
          if (learnItemId === null) return toolError("This card has no Learn item.");
          return toolResult(yield* learn.widgetState({ itemId: learnItemId, threadId }));
        }
        case "learn_widget_answer":
          return toolResult(yield* learn.answer({ ...(args as Parameters<typeof learn.answer>[0]), threadId }));
        case "learn_widget_hint":
          return toolResult(yield* learn.hint({ ...(args as { itemId: string; cardIndex: number }), threadId }));
        case "learn_widget_reveal": {
          const target = args as { itemId: string; cardIndex: number };
          return toolResult(
            yield* learn.answer({ ...target, threadId, answer: {}, confidence: "low", help: "answer" }),
          );
        }
        case "learn_widget_override":
          return toolResult(
            yield* learn.override({ ...(args as Parameters<typeof learn.override>[0]), threadId }),
          );
        case "learn_widget_action":
          return toolResult(
            yield* learn.widgetAction({ ...(args as Parameters<typeof learn.widgetAction>[0]), threadId }),
          );
      }
    },
    (effect) => effect.pipe(Effect.catch((error) => Effect.succeed(toolError(error.message)))),
  );

  const status = Effect.gen(function* () {
    const stats = yield* memory.stats;
    const embedderStatus = yield* SubscriptionRef.get(embedder.status);
    const learnSummary = yield* learn.dueSummary;
    const result: UniversalStatus = {
      spaces: { chat: UNIVERSAL_SPACE_PROJECT_IDS.chat, learn: UNIVERSAL_SPACE_PROJECT_IDS.learn },
      memory: {
        count: stats.count,
        lastRunAt: stats.lastRunAt,
        lastRunError: stats.lastRunError,
        lastRunTokens: stats.lastRunTokens,
        pendingMessages: yield* memory.pendingMessages,
        vectorSearch: db.vector.available ? "vector" : "fts-only",
        vectorUnavailableReason: db.vector.reason,
        databaseBytes: yield* db.sizeBytes,
        nextRunAt: yield* scheduler.nextMemoryRunAt,
      },
      embedder: {
        modelId: embedderStatus.modelId,
        state: embedderStatus.state,
        progress:
          embedderStatus.progress === undefined || embedderStatus.progress.totalBytes === 0
            ? null
            : embedderStatus.progress.loadedBytes / embedderStatus.progress.totalBytes,
        error: embedderStatus.error ?? null,
        msPerText: null,
        indexedCount: stats.embedded,
      },
      embedderModels: Object.values(EMBEDDER_MODELS).map((model) => ({
        id: model.id,
        label: model.label,
        provider: model.provider,
        dims: model.dims,
        approxDownloadMb: model.approxDownloadMb,
        description: `${model.languages}, up to ${model.maxTokens} tokens`,
      })),
      learn: learnSummary,
    };
    return result;
  });

  const fork = UniversalRpcGroup.of({
    [UNIVERSAL_WS_METHODS.getStatus]: () => status.pipe(Effect.mapError(toUniversalError)),
    [UNIVERSAL_WS_METHODS.getSettings]: () => settings.get.pipe(Effect.mapError(toUniversalError)),
    [UNIVERSAL_WS_METHODS.updateSettings]: (patch) =>
      settings.update(patch).pipe(Effect.mapError(toUniversalError)),
    [UNIVERSAL_WS_METHODS.memoryList]: (input) =>
      memory
        .list({
          ...(input.query === undefined ? {} : { query: input.query }),
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          limit: Math.min(Math.max(input.limit, 1), 200),
          offset: Math.max(input.offset, 0),
        })
        .pipe(
          Effect.map((result) => ({ rows: [...result.rows], total: result.total })),
          Effect.mapError(toUniversalError),
        ),
    [UNIVERSAL_WS_METHODS.memoryUpsert]: (input) =>
      (input.id === undefined
        ? memory
            .save({
              kind: input.kind,
              text: input.text,
              topic: input.topic ?? null,
              origin: "saved",
              reason: "Added in Settings",
            })
            .pipe(
              Effect.flatMap((outcome) =>
                outcome.type === "skipped"
                  ? Effect.fail(new UniversalError({ message: `Not saved: ${outcome.reason}.` }))
                  : Effect.succeed(outcome.record),
              ),
            )
        : memory.edit({
            id: input.id,
            kind: input.kind,
            text: input.text,
            topic: input.topic ?? null,
          })
      ).pipe(Effect.mapError(toUniversalError)),
    [UNIVERSAL_WS_METHODS.memoryDelete]: (input) =>
      memory.forget(input).pipe(Effect.as({}), Effect.mapError(toUniversalError)),
    [UNIVERSAL_WS_METHODS.memoryPurge]: () =>
      memory.purge.pipe(
        Effect.map((deleted) => ({ deleted })),
        Effect.mapError(toUniversalError),
      ),
    [UNIVERSAL_WS_METHODS.memoryRunNow]: () => scheduler.runMemoryNow,
    [UNIVERSAL_WS_METHODS.memoryProfile]: () =>
      memory.profile.pipe(
        Effect.map((markdown) => ({ markdown })),
        Effect.mapError(toUniversalError),
      ),
    [UNIVERSAL_WS_METHODS.learnMap]: () => learn.map.pipe(Effect.mapError(toUniversalError)),
    [UNIVERSAL_WS_METHODS.learnAction]: (input) =>
      learn.action(input).pipe(Effect.as({}), Effect.mapError(toUniversalError)),
    [UNIVERSAL_WS_METHODS.learnStart]: (input) =>
      learn.start(input).pipe(Effect.mapError(toUniversalError)),
  });

  return {
    rpc: fork,
    /** Learn widget calls go to the fork; every other app call reaches upstream unchanged. */
    callTool: (input: McpAppCallToolInput) =>
      Effect.flatMap(isForkWidget(input), (fork) =>
        fork ? runWidgetTool(input) : mcpAppRequests.callTool(input),
      ),
    toolInfo: (input: McpAppToolInfoInput) =>
      Effect.flatMap(isForkWidget(input), (fork) =>
        fork
          ? Effect.succeed({ callable: true, readOnly: true, title: "Learn" })
          : mcpAppRequests.toolInfo(input),
      ),
  } as const;
});
