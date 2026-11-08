import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as Embedder from "./Embedder.ts";
import type { EmbedderWorkerHandle } from "./Embedder.ts";
import { DEFAULT_EMBEDDER_ID, EMBEDDER_MODELS, findEmbedderModel } from "./models.ts";
import type {
  EmbedderWorkerData,
  EmbedderWorkerRequest,
  EmbedderWorkerResponse,
} from "./worker.ts";

const vector = (seed: number) =>
  Float32Array.from({ length: 768 }, (_, index) => (seed + index) / 768);

const makeFakeWorker = () => {
  const requests: Array<EmbedderWorkerRequest> = [];
  const takeWaiters: Array<(message: EmbedderWorkerRequest) => void> = [];
  const datas: Array<EmbedderWorkerData> = [];
  let listener: (message: EmbedderWorkerResponse) => void = () => {};
  let crashListener: (cause: Error) => void = () => {};
  let exitListener: () => void = () => {};
  let unanswered = 0;
  let violations = 0;
  let terminates = 0;

  const handle: EmbedderWorkerHandle = {
    postMessage: (message) => {
      if (message.type === "embed") {
        if (unanswered > 0) violations += 1;
        unanswered += 1;
      }
      const waiter = takeWaiters.shift();
      if (waiter === undefined) requests.push(message);
      else waiter(message);
    },
    onMessage: (next) => {
      listener = next;
    },
    onError: (next) => {
      crashListener = next;
    },
    onExit: (next) => {
      exitListener = next;
    },
    terminate: () => {
      terminates += 1;
    },
  };

  return {
    handle,
    factory: (data: EmbedderWorkerData) => {
      datas.push(data);
      return handle;
    },
    take: Effect.callback<EmbedderWorkerRequest>((resume, _signal) => {
      const next = requests.shift();
      if (next === undefined) {
        takeWaiters.push((message) => resume(Effect.succeed(message)));
        return;
      }
      resume(Effect.succeed(next));
    }),
    respond: (message: EmbedderWorkerResponse) => {
      if (message.type === "vectors") unanswered -= 1;
      listener(message);
    },
    crash: (cause: Error) => {
      crashListener(cause);
    },
    exit: () => {
      exitListener();
    },
    datas: () => datas,
    violations: () => violations,
    terminates: () => terminates,
  };
};

describe("embedder registry", () => {
  it("defaults to embeddinggemma-2 with its task prefixes", () => {
    const model = findEmbedderModel(DEFAULT_EMBEDDER_ID);
    if (model === undefined) throw new Error("The default embedder is missing.");
    assert.strictEqual(model.provider, "local");
    assert.strictEqual(model.dims, 768);
    assert.strictEqual(model.pooling, "mean");
    assert.strictEqual(
      model.queryPrefix("how do I restart the daemon"),
      "task: search result | query: how do I restart the daemon",
    );
    assert.strictEqual(
      model.docPrefix("the daemon restarts nightly"),
      "title: none | text: the daemon restarts nightly",
    );
  });

  it("prefixes e5 queries and passages", () => {
    const model = findEmbedderModel("multilingual-e5-small");
    if (model === undefined) throw new Error("The e5 embedder is missing.");
    assert.strictEqual(model.dims, 384);
    assert.strictEqual(model.queryPrefix("котка"), "query: котка");
    assert.strictEqual(model.docPrefix("котка"), "passage: котка");
  });

  it("instructs qwen queries and leaves documents raw", () => {
    const model = findEmbedderModel("qwen3-embedding-0.6b");
    if (model === undefined) throw new Error("The qwen embedder is missing.");
    assert.strictEqual(model.dims, 1024);
    assert.strictEqual(model.pooling, "last_token");
    assert.strictEqual(
      model.queryPrefix("how do I restart the daemon"),
      "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:how do I restart the daemon",
    );
    assert.strictEqual(
      model.docPrefix("the daemon restarts nightly"),
      "the daemon restarts nightly",
    );
  });

  it("gives every local model a pinned repo, revision, dtype and token limit", () => {
    for (const model of Object.values(EMBEDDER_MODELS)) {
      assert.isTrue(model.normalize);
      assert.isAbove(model.maxTokens, 0);
      assert.isAbove(model.dims, 0);
      if (model.provider !== "local") continue;
      assert.isString(model.hfRepo);
      assert.isString(model.revision);
      assert.isString(model.dtype);
    }
  });
});

describe("Embedder", () => {
  it.effect("serializes one worker request at a time", () => {
    const fake = makeFakeWorker();
    const layer = Embedder.layer({ cacheDir: "/unused", workerFactory: fake.factory });
    return Effect.gen(function* () {
      const embedder = yield* Embedder.Embedder;

      const first = yield* embedder.embed(["first memory"], "query").pipe(Effect.forkChild);
      assert.deepStrictEqual(yield* fake.take, { type: "load" });
      fake.respond({ type: "loaded" });
      assert.deepStrictEqual(yield* fake.take, {
        type: "embed",
        id: 1,
        texts: ["first memory"],
        kind: "query",
      });
      assert.strictEqual((yield* SubscriptionRef.get(embedder.status)).state, "ready");

      const second = yield* embedder.embed(["second memory"], "doc").pipe(Effect.forkChild);

      fake.respond({ type: "vectors", id: 1, vectors: [vector(1)] });
      assert.deepStrictEqual(yield* fake.take, {
        type: "embed",
        id: 2,
        texts: ["second memory"],
        kind: "doc",
      });
      fake.respond({ type: "vectors", id: 2, vectors: [vector(2)] });

      assert.strictEqual((yield* Fiber.join(first))[0]?.[0], vector(1)[0]);
      assert.strictEqual((yield* Fiber.join(second))[0]?.[0], vector(2)[0]);
      assert.strictEqual(fake.violations(), 0);
      assert.deepStrictEqual(fake.datas(), [{ cacheDir: "/unused", modelId: DEFAULT_EMBEDDER_ID }]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("restarts the worker once after a crash, then reports the error", () => {
    const fake = makeFakeWorker();
    const layer = Embedder.layer({ cacheDir: "/unused", workerFactory: fake.factory });
    return Effect.gen(function* () {
      const embedder = yield* Embedder.Embedder;

      const first = yield* embedder.embed(["first memory"], "query").pipe(Effect.forkChild);
      yield* fake.take;
      fake.respond({ type: "loaded" });
      yield* fake.take;

      fake.crash(new Error("onnxruntime aborted"));
      assert.isTrue(Exit.isFailure(yield* Effect.exit(Fiber.join(first))));
      assert.strictEqual((yield* SubscriptionRef.get(embedder.status)).state, "idle");

      const second = yield* embedder.embed(["second memory"], "query").pipe(Effect.forkChild);
      assert.deepStrictEqual(yield* fake.take, { type: "load" });
      fake.respond({ type: "loaded" });
      yield* fake.take;
      fake.respond({ type: "vectors", id: 2, vectors: [vector(2)] });
      assert.strictEqual((yield* Fiber.join(second))[0]?.[0], vector(2)[0]);

      const third = yield* embedder.embed(["third memory"], "query").pipe(Effect.forkChild);
      yield* fake.take;
      fake.crash(new Error("onnxruntime aborted again"));
      assert.isTrue(Exit.isFailure(yield* Effect.exit(Fiber.join(third))));

      const status = yield* SubscriptionRef.get(embedder.status);
      assert.strictEqual(status.state, "error");
      assert.strictEqual(status.error, "onnxruntime aborted again");
      assert.isTrue(Exit.isFailure(yield* Effect.exit(embedder.embed(["fourth memory"], "query"))));
    }).pipe(Effect.provide(layer));
  });

  it.effect("disposes the worker and reports the new dimensions on a model change", () => {
    const fake = makeFakeWorker();
    const layer = Embedder.layer({ cacheDir: "/unused", workerFactory: fake.factory });
    return Effect.gen(function* () {
      const embedder = yield* Embedder.Embedder;

      const first = yield* embedder.embed(["first memory"], "query").pipe(Effect.forkChild);
      yield* fake.take;
      fake.respond({ type: "loaded" });
      yield* fake.take;
      fake.respond({ type: "vectors", id: 1, vectors: [vector(1)] });
      yield* Fiber.join(first);

      const switching = yield* embedder.setModel("multilingual-e5-small").pipe(Effect.forkChild);
      assert.deepStrictEqual(yield* fake.take, { type: "dispose" });
      fake.exit();
      yield* Fiber.join(switching);

      const status = yield* SubscriptionRef.get(embedder.status);
      assert.strictEqual(status.modelId, "multilingual-e5-small");
      assert.strictEqual(status.dims, 384);
      assert.strictEqual(status.state, "idle");

      yield* embedder.embed(["second memory"], "doc").pipe(Effect.forkChild);
      assert.deepStrictEqual(yield* fake.take, { type: "load" });
      assert.deepStrictEqual(fake.datas().at(-1), {
        cacheDir: "/unused",
        modelId: "multilingual-e5-small",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("embeds through Gemini at 768 dimensions with the task prefix", () => {
    const fake = makeFakeWorker();
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const doFetch: typeof fetch = (input, init) => {
      calls.push({ url: String(input), init });
      return Promise.resolve(
        new Response(JSON.stringify({ embeddings: [{ values: [3, 4] }] }), { status: 200 }),
      );
    };
    const layer = Embedder.layer({
      cacheDir: "/unused",
      workerFactory: fake.factory,
      fetch: doFetch,
    });
    return Effect.gen(function* () {
      const embedder = yield* Embedder.Embedder;

      yield* embedder.setModel("gemini-embedding-2", { geminiApiKey: "secret-key" });
      const vectors = yield* embedder.embed(["first memory"], "query");

      const call = calls[0];
      if (call === undefined) throw new Error("Gemini was never called.");
      assert.isTrue(call.url.endsWith("models/gemini-embedding-2:batchEmbedContents"));
      assert.strictEqual(new Headers(call.init?.headers).get("x-goog-api-key"), "secret-key");
      assert.deepStrictEqual(JSON.parse(String(call.init?.body)), {
        requests: [
          {
            model: "models/gemini-embedding-2",
            content: { parts: [{ text: "task: search result | query: first memory" }] },
            outputDimensionality: 768,
          },
        ],
      });
      const normalized = Array.from(vectors[0] ?? []);
      assert.closeTo(normalized[0] ?? 0, 0.6, 1e-6);
      assert.closeTo(normalized[1] ?? 0, 0.8, 1e-6);

      yield* embedder.setModel("gemini-embedding-2");
      assert.isTrue(Exit.isFailure(yield* Effect.exit(embedder.embed(["second memory"], "query"))));
      assert.strictEqual((yield* SubscriptionRef.get(embedder.status)).state, "error");
    }).pipe(Effect.provide(layer));
  });
});
