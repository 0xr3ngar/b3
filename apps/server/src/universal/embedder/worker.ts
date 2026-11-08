// @effect-diagnostics nodeBuiltinImport:off - the worker owns its thread; Effect has no worker API.
// oxlint-disable unicorn/require-post-message-target-origin -- Node's worker postMessage takes no target origin.
import * as NodeWorkerThreads from "node:worker_threads";
import { AutoConfig, env, pipeline } from "@huggingface/transformers";
import type { ProgressInfo } from "@huggingface/transformers";
import { findEmbedderModel } from "./models.ts";
import type { EmbeddingKind } from "./models.ts";

export interface EmbedderWorkerData {
  readonly cacheDir: string;
  readonly modelId: string;
}

export type EmbedderWorkerRequest =
  | { readonly type: "load" }
  | {
      readonly type: "embed";
      readonly id: number;
      readonly texts: ReadonlyArray<string>;
      readonly kind: EmbeddingKind;
    }
  | { readonly type: "dispose" };

export type EmbedderWorkerResponse =
  | { readonly type: "loaded" }
  | { readonly type: "progress"; readonly loadedBytes: number; readonly totalBytes: number }
  | { readonly type: "vectors"; readonly id: number; readonly vectors: ReadonlyArray<Float32Array> }
  | { readonly type: "error"; readonly id?: number; readonly message: string };

const BATCH_SIZE = 16;

const messageOf = (cause: unknown) =>
  cause instanceof Error
    ? cause.message || cause.stack?.split("\n").slice(0, 3).join(" ") || cause.name
    : String(cause);

const parent = NodeWorkerThreads.parentPort;
if (parent === null) {
  throw new Error("The embedder worker needs a parent port.");
}

const { cacheDir, modelId } = NodeWorkerThreads.workerData as EmbedderWorkerData;

const files = new Map<string, { loaded: number; total: number }>();

const reportProgress = (info: ProgressInfo) => {
  if (info.status !== "progress") return;
  files.set(info.file, { loaded: info.loaded, total: info.total });
  let loadedBytes = 0;
  let totalBytes = 0;
  for (const file of files.values()) {
    loadedBytes += file.loaded;
    totalBytes += file.total;
  }
  parent.postMessage({
    type: "progress",
    loadedBytes,
    totalBytes,
  } satisfies EmbedderWorkerResponse);
};

const buildExtractor = async () => {
  const model = findEmbedderModel(modelId);
  if (model?.hfRepo === undefined) {
    throw new Error(`The embedder model ${modelId} has no local repo.`);
  }
  env.cacheDir = cacheDir;
  const config = await AutoConfig.from_pretrained(model.hfRepo, {
    cache_dir: cacheDir,
    ...(model.revision === undefined ? {} : { revision: model.revision }),
  });
  // Text tower only: the vision and audio encoders load only when their configs exist.
  Object.assign(config, { vision_config: null, audio_config: null });
  const extractor = await pipeline("feature-extraction", model.hfRepo, {
    device: "cpu",
    ...(model.dtype === undefined ? {} : { dtype: model.dtype }),
    cache_dir: cacheDir,
    ...(model.revision === undefined ? {} : { revision: model.revision }),
    config,
    progress_callback: reportProgress,
  });
  // EmbeddingGemma declares a 1e33 tokenizer limit; the model truncates at 8192.
  extractor.tokenizer._tokenizerConfig.model_max_length = model.maxTokens;
  return extractor;
};

let extractor: Awaited<ReturnType<typeof buildExtractor>> | null = null;

// Tensor data is typed as any typed array; feature extraction always yields float32.
const toFloat32 = (data: { readonly length: number; [index: number]: unknown }) => {
  const values = new Float32Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    values[index] = Number(data[index] ?? 0);
  }
  return values;
};

const embedTexts = async (texts: ReadonlyArray<string>, kind: EmbeddingKind) => {
  const model = findEmbedderModel(modelId);
  if (model === undefined || extractor === null) {
    throw new Error(`The embedder model ${modelId} is not loaded.`);
  }
  const prefixed = texts.map((text) =>
    kind === "query" ? model.queryPrefix(text) : model.docPrefix(text),
  );
  const vectors: Array<Float32Array<ArrayBuffer>> = [];
  for (let start = 0; start < prefixed.length; start += BATCH_SIZE) {
    const batch = prefixed.slice(start, start + BATCH_SIZE);
    const output = await extractor(batch, { pooling: model.pooling, normalize: true });
    const dims = output.dims.at(-1) ?? model.dims;
    const flat = toFloat32(output.data);
    for (let index = 0; index < batch.length; index += 1) {
      vectors.push(flat.slice(index * dims, (index + 1) * dims));
    }
  }
  return vectors;
};

const handle = async (message: EmbedderWorkerRequest) => {
  if (message.type === "dispose") {
    await extractor?.dispose();
    extractor = null;
    parent.close();
    return;
  }
  if (message.type === "load") {
    try {
      extractor = await buildExtractor();
      env.allowRemoteModels = false;
      parent.postMessage({ type: "loaded" } satisfies EmbedderWorkerResponse);
    } catch (cause) {
      parent.postMessage({
        type: "error",
        message: messageOf(cause),
      } satisfies EmbedderWorkerResponse);
    }
    return;
  }
  try {
    const vectors = await embedTexts(message.texts, message.kind);
    parent.postMessage(
      { type: "vectors", id: message.id, vectors } satisfies EmbedderWorkerResponse,
      vectors.map((vector) => vector.buffer),
    );
  } catch (cause) {
    parent.postMessage({
      type: "error",
      id: message.id,
      message: messageOf(cause),
    } satisfies EmbedderWorkerResponse);
  }
};

parent.on("message", (message: EmbedderWorkerRequest) => {
  void handle(message);
});
