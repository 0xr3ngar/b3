import type { ThreadId } from "@t3tools/contracts";
import { MCP_APP_MIME_TYPE, type McpAppReference } from "@t3tools/shared/mcpApp";
import { LEARN_WIDGET_HTML } from "@t3tools/universal-widgets";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { snapshotMcpApp } from "../mcpApps/McpAppSnapshot.ts";

export const UNIVERSAL_MCP_SERVER = "t3-code";
const LEARN_WIDGET_URI = "ui://t3-code/learn";

/** Writes the Learn widget document as a thread attachment, the same way adapters snapshot MCP Apps. */
export class UniversalWidgetPublisher extends Context.Service<
  UniversalWidgetPublisher,
  {
    readonly publish: (input: {
      readonly threadId: ThreadId;
      readonly tool: string;
    }) => Effect.Effect<McpAppReference | undefined>;
  }
>()("t3/universal/UniversalWidgetPublisher") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const publish = Effect.fn("UniversalWidgetPublisher.publish")(function* (input: {
    readonly threadId: ThreadId;
    readonly tool: string;
  }) {
    return yield* snapshotMcpApp({
      attachmentsDir: config.attachmentsDir,
      threadId: input.threadId,
      server: UNIVERSAL_MCP_SERVER,
      tool: input.tool,
      resourceUri: LEARN_WIDGET_URI,
      contents: [
        {
          uri: LEARN_WIDGET_URI,
          mimeType: MCP_APP_MIME_TYPE,
          text: LEARN_WIDGET_HTML,
          _meta: { ui: { prefersBorder: false } },
        },
      ],
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.catchCause((cause) =>
        Effect.logWarning("b3 could not publish a Learn widget", { cause }).pipe(
          Effect.as(undefined),
        ),
      ),
    );
  });
  return UniversalWidgetPublisher.of({ publish });
});

export const layer = Layer.effect(UniversalWidgetPublisher, make);
