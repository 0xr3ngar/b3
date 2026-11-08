// @effect-diagnostics globalFetch:off - the Gemini embedder is a single HTTP call with no Effect client graph.
// @effect-diagnostics nodeBuiltinImport:off - the local embedder is a raw worker thread; Effect has no worker API.
// oxlint-disable unicorn/require-post-message-target-origin -- Node's worker postMessage takes no target origin.
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as NodeWorkerThreads from "node:worker_threads";

import { DEFAULT_EMBEDDER_ID, findEmbedderModel } from "./models.ts";
import type { EmbedderModel, EmbeddingKind } from "./models.ts";
import type {
  EmbedderWorkerData,
  EmbedderWorkerRequest,
  EmbedderWorkerResponse,
} from "./worker.ts";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_BATCH_SIZE = 16;

const BENCHMARK_TEXTS: ReadonlyArray<string> = [
  "Bogdan prefers short answers with the reasoning after the conclusion.",
  "The chuds run DeepSeek on four DGX Sparks behind one head node.",
  "T3 Code keeps every thread as a git worktree on its own branch.",
  "Emilia likes the plan to be written down before anyone writes code.",
  "The memory extractor runs hourly and writes only what will matter later.",
  "Blackwell serves a local model on port 8000 through Tailscale.",
  "Spaced repetition beats rereading when the review is scheduled by a machine.",
  "A quiz question is worth more than a summary of the same chapter.",
  "Обичам да пиша тестове преди да пиша кода.",
  "Котката одобрява бавно с опашка и не бърза никъде.",
  "Плановете се променят, но курсът към целта остава същият.",
  "Паметта трябва да живее на машината, на която работи агентът.",
  "The knowledge map shows what is solid and what is shaky.",
  "Mastery is written only by the Learn space, never by Chat.",
  "Scheduled tasks wake the tutor without a human in the loop.",
  "A widget posts its answer back through the existing RPC channel.",
  "Retrieval with feedback is the core of the whole pedagogy.",
  "Never answer before the learner has made an attempt.",
  "Confidence comes first, then the explanation, then practice.",
  "Unconditional praise teaches nothing that survives a week.",
  "A pretest makes the teaching stick better than a warm-up.",
  "The index stays on disk next to the state database.",
  "Cosine similarity ranks memories, it does not threshold them.",
  "The lite model downloads a hundred and eighteen megabytes once.",
  "The default model keeps its weights in the T3 data directory.",
  "Offline mode turns off remote models after the first download.",
  "A revision pin keeps the vectors from changing under a stable id.",
  "A prefix dropped by accident does not raise an error.",
  "The worker restarts once and then reports the failure.",
  "Progress bytes come from the hub download events.",
  "The benchmark reports milliseconds per text for this machine.",
  "Switching models re-embeds every memory in the background.",
];

export class EmbedderError extends Schema.TaggedError<EmbedderError>()("EmbedderError", {
  operation: Schema.Literals(["load", "embed", "gemini", "model"]),
  modelId: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return `Embedder ${this.operation} failed for ${this.modelId}.`;
  }
}

export interface EmbedderStatus {
  readonly modelId: string;
  readonly state: "idle" | "downloading" | "loading" | "ready" | "error";
  readonly dims: number;
  readonly progress?: { readonly loadedBytes: number; readonly totalBytes: number };
  readonly error?: string;
}

export interface EmbedderBenchmark {
  readonly modelId: string;
  readonly texts: number;
  readonly totalMs: number;
  readonly msPerText: number;
  readonly dims: number;
}

export interface EmbedderWorkerHandle {
  readonly postMessage: (message: EmbedderWorkerRequest) => void;
  readonly onMessage: (listener: (message: EmbedderWorkerResponse) => void) => void;
  readonly onError: (listener: (cause: Error) => void) => void;
  readonly onExit: (listener: () => void) => void;
  readonly terminate: () => void;
}

export interface EmbedderOptions {
  readonly cacheDir: string;
  /** Test seam: replaces the real worker thread. */
  readonly workerFactory?: (data: EmbedderWorkerData) => EmbedderWorkerHandle;
  /** Test seam: replaces the global fetch the Gemini path uses. */
  readonly fetch?: typeof fetch;
}

interface LiveWorker {
  readonly handle: EmbedderWorkerHandle;
  readonly exited: Deferred.Deferred<void>;
}

type EmbedderEvent =
  | { readonly type: "message"; readonly message: EmbedderWorkerResponse }
  | { readonly type: "crash"; readonly handle: EmbedderWorkerHandle; readonly cause: Error | null }
  | { readonly type: "exit"; readonly exited: Deferred.Deferred<void> };

const GeminiBatchRequest = Schema.Struct({
  requests: Schema.Array(
    Schema.Struct({
      model: Schema.String,
      content: Schema.Struct({ parts: Schema.Array(Schema.Struct({ text: Schema.String })) }),
      outputDimensionality: Schema.Number,
    }),
  ),
});
const encodeGeminiBatchRequest = Schema.encodeEffect(Schema.fromJsonString(GeminiBatchRequest));

const GeminiBatchResponse = Schema.Struct({
  embeddings: Schema.Array(Schema.Struct({ values: Schema.Array(Schema.Number) })),
});
const decodeGeminiBatchResponse = Schema.decodeUnknownEffect(GeminiBatchResponse);

export class Embedder extends Context.Service<
  Embedder,
  {
    readonly embed: (
      texts: ReadonlyArray<string>,
      kind: EmbeddingKind,
    ) => Effect.Effect<ReadonlyArray<Float32Array>, EmbedderError>;
    readonly status: SubscriptionRef.SubscriptionRef<EmbedderStatus>;
    readonly setModel: (
      modelId: string,
      options?: { readonly geminiApiKey?: string },
    ) => Effect.Effect<void, EmbedderError>;
    readonly benchmark: () => Effect.Effect<EmbedderBenchmark, EmbedderError>;
  }
>()("t3/universal/embedder/Embedder") {}

const initialStatus = (modelId: string): EmbedderStatus => ({
  modelId,
  state: "idle",
  dims: findEmbedderModel(modelId)?.dims ?? 0,
});

const normalize = (vector: Float32Array) => {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum);
  if (length === 0) return vector;
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = (vector[index] ?? 0) / length;
  }
  return vector;
};

const defaultWorkerFactory = (data: EmbedderWorkerData): EmbedderWorkerHandle => {
  const worker = new NodeWorkerThreads.Worker(new URL("./worker.ts", import.meta.url), {
    workerData: data,
  });
  return {
    postMessage: (message) => worker.postMessage(message),
    onMessage: (listener) => {
      worker.on("message", (message) => listener(message));
    },
    onError: (listener) => {
      worker.on("error", (cause) => listener(cause));
    },
    onExit: (listener) => {
      worker.on("exit", () => listener());
    },
    terminate: () => {
      void worker.terminate();
    },
  };
};

export const layer = (options: EmbedderOptions) =>
  Layer.effect(
    Embedder,
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<EmbedderEvent>();
      const status = yield* SubscriptionRef.make(initialStatus(DEFAULT_EMBEDDER_ID));
      const mutex = yield* Semaphore.make(1);
      const factory = options.workerFactory ?? defaultWorkerFactory;
      const doFetch = options.fetch ?? fetch;

      let modelId = DEFAULT_EMBEDDER_ID;
      let geminiApiKey: string | undefined;
      let worker: LiveWorker | null = null;
      let loadWaiter: Deferred.Deferred<void, EmbedderError> | null = null;
      let crashes = 0;
      let requestId = 0;
      const pending = new Map<
        number,
        Deferred.Deferred<ReadonlyArray<Float32Array>, EmbedderError>
      >();

      const failureOf = (operation: "load" | "embed" | "gemini" | "model", detail: string) =>
        new EmbedderError({ operation, modelId, cause: new Error(detail) });

      const setStatus = Effect.fnUntraced(function* (next: EmbedderStatus) {
        yield* SubscriptionRef.set(status, next);
      });

      const handleEvent = Effect.fnUntraced(function* (event: EmbedderEvent) {
        if (event.type === "exit") {
          yield* Deferred.succeed(event.exited, undefined);
          return;
        }
        if (event.type === "message") {
          const message = event.message;
          if (message.type === "progress") {
            yield* setStatus({
              ...initialStatus(modelId),
              state: "downloading",
              progress: { loadedBytes: message.loadedBytes, totalBytes: message.totalBytes },
            });
            return;
          }
          if (message.type === "loaded") {
            const waiter = loadWaiter;
            loadWaiter = null;
            yield* setStatus({ ...initialStatus(modelId), state: "ready" });
            if (waiter !== null) yield* Deferred.succeed(waiter, undefined);
            return;
          }
          if (message.type === "vectors") {
            const waiter = pending.get(message.id);
            pending.delete(message.id);
            if (waiter !== undefined) yield* Deferred.succeed(waiter, message.vectors);
            return;
          }
          if (message.id === undefined) {
            const waiter = loadWaiter;
            loadWaiter = null;
            worker?.handle.terminate();
            worker = null;
            yield* setStatus({ ...initialStatus(modelId), state: "error", error: message.message });
            if (waiter !== null) yield* Deferred.fail(waiter, failureOf("load", message.message));
            return;
          }
          const waiter = pending.get(message.id);
          pending.delete(message.id);
          if (waiter !== undefined)
            yield* Deferred.fail(waiter, failureOf("embed", message.message));
          return;
        }

        // A worker we already replaced keeps reporting its own crash; ignore it.
        if (event.handle !== worker?.handle) return;
        worker = null;
        const detail = event.cause?.message ?? "The embedder worker exited.";
        crashes += 1;
        // The status lands before the failure, so a caller that sees the error sees it too.
        const crashed: EmbedderStatus =
          crashes >= 2
            ? { ...initialStatus(modelId), state: "error", error: detail }
            : initialStatus(modelId);
        yield* setStatus(crashed);
        const waiter = loadWaiter;
        loadWaiter = null;
        if (waiter !== null) yield* Deferred.fail(waiter, failureOf("load", detail));
        const requests = [...pending.values()];
        pending.clear();
        for (const request of requests) yield* Deferred.fail(request, failureOf("embed", detail));
      });

      const ensureWorker = Effect.fnUntraced(function* () {
        if (worker !== null) return worker.handle;
        if (findEmbedderModel(modelId) === undefined) {
          return yield* failureOf("model", "Unknown embedder model.");
        }
        if (crashes >= 2) {
          return yield* failureOf("load", "The embedder worker crashed twice.");
        }
        yield* setStatus({ ...initialStatus(modelId), state: "loading" });
        const created = factory({ cacheDir: options.cacheDir, modelId });
        const waiter = yield* Deferred.make<void, EmbedderError>();
        const exited = yield* Deferred.make<void>();
        loadWaiter = waiter;
        created.onMessage((message) => {
          Queue.offerUnsafe(events, { type: "message", message });
        });
        created.onError((cause) => {
          Queue.offerUnsafe(events, { type: "crash", handle: created, cause });
        });
        created.onExit(() => {
          Queue.offerUnsafe(events, { type: "exit", exited });
        });
        worker = { handle: created, exited };
        created.postMessage({ type: "load" });
        yield* Deferred.await(waiter);
        return created;
      });

      const stopWorker = Effect.fnUntraced(function* () {
        const current = worker;
        if (current === null) return;
        worker = null;
        loadWaiter = null;
        current.handle.postMessage({ type: "dispose" });
        yield* Deferred.await(current.exited);
      });

      const embedLocal = Effect.fnUntraced(function* (
        texts: ReadonlyArray<string>,
        kind: EmbeddingKind,
      ) {
        const current = yield* ensureWorker();
        const id = ++requestId;
        const waiter = yield* Deferred.make<ReadonlyArray<Float32Array>, EmbedderError>();
        pending.set(id, waiter);
        current.postMessage({ type: "embed", id, texts, kind });
        return yield* Deferred.await(waiter);
      });

      const embedGemini = Effect.fnUntraced(function* (
        model: EmbedderModel,
        texts: ReadonlyArray<string>,
        kind: EmbeddingKind,
      ) {
        const apiKey = geminiApiKey;
        if (apiKey === undefined) {
          return yield* failureOf("gemini", "The Gemini embedder needs an API key.");
        }
        const vectors: Array<Float32Array> = [];
        for (let start = 0; start < texts.length; start += GEMINI_BATCH_SIZE) {
          const batch = texts.slice(start, start + GEMINI_BATCH_SIZE);
          const body = {
            requests: batch.map((text) => ({
              model: `models/${model.id}`,
              content: {
                parts: [
                  { text: kind === "query" ? model.queryPrefix(text) : model.docPrefix(text) },
                ],
              },
              outputDimensionality: model.dims,
            })),
          };
          const encoded = yield* encodeGeminiBatchRequest(body).pipe(
            Effect.mapError(() => failureOf("gemini", "The request body could not be encoded.")),
          );
          const response = yield* Effect.tryPromise({
            try: (signal) =>
              doFetch(`${GEMINI_ENDPOINT}/${model.id}:batchEmbedContents`, {
                method: "POST",
                headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
                body: encoded,
                signal,
              }),
            catch: (cause) =>
              failureOf("gemini", cause instanceof Error ? cause.message : "The request failed."),
          });
          if (!response.ok) {
            return yield* failureOf("gemini", `Gemini responded ${response.status}.`);
          }
          const payload = yield* Effect.tryPromise({
            try: () => response.json(),
            catch: (cause) =>
              failureOf(
                "gemini",
                cause instanceof Error ? cause.message : "The response was not JSON.",
              ),
          }).pipe(
            Effect.flatMap((raw) =>
              decodeGeminiBatchResponse(raw).pipe(
                Effect.mapError(() =>
                  failureOf("gemini", "The response was not an embedding batch."),
                ),
              ),
            ),
          );
          for (const embedding of payload.embeddings) {
            vectors.push(normalize(Float32Array.from(embedding.values)));
          }
        }
        return vectors;
      });

      const embed = Effect.fn("Embedder.embed")(function* (
        texts: ReadonlyArray<string>,
        kind: EmbeddingKind,
      ) {
        if (texts.length === 0) return [];
        const model = findEmbedderModel(modelId);
        if (model === undefined) {
          return yield* failureOf("model", "Unknown embedder model.");
        }
        return yield* mutex.withPermit(
          model.provider === "gemini" ? embedGemini(model, texts, kind) : embedLocal(texts, kind),
        );
      });

      const setModel = Effect.fn("Embedder.setModel")(function* (
        nextModelId: string,
        setOptions?: { readonly geminiApiKey?: string },
      ) {
        const model = findEmbedderModel(nextModelId);
        if (model === undefined) {
          return yield* new EmbedderError({
            operation: "model",
            modelId: nextModelId,
            cause: new Error("Unknown embedder model."),
          });
        }
        yield* mutex.withPermit(stopWorker());
        modelId = nextModelId;
        geminiApiKey = setOptions?.geminiApiKey;
        crashes = 0;
        const hasKey = model.provider !== "gemini" || geminiApiKey !== undefined;
        yield* setStatus(
          hasKey
            ? initialStatus(modelId)
            : {
                ...initialStatus(modelId),
                state: "error",
                error: "The Gemini embedder needs an API key.",
              },
        );
      });

      const benchmark = Effect.fn("Embedder.benchmark")(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        const vectors = yield* embed(BENCHMARK_TEXTS, "doc");
        const totalMs = (yield* Clock.currentTimeMillis) - startedAt;
        return {
          modelId,
          texts: BENCHMARK_TEXTS.length,
          totalMs,
          msPerText: totalMs / BENCHMARK_TEXTS.length,
          dims: vectors[0]?.length ?? initialStatus(modelId).dims,
        };
      });

      yield* Effect.forever(Queue.take(events).pipe(Effect.flatMap(handleEvent))).pipe(
        Effect.forkScoped,
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          worker?.handle.terminate();
          worker = null;
        }),
      );

      return Embedder.of({ embed, status, setModel, benchmark });
    }),
  );
