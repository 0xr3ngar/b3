import {
  CommandId,
  type ModelSelection,
  type ProjectId,
  type ThreadId,
  UNIVERSAL_SPACE_PROJECT_IDS,
  UNIVERSAL_SYSTEM_THREAD_TAG,
  universalSpaceOfProject,
  type UniversalSpace,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";

export type SpaceKey = keyof typeof UNIVERSAL_SPACE_PROJECT_IDS;

const SPACE_TITLES: Record<SpaceKey, string> = {
  chat: "Chat",
  learn: "Learn",
  memory: "b3 Memory",
};

export interface SpaceInstructions {
  readonly agents: string;
  readonly profile?: string;
}

/**
 * The managed Chat, Learn and Memory projects. Ids are deterministic so every
 * client can tell space projects apart without asking the server.
 */
export class UniversalSpaces extends Context.Service<
  UniversalSpaces,
  {
    readonly ensure: Effect.Effect<void>;
    readonly root: (space: SpaceKey) => string;
    readonly projectId: (space: SpaceKey) => ProjectId;
    /** A thread's project never changes, so lookups are cached for the server's lifetime. */
    readonly spaceOfThread: (threadId: ThreadId) => Effect.Effect<UniversalSpace | "system" | null>;
    readonly writeInstructions: (space: SpaceKey, files: SpaceInstructions) => Effect.Effect<void>;
    readonly setDefaultModel: (
      space: SpaceKey,
      selection: ModelSelection | null,
    ) => Effect.Effect<void>;
  }
>()("t3/universal/UniversalSpaces") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const spaceCache = new Map<string, UniversalSpace | "system">();

  const root = (space: SpaceKey) => path.join(config.stateDir, "universal", "spaces", space);
  const projectId = (space: SpaceKey) => UNIVERSAL_SPACE_PROJECT_IDS[space];

  const ensureProject = Effect.fn("UniversalSpaces.ensureProject")(function* (space: SpaceKey) {
    const workspaceRoot = root(space);
    yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });
    const existing = yield* projects.getById(projectId(space));
    if (Option.isSome(existing)) return;
    yield* projects.bootstrap({
      commandId: CommandId.make(`t3u-space:${space}:create`),
      projectId: projectId(space),
      title: SPACE_TITLES[space],
      workspaceRoot,
      createWorkspaceRootIfMissing: true,
    });
  });

  const ensureHiddenSystemThreads = Effect.gen(function* () {
    const current = yield* settings.getSettings;
    if (current.hideTaggedThreads && current.hiddenThreadTags.includes(UNIVERSAL_SYSTEM_THREAD_TAG))
      return;
    yield* settings.updateSettings({
      hideTaggedThreads: true,
      hiddenThreadTags: [...new Set([...current.hiddenThreadTags, UNIVERSAL_SYSTEM_THREAD_TAG])],
    });
  });

  const ensure = Effect.gen(function* () {
    for (const space of ["chat", "learn", "memory"] as const) {
      yield* ensureProject(space).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("b3 could not create a space project", { space, cause }),
        ),
      );
    }
    yield* ensureHiddenSystemThreads.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("b3 could not hide its system threads", { cause }),
      ),
    );
  }).pipe(Effect.withSpan("UniversalSpaces.ensure"));

  const spaceOfThread = (threadId: ThreadId) => {
    const cached = spaceCache.get(threadId);
    if (cached !== undefined) return Effect.succeed(cached);
    return threads.getThreadShell(threadId).pipe(
      Effect.map((shell) => {
        if (shell === null) return null;
        const space = universalSpaceOfProject(shell.projectId);
        spaceCache.set(threadId, space);
        return space;
      }),
      Effect.orElseSucceed(() => null),
    );
  };

  const writeInstructions = Effect.fn("UniversalSpaces.writeInstructions")(
    function* (space: SpaceKey, files: SpaceInstructions) {
      const dir = root(space);
      yield* fileSystem.makeDirectory(dir, { recursive: true });
      yield* fileSystem.writeFileString(path.join(dir, "AGENTS.md"), files.agents);
      // Claude Code reads CLAUDE.md and follows @-imports; the other CLIs read AGENTS.md.
      yield* fileSystem.writeFileString(path.join(dir, "CLAUDE.md"), "@AGENTS.md\n");
      if (files.profile !== undefined) {
        yield* fileSystem.writeFileString(path.join(dir, "PROFILE.md"), files.profile);
      }
    },
    (effect) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("b3 could not write space instructions", { cause }),
        ),
      ),
  );

  const setDefaultModel = Effect.fn("UniversalSpaces.setDefaultModel")(
    function* (space: SpaceKey, selection: ModelSelection | null) {
      const at = yield* Clock.currentTimeMillis;
      yield* projects.update({
        commandId: CommandId.make(`t3u-space:${space}:model:${at}`),
        projectId: projectId(space),
        defaultModelSelection: selection,
      });
    },
    (effect) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("b3 could not set a space default model", { cause }),
        ),
      ),
  );

  return UniversalSpaces.of({
    ensure,
    root,
    projectId,
    spaceOfThread,
    writeInstructions,
    setDefaultModel,
  });
});

export const layer = Layer.effect(UniversalSpaces, make);
