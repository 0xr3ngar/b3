// @effect-diagnostics nodeBuiltinImport:off - a manual script writes to the raw stdout stream.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as Embedder from "../Embedder.ts";
import { findEmbedderModel } from "../models.ts";

const modelId = process.argv[2] ?? "multilingual-e5-small";
const cacheDir = process.argv[3] ?? NodePath.join(NodeOS.homedir(), ".cache", "t3-embedder-smoke");

const SENTENCES: ReadonlyArray<string> = [
  "Котката обича да спи на клавиатурата.",
  "The cat likes to sleep on the keyboard.",
  "Кучето обича да тича в парка.",
];

const QUERY = "къде обича да спи котката";

const write = (line: string) => process.stdout.write(`${line}\n`);

const cosine = (left: Float32Array, right: Float32Array) => {
  let dot = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftSquared += l * l;
    rightSquared += r * r;
  }
  const length = Math.sqrt(leftSquared) * Math.sqrt(rightSquared);
  return length === 0 ? 0 : dot / length;
};

const main = Effect.gen(function* () {
  const embedder = yield* Embedder.Embedder;
  const model = findEmbedderModel(modelId);
  write(`model ${modelId} (${model?.approxDownloadMb ?? 0} MB, ${model?.dims ?? 0} dims)`);
  write(`cache ${cacheDir}`);

  const startedAt = yield* Clock.currentTimeMillis;
  yield* embedder.setModel(modelId);
  const vectors = yield* embedder.embed(SENTENCES, "doc");
  const loadedAt = yield* Clock.currentTimeMillis;
  const elapsedMs = loadedAt - startedAt;

  write(`load + ${SENTENCES.length} texts in ${elapsedMs} ms`);
  write(
    `vector 0: ${Array.from(vectors[0] ?? [])
      .slice(0, 4)
      .map((value) => value.toFixed(4))
      .join(", ")} …`,
  );

  for (let left = 0; left < vectors.length; left += 1) {
    for (let right = left + 1; right < vectors.length; right += 1) {
      const a = vectors[left];
      const b = vectors[right];
      if (a === undefined || b === undefined) continue;
      write(`cos(${left}, ${right}) = ${cosine(a, b).toFixed(4)}`);
    }
  }

  const query = yield* embedder.embed([QUERY], "query");
  const queryVector = query[0];
  if (queryVector !== undefined) {
    for (let index = 0; index < vectors.length; index += 1) {
      const candidate = vectors[index];
      if (candidate === undefined) continue;
      write(`cos(query, ${index}) = ${cosine(queryVector, candidate).toFixed(4)}`);
    }
  }

  const benchmark = yield* embedder.benchmark();
  write(
    `benchmark: ${benchmark.texts} texts in ${benchmark.totalMs} ms, ${benchmark.msPerText.toFixed(1)} ms/text`,
  );

  const status = yield* SubscriptionRef.get(embedder.status);
  write(`status ${status.state} ${status.modelId} ${status.dims} dims`);
});

try {
  await Effect.runPromise(main.pipe(Effect.provide(Embedder.layer({ cacheDir }))));
} catch (cause) {
  write(`failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exitCode = 1;
}
