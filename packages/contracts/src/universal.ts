import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import { ProjectId, ThreadId } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

// b3 fork contracts: the Chat and Learn spaces. Everything here is fork-owned.

export const UNIVERSAL_SPACES = ["code", "chat", "learn"] as const;
export const UniversalSpace = Schema.Literals(UNIVERSAL_SPACES);
export type UniversalSpace = typeof UniversalSpace.Type;

/** Deterministic per environment, so clients recognize space projects without a lookup. */
export const UNIVERSAL_SPACE_PROJECT_IDS = {
  chat: ProjectId.make("t3u-space-chat"),
  learn: ProjectId.make("t3u-space-learn"),
  memory: ProjectId.make("t3u-space-memory"),
} as const;

/** Threads the fork runs in the background (memory extraction, daily review). */
export const UNIVERSAL_SYSTEM_THREAD_TAG = "t3u-system";

export const universalSpaceOfProject = (projectId: string): UniversalSpace | "system" => {
  if (projectId === UNIVERSAL_SPACE_PROJECT_IDS.chat) return "chat";
  if (projectId === UNIVERSAL_SPACE_PROJECT_IDS.learn) return "learn";
  if (projectId === UNIVERSAL_SPACE_PROJECT_IDS.memory) return "system";
  return "code";
};

/** Learn threads are already lessons. Code and Chat threads can start one. */
export const canOfferLearnThis = (projectId: string | null | undefined): boolean =>
  projectId != null && universalSpaceOfProject(projectId) !== "learn";

export const MemoryKind = Schema.Literals([
  "fact",
  "preference",
  "goal",
  "person",
  "project",
  "instruction",
  "style",
]);
export type MemoryKind = typeof MemoryKind.Type;

export const SensitiveCategory = Schema.Literals([
  "health",
  "religion",
  "politics",
  "sexuality",
  "gender_identity",
]);
export type SensitiveCategory = typeof SensitiveCategory.Type;

export const MemoryRecord = Schema.Struct({
  id: Schema.String,
  kind: MemoryKind,
  text: Schema.String,
  topic: Schema.NullOr(Schema.String),
  confidence: Schema.Number,
  origin: Schema.Literals(["extracted", "saved", "edited"]),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  supersededBy: Schema.NullOr(Schema.String),
  sourceThreadId: Schema.NullOr(Schema.String),
  sourceThreadTitle: Schema.NullOr(Schema.String),
  sourceMessageIds: Schema.Array(Schema.String),
  extractorModel: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
});
export type MemoryRecord = typeof MemoryRecord.Type;

export const MemoryTopicRule = Schema.Struct({
  id: Schema.String,
  topic: Schema.String,
  keywords: Schema.Array(Schema.String),
});
export type MemoryTopicRule = typeof MemoryTopicRule.Type;

export const ExtractionInterval = Schema.Literals(["hourly", "6h", "daily", "off"]);
export type ExtractionInterval = typeof ExtractionInterval.Type;

export const UniversalChatSettings = Schema.Struct({
  memoryEnabled: Schema.Boolean,
  defaultModel: Schema.NullOr(ModelSelection),
  extractionModel: Schema.NullOr(ModelSelection),
  extractionInterval: ExtractionInterval,
  embedderId: Schema.String,
  sensitiveOptIn: Schema.Array(SensitiveCategory),
  topicRules: Schema.Array(MemoryTopicRule),
  learnSignals: Schema.Boolean,
});
export type UniversalChatSettings = typeof UniversalChatSettings.Type;

export const UniversalLearnSettings = Schema.Struct({
  tutorModel: Schema.NullOr(ModelSelection),
  dailyReviewTime: Schema.NullOr(Schema.String),
  reviewNotifications: Schema.Boolean,
  desiredRetention: Schema.Number,
  useMemoryProfile: Schema.Boolean,
});
export type UniversalLearnSettings = typeof UniversalLearnSettings.Type;

export const UniversalSettings = Schema.Struct({
  chat: UniversalChatSettings,
  learn: UniversalLearnSettings,
  geminiApiKeySet: Schema.Boolean,
});
export type UniversalSettings = typeof UniversalSettings.Type;

const optionalFields = <F extends Schema.Struct.Fields>(fields: F) =>
  Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, Schema.optionalKey(field)]),
  ) as { readonly [K in keyof F]: Schema.optionalKey<F[K]> };

export const UniversalSettingsPatch = Schema.Struct({
  chat: Schema.optionalKey(Schema.Struct(optionalFields(UniversalChatSettings.fields))),
  learn: Schema.optionalKey(Schema.Struct(optionalFields(UniversalLearnSettings.fields))),
  /** `null` clears the stored key. */
  geminiApiKey: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type UniversalSettingsPatch = typeof UniversalSettingsPatch.Type;

export const EmbedderState = Schema.Literals(["idle", "downloading", "loading", "ready", "error"]);

export const UniversalEmbedderModel = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  provider: Schema.Literals(["local", "gemini"]),
  dims: Schema.Number,
  approxDownloadMb: Schema.Number,
  description: Schema.String,
});
export type UniversalEmbedderModel = typeof UniversalEmbedderModel.Type;

export const UniversalStatus = Schema.Struct({
  spaces: Schema.Struct({ chat: ProjectId, learn: ProjectId }),
  memory: Schema.Struct({
    count: Schema.Number,
    lastRunAt: Schema.NullOr(Schema.String),
    lastRunError: Schema.NullOr(Schema.String),
    lastRunTokens: Schema.NullOr(Schema.Number),
    pendingMessages: Schema.Number,
    vectorSearch: Schema.Literals(["vector", "fts-only"]),
    vectorUnavailableReason: Schema.NullOr(Schema.String),
    databaseBytes: Schema.Number,
    nextRunAt: Schema.NullOr(Schema.String),
  }),
  embedder: Schema.Struct({
    modelId: Schema.String,
    state: EmbedderState,
    progress: Schema.NullOr(Schema.Number),
    error: Schema.NullOr(Schema.String),
    msPerText: Schema.NullOr(Schema.Number),
    indexedCount: Schema.Number,
  }),
  embedderModels: Schema.Array(UniversalEmbedderModel),
  learn: Schema.Struct({
    concepts: Schema.Number,
    due: Schema.Number,
    nextReviewAt: Schema.NullOr(Schema.String),
  }),
});
export type UniversalStatus = typeof UniversalStatus.Type;

export const LearnStationState = Schema.Literals([
  "solid",
  "learning",
  "due",
  "ready",
  "locked",
  "suggested",
]);
export type LearnStationState = typeof LearnStationState.Type;

export const LearnMapLine = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  color: Schema.String,
});
export type LearnMapLine = typeof LearnMapLine.Type;

export const LearnMapStation = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  lineIds: Schema.Array(Schema.String),
  state: LearnStationState,
  recall: Schema.NullOr(Schema.Number),
  mastery: Schema.Number,
  misconception: Schema.NullOr(Schema.String),
  dueAt: Schema.NullOr(Schema.String),
  taughtIn: Schema.NullOr(
    Schema.Struct({ threadId: ThreadId, title: Schema.String, at: Schema.String }),
  ),
  note: Schema.NullOr(Schema.String),
  minutes: Schema.Number,
});
export type LearnMapStation = typeof LearnMapStation.Type;

export const LearnMapEdge = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  planned: Schema.Boolean,
});
export type LearnMapEdge = typeof LearnMapEdge.Type;

export const LearnMap = Schema.Struct({
  lines: Schema.Array(LearnMapLine),
  stations: Schema.Array(LearnMapStation),
  edges: Schema.Array(LearnMapEdge),
  anchors: Schema.Record(Schema.String, Schema.Struct({ x: Schema.Number, y: Schema.Number })),
  here: Schema.NullOr(Schema.String),
});
export type LearnMap = typeof LearnMap.Type;

export const LearnStartInput = Schema.Struct({
  kind: Schema.Literals(["lesson", "review", "quiz", "route", "from_thread", "topic"]),
  conceptIds: Schema.optionalKey(Schema.Array(Schema.String)),
  lineId: Schema.optionalKey(Schema.String),
  sourceThreadId: Schema.optionalKey(ThreadId),
  text: Schema.optionalKey(Schema.String),
});
export type LearnStartInput = typeof LearnStartInput.Type;

export const LearnMapActionInput = Schema.Struct({
  action: Schema.Literals([
    "accept_suggestion",
    "dismiss_suggestion",
    "reset_concept",
    "delete_line",
    "move_station",
  ]),
  id: Schema.String,
  position: Schema.optionalKey(Schema.Struct({ x: Schema.Number, y: Schema.Number })),
});
export type LearnMapActionInput = typeof LearnMapActionInput.Type;

export class UniversalError extends Schema.TaggedError<UniversalError>()("UniversalError", {
  message: Schema.String,
}) {}

const UniversalRpcError = Schema.Union([UniversalError, EnvironmentAuthorizationError]);

export const UNIVERSAL_WS_METHODS = {
  getStatus: "universal.getStatus",
  getSettings: "universal.getSettings",
  updateSettings: "universal.updateSettings",
  memoryList: "universal.memoryList",
  memoryUpsert: "universal.memoryUpsert",
  memoryDelete: "universal.memoryDelete",
  memoryPurge: "universal.memoryPurge",
  memoryRunNow: "universal.memoryRunNow",
  memoryProfile: "universal.memoryProfile",
  learnMap: "universal.learnMap",
  learnAction: "universal.learnAction",
  learnStart: "universal.learnStart",
} as const;

export type UniversalWsMethod = (typeof UNIVERSAL_WS_METHODS)[keyof typeof UNIVERSAL_WS_METHODS];

/** One label for every fork method, for exhaustive per-method maps upstream keeps. */
export const universalRpcLabels = <const L extends string>(label: L) =>
  Object.fromEntries(
    Object.values(UNIVERSAL_WS_METHODS).map((method) => [method, label]),
  ) as Record<UniversalWsMethod, L>;

export const UniversalRpcGroup = RpcGroup.make(
  Rpc.make(UNIVERSAL_WS_METHODS.getStatus, {
    payload: Schema.Struct({}),
    success: UniversalStatus,
    error: UniversalRpcError,
  }),
  Rpc.make(UNIVERSAL_WS_METHODS.getSettings, {
    payload: Schema.Struct({}),
    success: UniversalSettings,
    error: UniversalRpcError,
  }),
  Rpc.make(UNIVERSAL_WS_METHODS.updateSettings, {
    payload: UniversalSettingsPatch,
    success: UniversalSettings,
    error: UniversalRpcError,
  }),
  Rpc.make(UNIVERSAL_WS_METHODS.memoryList, {
    payload: Schema.Struct({
      query: Schema.optionalKey(Schema.String),
      kind: Schema.optionalKey(MemoryKind),
      limit: Schema.Number,
      offset: Schema.Number,
    }),
    success: Schema.Struct({ rows: Schema.Array(MemoryRecord), total: Schema.Number }),
    error: UniversalRpcError,
  }),
  Rpc.make(UNIVERSAL_WS_METHODS.memoryUpsert, {
    payload: Schema.Struct({
      id: Schema.optionalKey(Schema.String),
      kind: MemoryKind,
      text: Schema.String,
      topic: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
    success: MemoryRecord,
    error: UniversalRpcError,
  }),
  Rpc.make(UNIVERSAL_WS_METHODS.memoryDelete, {
    payload: Schema.Struct({ id: Schema.String, neverAgain: Schema.Boolean }),
    success: Schema.Struct({}),
    error: UniversalRpcError,
  }),
  Rpc.make(UNIVERSAL_WS_METHODS.memoryPurge, {
    payload: Schema.Struct({}),
    success: Schema.Struct({ deleted: Schema.Number }),
    error: UniversalRpcError,
  }),
  Rpc.make(UNIVERSAL_WS_METHODS.memoryRunNow, {
    payload: Schema.Struct({}),
    success: Schema.Struct({ started: Schema.Boolean, message: Schema.String }),
    error: UniversalRpcError,
  }),
  Rpc.make(UNIVERSAL_WS_METHODS.memoryProfile, {
    payload: Schema.Struct({}),
    success: Schema.Struct({ markdown: Schema.String }),
    error: UniversalRpcError,
  }),
  Rpc.make(UNIVERSAL_WS_METHODS.learnMap, {
    payload: Schema.Struct({}),
    success: LearnMap,
    error: UniversalRpcError,
  }),
  Rpc.make(UNIVERSAL_WS_METHODS.learnAction, {
    payload: LearnMapActionInput,
    success: Schema.Struct({}),
    error: UniversalRpcError,
  }),
  Rpc.make(UNIVERSAL_WS_METHODS.learnStart, {
    payload: LearnStartInput,
    success: Schema.Struct({ threadId: ThreadId }),
    error: UniversalRpcError,
  }),
);

export const UNIVERSAL_RPC_SCOPES = {
  [UNIVERSAL_WS_METHODS.getStatus]: AuthOrchestrationReadScope,
  [UNIVERSAL_WS_METHODS.getSettings]: AuthOrchestrationReadScope,
  [UNIVERSAL_WS_METHODS.updateSettings]: AuthSettingsWriteScope,
  [UNIVERSAL_WS_METHODS.memoryList]: AuthOrchestrationReadScope,
  [UNIVERSAL_WS_METHODS.memoryUpsert]: AuthOrchestrationOperateScope,
  [UNIVERSAL_WS_METHODS.memoryDelete]: AuthOrchestrationOperateScope,
  [UNIVERSAL_WS_METHODS.memoryPurge]: AuthSettingsWriteScope,
  [UNIVERSAL_WS_METHODS.memoryRunNow]: AuthOrchestrationOperateScope,
  [UNIVERSAL_WS_METHODS.memoryProfile]: AuthOrchestrationReadScope,
  [UNIVERSAL_WS_METHODS.learnMap]: AuthOrchestrationReadScope,
  [UNIVERSAL_WS_METHODS.learnAction]: AuthOrchestrationOperateScope,
  [UNIVERSAL_WS_METHODS.learnStart]: AuthOrchestrationOperateScope,
} as const;
