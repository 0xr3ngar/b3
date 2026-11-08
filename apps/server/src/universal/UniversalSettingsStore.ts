import {
  UniversalSettings,
  type UniversalSettingsPatch,
  type UniversalChatSettings,
  type UniversalLearnSettings,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as UniversalDb from "./db/UniversalDb.ts";

const DEFAULT_CHAT_SETTINGS: UniversalChatSettings = {
  memoryEnabled: true,
  defaultModel: null,
  extractionModel: null,
  extractionInterval: "6h",
  embedderId: "embeddinggemma-2",
  sensitiveOptIn: [],
  topicRules: [],
  learnSignals: true,
};

const DEFAULT_LEARN_SETTINGS: UniversalLearnSettings = {
  tutorModel: null,
  dailyReviewTime: "09:00",
  reviewNotifications: true,
  desiredRetention: 0.9,
  useMemoryProfile: true,
};

const StoredSettings = Schema.Struct({
  chat: Schema.optionalKey(Schema.Unknown),
  learn: Schema.optionalKey(Schema.Unknown),
  geminiApiKey: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const decodeStored = Schema.decodeUnknownOption(Schema.fromJsonString(StoredSettings));
const decodeChat = Schema.decodeUnknownOption(UniversalSettings.fields.chat);
const decodeLearn = Schema.decodeUnknownOption(UniversalSettings.fields.learn);

const SETTINGS_KEY = "settings";

interface StoredState {
  readonly chat: UniversalChatSettings;
  readonly learn: UniversalLearnSettings;
  readonly geminiApiKey: string | null;
}

const toPublic = (state: StoredState): UniversalSettings => ({
  chat: state.chat,
  learn: state.learn,
  geminiApiKeySet: state.geminiApiKey !== null && state.geminiApiKey.length > 0,
});

/** Partial stored settings merge over defaults field by field, so new fields never reset old ones. */
const readState = (raw: string | undefined): StoredState => {
  const stored = raw === undefined ? undefined : decodeStored(raw);
  const value = stored?._tag === "Some" ? stored.value : {};
  const chatSource = { ...DEFAULT_CHAT_SETTINGS, ...(value.chat as object | undefined) };
  const learnSource = { ...DEFAULT_LEARN_SETTINGS, ...(value.learn as object | undefined) };
  const chat = decodeChat(chatSource);
  const learn = decodeLearn(learnSource);
  return {
    chat: chat._tag === "Some" ? chat.value : DEFAULT_CHAT_SETTINGS,
    learn: learn._tag === "Some" ? learn.value : DEFAULT_LEARN_SETTINGS,
    geminiApiKey: value.geminiApiKey ?? null,
  };
};

export class UniversalSettingsStore extends Context.Service<
  UniversalSettingsStore,
  {
    readonly get: Effect.Effect<UniversalSettings, UniversalDb.UniversalDbError>;
    readonly update: (
      patch: UniversalSettingsPatch,
    ) => Effect.Effect<UniversalSettings, UniversalDb.UniversalDbError>;
    /** Server-only; never sent to clients. */
    readonly geminiApiKey: Effect.Effect<string | null, UniversalDb.UniversalDbError>;
    readonly changes: Stream.Stream<UniversalSettings>;
  }
>()("t3/universal/UniversalSettingsStore") {}

const make = Effect.gen(function* () {
  const db = yield* UniversalDb.UniversalDb;
  const pubsub = yield* PubSub.unbounded<UniversalSettings>();
  const load = db.use("settings.read", (sqlite) => {
    const row = sqlite.prepare("SELECT value FROM kv WHERE key = ?").get(SETTINGS_KEY) as
      | { value: string }
      | undefined;
    return readState(row?.value);
  });
  const get = load.pipe(Effect.map(toPublic));
  const geminiApiKey = load.pipe(Effect.map((state) => state.geminiApiKey));
  const update = Effect.fn("UniversalSettingsStore.update")(function* (
    patch: UniversalSettingsPatch,
  ) {
    const next = yield* db.transaction("settings.update", (sqlite) => {
      const row = sqlite.prepare("SELECT value FROM kv WHERE key = ?").get(SETTINGS_KEY) as
        | { value: string }
        | undefined;
      const current = readState(row?.value);
      const merged = readState(
        JSON.stringify({
          chat: { ...current.chat, ...patch.chat },
          learn: { ...current.learn, ...patch.learn },
          geminiApiKey:
            patch.geminiApiKey === undefined ? current.geminiApiKey : patch.geminiApiKey,
        }),
      );
      sqlite
        .prepare(
          "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        )
        .run(SETTINGS_KEY, JSON.stringify(merged));
      return merged;
    });
    const published = toPublic(next);
    yield* PubSub.publish(pubsub, published);
    return published;
  });
  return UniversalSettingsStore.of({
    get,
    update,
    geminiApiKey,
    changes: Stream.fromPubSub(pubsub),
  });
});

export const layer = Layer.effect(UniversalSettingsStore, make);
