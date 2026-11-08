import { UNIVERSAL_SPACE_PROJECT_IDS } from "@t3tools/contracts";
import * as Layer from "effect/Layer";

import * as UniversalDb from "./db/UniversalDb.ts";
import * as Embedder from "./embedder/Embedder.ts";
import * as LearnService from "./learn/LearnService.ts";
import * as MemoryService from "./memory/MemoryService.ts";
import * as UniversalScheduler from "./UniversalScheduler.ts";
import * as UniversalSettingsStore from "./UniversalSettingsStore.ts";
import * as UniversalSpaces from "./UniversalSpaces.ts";

/** Unused fork services for upstream tests that build the whole /ws handler set. */
export const layerUnusedUniversalServices = Layer.mergeAll(
  Layer.mock(UniversalDb.UniversalDb)({ path: ":memory:", vector: { available: false, reason: "test" } }),
  Layer.mock(Embedder.Embedder)({ status: undefined as never }),
  Layer.mock(LearnService.LearnService)({}),
  Layer.mock(MemoryService.MemoryService)({}),
  Layer.mock(UniversalScheduler.UniversalScheduler)({}),
  Layer.mock(UniversalSettingsStore.UniversalSettingsStore)({}),
  Layer.mock(UniversalSpaces.UniversalSpaces)({
    root: () => "",
    projectId: (space) => UNIVERSAL_SPACE_PROJECT_IDS[space],
  }),
);
