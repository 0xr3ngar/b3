import { UNIVERSAL_WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/** b3 Chat and Learn data, per environment, shared by web and mobile. */
export function createUniversalAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return {
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "universal:status",
      tag: UNIVERSAL_WS_METHODS.getStatus,
      staleTimeMs: 5_000,
      refreshIntervalMs: 15_000,
    }),
    settings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "universal:settings",
      tag: UNIVERSAL_WS_METHODS.getSettings,
    }),
    memoryList: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "universal:memory-list",
      tag: UNIVERSAL_WS_METHODS.memoryList,
    }),
    memoryProfile: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "universal:memory-profile",
      tag: UNIVERSAL_WS_METHODS.memoryProfile,
    }),
    learnMap: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "universal:learn-map",
      tag: UNIVERSAL_WS_METHODS.learnMap,
      refreshIntervalMs: 60_000,
    }),
    updateSettings: createEnvironmentRpcCommand(runtime, {
      label: "universal:update-settings",
      tag: UNIVERSAL_WS_METHODS.updateSettings,
    }),
    memoryUpsert: createEnvironmentRpcCommand(runtime, {
      label: "universal:memory-upsert",
      tag: UNIVERSAL_WS_METHODS.memoryUpsert,
    }),
    memoryDelete: createEnvironmentRpcCommand(runtime, {
      label: "universal:memory-delete",
      tag: UNIVERSAL_WS_METHODS.memoryDelete,
    }),
    memoryPurge: createEnvironmentRpcCommand(runtime, {
      label: "universal:memory-purge",
      tag: UNIVERSAL_WS_METHODS.memoryPurge,
    }),
    memoryRunNow: createEnvironmentRpcCommand(runtime, {
      label: "universal:memory-run-now",
      tag: UNIVERSAL_WS_METHODS.memoryRunNow,
    }),
    learnAction: createEnvironmentRpcCommand(runtime, {
      label: "universal:learn-action",
      tag: UNIVERSAL_WS_METHODS.learnAction,
    }),
    learnStart: createEnvironmentRpcCommand(runtime, {
      label: "universal:learn-start",
      tag: UNIVERSAL_WS_METHODS.learnStart,
    }),
  };
}
