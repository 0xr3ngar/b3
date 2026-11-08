/**
 * The embedding models T3 Universal can use for memory. Every entry pins the
 * things that define the vector space: repo, revision, dtype, dimensions,
 * pooling and the exact prefix functions. Changing any of them is a re-embed.
 */
export type EmbedderProvider = "local" | "gemini";

export type EmbedderPooling = "mean" | "cls" | "last_token";

export type EmbeddingKind = "query" | "doc";

export type EmbedderDtype = "fp32" | "q8";

export interface EmbedderModel {
  readonly id: string;
  readonly label: string;
  readonly provider: EmbedderProvider;
  readonly hfRepo?: string;
  readonly revision?: string;
  readonly dtype?: EmbedderDtype;
  readonly dims: number;
  readonly pooling: EmbedderPooling;
  readonly normalize: true;
  readonly queryPrefix: (query: string) => string;
  readonly docPrefix: (doc: string) => string;
  readonly approxDownloadMb: number;
  readonly maxTokens: number;
  readonly languages: string;
}

// EmbeddingGemma 2 and gemini-embedding-2 read their task from the text prefix.
// https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2
const gemmaQueryPrefix = (query: string) => `task: search result | query: ${query}`;
const gemmaDocPrefix = (doc: string) => `title: none | text: ${doc}`;

// Qwen3-Embedding instructs queries only, in English, and embeds documents raw.
// https://huggingface.co/Qwen/Qwen3-Embedding-0.6B
const QWEN_TASK = "Given a web search query, retrieve relevant passages that answer the query";
const qwenQueryPrefix = (query: string) => `Instruct: ${QWEN_TASK}\nQuery:${query}`;
const qwenDocPrefix = (doc: string) => doc;

// e5 requires both prefixes; dropping one is a silent quality drop.
// https://huggingface.co/intfloat/multilingual-e5-small
const e5QueryPrefix = (query: string) => `query: ${query}`;
const e5DocPrefix = (doc: string) => `passage: ${doc}`;

export const EMBEDDER_MODELS: Readonly<Record<string, EmbedderModel>> = {
  "embeddinggemma-2": {
    id: "embeddinggemma-2",
    label: "EmbeddingGemma 2",
    provider: "local",
    hfRepo: "onnx-community/embeddinggemma-2-ONNX",
    revision: "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
    dtype: "q8",
    dims: 768,
    pooling: "mean",
    normalize: true,
    queryPrefix: gemmaQueryPrefix,
    docPrefix: gemmaDocPrefix,
    approxDownloadMb: 314,
    maxTokens: 8192,
    languages: "100+ languages",
  },
  "multilingual-e5-small": {
    id: "multilingual-e5-small",
    label: "multilingual-e5-small",
    provider: "local",
    hfRepo: "Xenova/multilingual-e5-small",
    revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
    dtype: "q8",
    dims: 384,
    pooling: "mean",
    normalize: true,
    queryPrefix: e5QueryPrefix,
    docPrefix: e5DocPrefix,
    approxDownloadMb: 118,
    maxTokens: 512,
    languages: "100 languages",
  },
  "qwen3-embedding-0.6b": {
    id: "qwen3-embedding-0.6b",
    label: "Qwen3-Embedding-0.6B",
    provider: "local",
    hfRepo: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    revision: "c25a394dd583836952667c12f008335071b3f43d",
    dtype: "q8",
    dims: 1024,
    pooling: "last_token",
    normalize: true,
    queryPrefix: qwenQueryPrefix,
    docPrefix: qwenDocPrefix,
    approxDownloadMb: 614,
    maxTokens: 32768,
    languages: "100+ languages",
  },
  "gemini-embedding-2": {
    id: "gemini-embedding-2",
    label: "Gemini Embedding 2 (cloud)",
    provider: "gemini",
    dims: 768,
    pooling: "mean",
    normalize: true,
    queryPrefix: gemmaQueryPrefix,
    docPrefix: gemmaDocPrefix,
    approxDownloadMb: 0,
    maxTokens: 8192,
    languages: "text, image, audio, video",
  },
};

export const DEFAULT_EMBEDDER_ID = "embeddinggemma-2";

export const findEmbedderModel = (modelId: string): EmbedderModel | undefined =>
  EMBEDDER_MODELS[modelId];
