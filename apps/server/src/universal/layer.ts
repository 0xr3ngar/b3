import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ServerActivation from "../serverActivation.ts";
import * as UniversalDb from "./db/UniversalDb.ts";
import * as Embedder from "./embedder/Embedder.ts";
import * as LearnService from "./learn/LearnService.ts";
import * as MemoryService from "./memory/MemoryService.ts";
import * as UniversalRuntime from "./UniversalRuntime.ts";
import * as UniversalScheduler from "./UniversalScheduler.ts";
import * as UniversalSettingsStore from "./UniversalSettingsStore.ts";
import * as UniversalSpaces from "./UniversalSpaces.ts";
import * as UniversalWidgetPublisher from "./UniversalWidgetPublisher.ts";

const layerEmbedder = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return Embedder.layer({ cacheDir: path.join(config.stateDir, "universal", "models") });
  }),
);

/** Every fork service, shared by /ws handlers, /mcp tools and the runtime worker through layer memoization. */
export const layerServices = Layer.mergeAll(
  LearnService.layer,
  UniversalSpaces.layer,
  UniversalWidgetPublisher.layer,
  UniversalScheduler.layer,
).pipe(
  Layer.provideMerge(MemoryService.layer),
  Layer.provideMerge(layerEmbedder),
  Layer.provideMerge(UniversalSettingsStore.layer),
  Layer.provideMerge(UniversalDb.layer),
);

export const layerRuntime = Layer.effectDiscard(ServerActivation.forkParked(UniversalRuntime.run));
