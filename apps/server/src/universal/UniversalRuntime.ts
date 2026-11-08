import type { UniversalSettings } from "@t3tools/contracts";
import { EXTRACTOR_INSTRUCTIONS } from "@t3tools/universal-memory/batch";
import { renderChatAgents, renderLearnAgents } from "@t3tools/universal-memory/profile";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import * as Embedder from "./embedder/Embedder.ts";
import * as MemoryService from "./memory/MemoryService.ts";
import * as UniversalScheduler from "./UniversalScheduler.ts";
import * as UniversalSettingsStore from "./UniversalSettingsStore.ts";
import * as UniversalSpaces from "./UniversalSpaces.ts";

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

/** Startup and change reactions for the fork; runs once the server is activated. */
export const run = Effect.gen(function* () {
  const spaces = yield* UniversalSpaces.UniversalSpaces;
  const settingsStore = yield* UniversalSettingsStore.UniversalSettingsStore;
  const memory = yield* MemoryService.MemoryService;
  const scheduler = yield* UniversalScheduler.UniversalScheduler;
  const embedder = yield* Embedder.Embedder;

  yield* spaces.ensure;

  const render = Effect.gen(function* () {
    const settings = yield* settingsStore.get;
    const profile = yield* memory.profile;
    yield* spaces.writeInstructions("chat", {
      agents: `${renderChatAgents({ profileBytes: byteLength(profile) })}\n\n${profile}\n`,
    });
    yield* spaces.writeInstructions("learn", {
      agents: settings.learn.useMemoryProfile
        ? `${renderLearnAgents()}\n\n## About the learner\n\n${profile}\n`
        : `${renderLearnAgents()}\n`,
    });
    yield* spaces.writeInstructions("memory", { agents: `${EXTRACTOR_INSTRUCTIONS}\n` });
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("b3 could not render space instructions", { cause })),
  );

  let previous: UniversalSettings | null = null;
  const apply = (settings: UniversalSettings) =>
    Effect.gen(function* () {
      yield* scheduler.sync(settings);
      if (previous === null || previous.chat.defaultModel !== settings.chat.defaultModel) {
        if (settings.chat.defaultModel !== null)
          yield* spaces.setDefaultModel("chat", settings.chat.defaultModel);
      }
      if (previous === null || previous.learn.tutorModel !== settings.learn.tutorModel) {
        if (settings.learn.tutorModel !== null)
          yield* spaces.setDefaultModel("learn", settings.learn.tutorModel);
      }
      if (previous !== null && previous.chat.embedderId !== settings.chat.embedderId) {
        const geminiApiKey = yield* settingsStore.geminiApiKey.pipe(Effect.orElseSucceed(() => null));
        yield* embedder.setModel(settings.chat.embedderId, geminiApiKey === null ? {} : { geminiApiKey });
        yield* memory.reembedAll.pipe(Effect.ignore);
      }
      previous = settings;
      yield* render;
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("b3 settings apply failed", { cause })));

  const initial = yield* settingsStore.get.pipe(Effect.orElseSucceed(() => null));
  if (initial !== null) {
    const geminiApiKey = yield* settingsStore.geminiApiKey.pipe(Effect.orElseSucceed(() => null));
    yield* embedder
      .setModel(initial.chat.embedderId, geminiApiKey === null ? {} : { geminiApiKey })
      .pipe(Effect.ignore);
    yield* apply(initial);
  }
  yield* Effect.forkScoped(memory.embedPending);
  yield* settingsStore.changes.pipe(Stream.runForEach(apply), Effect.forkScoped);
  yield* memory.changes.pipe(
    Stream.debounce("2 seconds"),
    Stream.runForEach(() => render),
    Effect.forkScoped,
  );
}).pipe(Effect.withSpan("UniversalRuntime.run"));
