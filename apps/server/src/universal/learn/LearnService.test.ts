import {
  type OrchestrationV2ServerCommand,
  ServerSettingsError,
  ThreadId,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as UniversalDb from "../db/UniversalDb.ts";
import * as MemoryService from "../memory/MemoryService.ts";
import * as UniversalSettingsStore from "../UniversalSettingsStore.ts";
import * as LearnService from "./LearnService.ts";

const threadA = ThreadId.make("t3u-test-thread-a");
const threadB = ThreadId.make("t3u-test-thread-b");

interface RecordedCalls {
  readonly sends: Ref.Ref<ThreadManagementService.ThreadManagementSendInput[]>;
  readonly dispatches: Ref.Ref<OrchestrationV2ServerCommand[]>;
}

const makeCalls = Effect.gen(function* () {
  const sends = yield* Ref.make<ThreadManagementService.ThreadManagementSendInput[]>([]);
  const dispatches = yield* Ref.make<OrchestrationV2ServerCommand[]>([]);
  return { sends, dispatches };
});

const layerThreads = (calls: RecordedCalls) =>
  Layer.mock(ThreadManagementService.ThreadManagementService, {
    sendToThread: (input) =>
      Ref.update(calls.sends, (list) => [...list, input]).pipe(
        Effect.asVoid,
        Effect.andThen(
          Effect.fail(new Orchestrator.OrchestratorProjectionError({ threadId: input.threadId })),
        ),
      ),
    dispatch: (command) =>
      Ref.update(calls.dispatches, (list) => [...list, command]).pipe(
        Effect.as({ sequence: 1, storedEvents: [] }),
      ),
    getThreadShell: () => Effect.succeed(null),
  });

const layerServerSettings = Layer.mock(ServerSettings.ServerSettingsService, {
  getSettings: Effect.fail(
    new ServerSettingsError({ settingsPath: "test", operation: "normalize" }),
  ),
});

const makeDeps = (calls: RecordedCalls) =>
  Layer.mergeAll(
    UniversalSettingsStore.layer.pipe(Layer.provideMerge(UniversalDb.layerMemory)),
    Layer.mock(MemoryService.MemoryService, { takeSignals: Effect.succeed([]) }),
    SecureRandom.layerWebCrypto,
    layerThreads(calls),
    Layer.mock(ThreadLaunchService.ThreadLaunchService, {}),
    layerServerSettings,
  );

const withLearn = <A, E>(
  body: (services: {
    readonly learn: LearnService.LearnService["Service"];
    readonly db: UniversalDb.UniversalDb["Service"];
    readonly calls: RecordedCalls;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const calls = yield* makeCalls;
    const layer = LearnService.layer.pipe(Layer.provideMerge(makeDeps(calls)));
    return yield* Effect.provide(
      Effect.gen(function* () {
        const learn = yield* LearnService.LearnService;
        const db = yield* UniversalDb.UniversalDb;
        return yield* body({ learn, db, calls });
      }),
      layer,
    );
  });

const clozeItem = (
  conceptId: string,
  stem: string,
  accept: string,
): LearnService.LearnItemInput => ({
  conceptId,
  kind: "cloze",
  stem,
  accept: [accept],
  correctAnswer: accept,
});

const ReviewLogRows = Schema.Array(Schema.Struct({ overridden: Schema.Number }));
const decodeReviewLogRows = Schema.decodeUnknownSync(ReviewLogRows);

describe("LearnService", () => {
  it.effect("plan builds the map and drops cycle edges", () =>
    withLearn(({ learn }) =>
      Effect.gen(function* () {
        const planned = yield* learn.plan({
          lines: [{ title: "Systems" }],
          concepts: [
            { id: "alpha", title: "Alpha", lines: ["Systems"] },
            { id: "beta", title: "Beta", lines: ["Systems"] },
          ],
          edges: [
            { from: "alpha", to: "beta" },
            { from: "beta", to: "alpha" },
          ],
        });
        assert.deepStrictEqual(planned.removedEdges, [
          { from: "beta", to: "alpha", reason: "cycle" },
        ]);
        assert.deepStrictEqual(planned.errors, []);
        const map = yield* learn.map;
        const alpha = map.stations.find((station) => station.id === "alpha");
        const beta = map.stations.find((station) => station.id === "beta");
        assert.strictEqual(alpha?.state, "ready");
        assert.strictEqual(beta?.state, "locked");
        assert.deepStrictEqual(map.edges, [{ from: "alpha", to: "beta", planned: false }]);
        assert.deepStrictEqual(
          map.stations.map((station) => station.lineIds),
          [["systems"], ["systems"]],
        );
      }),
    ),
  );

  it.effect("a correct confident answer schedules the card", () =>
    withLearn(({ learn }) =>
      Effect.gen(function* () {
        const { itemId, payload } = yield* learn.ask({
          threadId: threadA,
          title: "Check",
          items: [clozeItem("fsrs", "The review scheduler runs on _", "FSRS")],
        });
        assert.strictEqual(payload.widget, "check");
        const state = yield* learn.answer({
          threadId: threadA,
          itemId,
          cardIndex: 0,
          answer: { text: "fsrs" },
          confidence: "high",
          help: "none",
        });
        assert.strictEqual(state.status, "graded");
        assert.strictEqual(state.result?.outcome, "correct");
        assert.strictEqual(state.result?.rating, "good");
        assert.strictEqual(state.result?.hypercorrection, false);
        if (state.result === undefined) throw new Error("The graded result is missing.");
        for (const label of Object.values(state.result.intervals)) {
          assert.ok(label.length > 0);
        }
        const map = yield* learn.map;
        assert.strictEqual(map.stations[0]?.state, "learning");
        assert.ok((map.stations[0]?.mastery ?? 0) > 0);
      }),
    ),
  );

  it.effect("a confident wrong answer is graded again as a hypercorrection", () =>
    withLearn(({ learn }) =>
      Effect.gen(function* () {
        const { itemId } = yield* learn.ask({
          threadId: threadA,
          items: [clozeItem("fsrs", "The review scheduler runs on _", "FSRS")],
        });
        const state = yield* learn.answer({
          threadId: threadA,
          itemId,
          cardIndex: 0,
          answer: { text: "a fixed interval" },
          confidence: "high",
          help: "none",
        });
        assert.strictEqual(state.result?.outcome, "incorrect");
        assert.strictEqual(state.result?.rating, "again");
        assert.strictEqual(state.result?.hypercorrection, true);
      }),
    ),
  );

  it.effect("a misconception answer records the note on the map", () =>
    withLearn(({ learn }) =>
      Effect.gen(function* () {
        const { itemId } = yield* learn.ask({
          threadId: threadA,
          items: [
            {
              conceptId: "photosynthesis",
              kind: "short",
              stem: "How do plants make food?",
              rubric: {
                mustInclude: [["photosynthesis", "light"]],
                misconceptions: [
                  {
                    id: "soil",
                    patterns: ["eat soil", "food from soil"],
                    note: "Plants make sugar from light, water and air.",
                  },
                ],
              },
            },
          ],
        });
        const state = yield* learn.answer({
          threadId: threadA,
          itemId,
          cardIndex: 0,
          answer: { text: "plants eat soil" },
          confidence: "medium",
          help: "none",
        });
        assert.strictEqual(state.result?.outcome, "incorrect");
        assert.strictEqual(state.result?.rating, "again");
        assert.strictEqual(
          state.result?.feedback,
          "Careful: Plants make sugar from light, water and air.",
        );
        const map = yield* learn.map;
        assert.strictEqual(
          map.stations[0]?.misconception,
          "Plants make sugar from light, water and air.",
        );
      }),
    ),
  );

  it.effect("a finished two-card review reports the grades once", () =>
    withLearn(({ learn, calls }) =>
      Effect.gen(function* () {
        const { itemId } = yield* learn.ask({
          threadId: threadA,
          title: "Review",
          items: [clozeItem("alpha", "Alpha is _", "one"), clozeItem("beta", "Beta is _", "two")],
        });
        yield* learn.answer({
          threadId: threadA,
          itemId,
          cardIndex: 0,
          answer: { text: "one" },
          confidence: "high",
          help: "none",
        });
        assert.deepStrictEqual(yield* Ref.get(calls.sends), []);
        yield* learn.answer({
          threadId: threadA,
          itemId,
          cardIndex: 1,
          answer: { text: "two" },
          confidence: "high",
          help: "none",
        });
        const sends = yield* Ref.get(calls.sends);
        assert.strictEqual(sends.length, 1);
        const text = sends[0]?.text ?? "";
        assert.ok(text.includes("alpha"));
        assert.ok(text.includes('"one"'));
        assert.ok(text.includes("correct"));
      }),
    ),
  );

  it.effect("an override changes the rating and logs overridden", () =>
    withLearn(({ learn, db }) =>
      Effect.gen(function* () {
        const { itemId } = yield* learn.ask({
          threadId: threadA,
          items: [clozeItem("fsrs", "The review scheduler runs on _", "FSRS")],
        });
        const answered = yield* learn.answer({
          threadId: threadA,
          itemId,
          cardIndex: 0,
          answer: { text: "fsrs" },
          confidence: "medium",
          help: "none",
        });
        assert.strictEqual(answered.result?.rating, "good");
        const overridden = yield* learn.override({
          threadId: threadA,
          itemId,
          cardIndex: 0,
          rating: "again",
        });
        assert.strictEqual(overridden.result?.rating, "again");
        assert.strictEqual(overridden.result?.overridden, true);
        const logRows = decodeReviewLogRows(
          yield* db.use("test.reviewLog", (sqlite) =>
            sqlite.prepare("SELECT overridden FROM learn_review_log").all(),
          ),
        );
        assert.strictEqual(logRows.filter((row) => row.overridden === 1).length, 1);
      }),
    ),
  );

  it.effect("an answer from another thread fails", () =>
    withLearn(({ learn }) =>
      Effect.gen(function* () {
        const { itemId } = yield* learn.ask({
          threadId: threadA,
          items: [clozeItem("fsrs", "The review scheduler runs on _", "FSRS")],
        });
        const failure = yield* learn
          .answer({
            threadId: threadB,
            itemId,
            cardIndex: 0,
            answer: { text: "fsrs" },
            confidence: "high",
            help: "none",
          })
          .pipe(Effect.flip);
        assert.strictEqual(failure._tag, "LearnError");
      }),
    ),
  );

  it.effect("sessionEnd snoozes the thread when the next review is far away", () =>
    withLearn(({ learn, calls }) =>
      Effect.gen(function* () {
        const { itemId } = yield* learn.ask({
          threadId: threadA,
          items: [clozeItem("fsrs", "The review scheduler runs on _", "FSRS")],
        });
        yield* learn.answer({
          threadId: threadA,
          itemId,
          cardIndex: 0,
          answer: { text: "fsrs" },
          confidence: "high",
          help: "none",
        });
        yield* learn.override({ threadId: threadA, itemId, cardIndex: 0, rating: "easy" });
        const ended = yield* learn.sessionEnd({ threadId: threadA, title: "Session", diff: [] });
        assert.strictEqual(ended.payload.widget, "session-end");
        if (ended.snoozeUntil === null) throw new Error("The session end has no next review.");
        const dispatches = yield* Ref.get(calls.dispatches);
        const snoozes = dispatches.filter((command) => command.type === "thread.snooze");
        assert.strictEqual(snoozes.length, 1);
        assert.strictEqual(snoozes[0]?.snoozedUntil, ended.snoozeUntil);
      }),
    ),
  );
});
