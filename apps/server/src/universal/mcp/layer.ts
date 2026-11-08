import type { UniversalSpace } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type {
  toolkitRegistration as ToolkitRegistration,
  toolkitVisibility as ToolkitVisibility,
} from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as UniversalSpaces from "../UniversalSpaces.ts";
import { layerExtraction, layerLearn, layerMemorySearch, layerMemoryWrite } from "./handlers.ts";
import { ExtractionToolkit, LearnToolkit, MemorySearchToolkit, MemoryWriteToolkit } from "./tools.ts";

/** Code threads keep upstream's exact tool list; fork tools appear only in their own spaces. */
const visibleIn = (spaces: ReadonlyArray<UniversalSpace | "system">) => () =>
  Effect.gen(function* () {
    const scope = yield* McpInvocationContext.McpInvocationContext;
    if (scope.thread === undefined) return false;
    const universal = yield* UniversalSpaces.UniversalSpaces;
    const space = yield* universal.spaceOfThread(scope.thread.threadId);
    return space !== null && spaces.includes(space);
  }).pipe(Effect.orElseSucceed(() => false));

/**
 * Built with McpHttpServer's own registration and visibility helpers, passed in,
 * so this module only type-imports McpHttpServer and the two cannot form an import cycle.
 */
export const makeUniversalMcpTools = (
  toolkitRegistration: typeof ToolkitRegistration,
  visibility: typeof ToolkitVisibility,
) =>
  Layer.mergeAll(
    toolkitRegistration(MemorySearchToolkit, layerMemorySearch).pipe(
      Layer.provide(visibility(visibleIn(["chat", "learn"])).layer),
    ),
    toolkitRegistration(MemoryWriteToolkit, layerMemoryWrite).pipe(
      Layer.provide(visibility(visibleIn(["chat"])).layer),
    ),
    toolkitRegistration(ExtractionToolkit, layerExtraction).pipe(
      Layer.provide(visibility(visibleIn(["system"])).layer),
    ),
    toolkitRegistration(LearnToolkit, layerLearn).pipe(
      Layer.provide(visibility(visibleIn(["learn"])).layer),
    ),
  );
