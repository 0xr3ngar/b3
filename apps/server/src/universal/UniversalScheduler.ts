import {
  type ModelSelection,
  ScheduledTaskId,
  UNIVERSAL_SPACE_PROJECT_IDS,
  type UniversalSettings,
} from "@t3tools/contracts";
import { EXTRACTOR_INSTRUCTIONS } from "@t3tools/universal-memory/batch";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as UniversalDb from "./db/UniversalDb.ts";

const MEMORY_TASK_KEY = "task.memory";
const REVIEW_TASK_KEY = "task.review";

const INTERVAL_MS = { hourly: 3_600_000, "6h": 21_600_000, daily: 86_400_000 } as const;

const DAILY_REVIEW_PROMPT = [
  "Daily review.",
  "Call learn_review_next. If nothing is due, reply only 'Nothing due today.' and stop.",
  "Otherwise send one learn_ask deck with one fresh item per due concept (interleave topics, new phrasings, no repeats of recentStems).",
  "When the graded answers arrive, give short corrective feedback, then call learn_session_end.",
].join("\n");

/** Background work rides on T3 scheduled tasks, so it uses whatever provider and model the user picked. */
export class UniversalScheduler extends Context.Service<
  UniversalScheduler,
  {
    readonly sync: (settings: UniversalSettings) => Effect.Effect<void>;
    readonly runMemoryNow: Effect.Effect<{ readonly started: boolean; readonly message: string }>;
    readonly nextMemoryRunAt: Effect.Effect<string | null>;
  }
>()("t3/universal/UniversalScheduler") {}

const make = Effect.gen(function* () {
  const db = yield* UniversalDb.UniversalDb;
  const tasks = yield* ScheduledTaskService.ScheduledTaskService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const readKey = (key: string) =>
    db
      .use("scheduler.read", (sqlite) => {
        const row = sqlite.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
          | { value: string }
          | undefined;
        return row?.value ?? null;
      })
      .pipe(Effect.orElseSucceed(() => null));
  const writeKey = (key: string, value: string) =>
    db
      .use("scheduler.write", (sqlite) =>
        sqlite
          .prepare(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
          )
          .run(key, value),
      )
      .pipe(Effect.ignore);

  const fallbackModel = serverSettings.getSettings.pipe(
    Effect.map((settings): ModelSelection | null => settings.textGenerationModelSelection ?? settings.defaultModelSelection),
    Effect.orElseSucceed(() => null),
  );

  const existingTask = Effect.fn("UniversalScheduler.existingTask")(function* (key: string) {
    const id = yield* readKey(key);
    if (id === null) return null;
    const list = yield* tasks.list().pipe(Effect.orElseSucceed(() => ({ tasks: [] })));
    return list.tasks.find((task) => task.id === id) ?? null;
  });

  const disable = Effect.fn("UniversalScheduler.disable")(function* (key: string) {
    const task = yield* existingTask(key);
    if (task === null || !task.enabled) return;
    yield* tasks.setEnabled({ id: task.id, enabled: false }).pipe(Effect.ignore);
  });

  const syncMemory = Effect.fn("UniversalScheduler.syncMemory")(function* (settings: UniversalSettings) {
    const interval = settings.chat.extractionInterval;
    if (!settings.chat.memoryEnabled || interval === "off") return yield* disable(MEMORY_TASK_KEY);
    const model = settings.chat.extractionModel ?? (yield* fallbackModel);
    if (model === null) return yield* disable(MEMORY_TASK_KEY);
    const existing = yield* existingTask(MEMORY_TASK_KEY);
    const saved = yield* tasks.upsert({
      ...(existing === null ? {} : { id: existing.id }),
      title: "b3 memory extraction",
      prompt: EXTRACTOR_INSTRUCTIONS,
      enabled: true,
      schedule: { type: "interval", everyMs: INTERVAL_MS[interval] },
      projectId: UNIVERSAL_SPACE_PROJECT_IDS.memory,
      threadMode: "fresh_session",
      workspaceStrategy: { type: "root" },
      modelSelection: model,
      runtimeMode: "auto-accept-edits",
      interactionMode: "default",
      createdBy: "system",
      creationSource: "server",
    });
    yield* writeKey(MEMORY_TASK_KEY, saved.task.id);
  });

  const syncReview = Effect.fn("UniversalScheduler.syncReview")(function* (settings: UniversalSettings) {
    const time = settings.learn.dailyReviewTime;
    if (time === null) return yield* disable(REVIEW_TASK_KEY);
    const model = settings.learn.tutorModel ?? (yield* fallbackModel);
    if (model === null) return yield* disable(REVIEW_TASK_KEY);
    const existing = yield* existingTask(REVIEW_TASK_KEY);
    const saved = yield* tasks.upsert({
      ...(existing === null ? {} : { id: existing.id }),
      title: "b3 daily review",
      prompt: DAILY_REVIEW_PROMPT,
      enabled: true,
      schedule: { type: "fixed_time", timeOfDay: time },
      projectId: UNIVERSAL_SPACE_PROJECT_IDS.learn,
      threadMode: "continue",
      workspaceStrategy: { type: "root" },
      modelSelection: model,
      runtimeMode: "auto-accept-edits",
      interactionMode: "default",
      createdBy: "system",
      creationSource: "server",
    });
    yield* writeKey(REVIEW_TASK_KEY, saved.task.id);
  });

  const sync: UniversalScheduler["Service"]["sync"] = (settings) =>
    Effect.all(
      [
        syncMemory(settings).pipe(
          Effect.catchCause((cause) => Effect.logWarning("b3 could not schedule memory extraction", { cause })),
        ),
        syncReview(settings).pipe(
          Effect.catchCause((cause) => Effect.logWarning("b3 could not schedule the daily review", { cause })),
        ),
      ],
      { discard: true },
    );

  const runMemoryNow = Effect.gen(function* () {
    const id = yield* readKey(MEMORY_TASK_KEY);
    if (id === null) {
      return { started: false, message: "Choose an extraction model in Settings → Chat first." };
    }
    const result = yield* tasks.runNow({ id: ScheduledTaskId.make(id) }).pipe(Effect.option);
    return result._tag === "Some" && result.value.threadId !== null
      ? { started: true, message: "Memory extraction started." }
      : { started: false, message: "Memory extraction could not start." };
  });

  const nextMemoryRunAt = existingTask(MEMORY_TASK_KEY).pipe(
    Effect.map((task) => (task?.enabled === true ? task.nextRunAt : null)),
  );

  return UniversalScheduler.of({ sync, runMemoryNow, nextMemoryRunAt });
});

export const layer = Layer.effect(UniversalScheduler, make);
