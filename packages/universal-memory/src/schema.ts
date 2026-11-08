import * as Schema from "effect/Schema";

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

const SourceMessageIds = Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(20),
);

export const MemoryOp = Schema.Struct({
  op: Schema.Literal("add"),
  kind: MemoryKind,
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  sourceMessageIds: SourceMessageIds,
  confidence: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  supersedes: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(Schema.isMaxLength(20)),
  ),
  topic: Schema.optional(Schema.String),
});
export type MemoryOp = typeof MemoryOp.Type;

export const KnowledgeSignal = Schema.Struct({
  concept: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  topic: Schema.optional(Schema.String),
  strength: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  sourceMessageIds: SourceMessageIds,
});
export type KnowledgeSignal = typeof KnowledgeSignal.Type;

export const MemoryCommitInput = Schema.Struct({
  batchId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  ops: Schema.Array(MemoryOp).check(Schema.isMaxLength(50)),
  signals: Schema.Array(KnowledgeSignal).check(Schema.isMaxLength(20)),
});
export type MemoryCommitInput = typeof MemoryCommitInput.Type;

export const MemoryRowSource = Schema.Struct({
  threadId: Schema.String,
  messageIds: Schema.Array(Schema.String),
  extractorModel: Schema.NullOr(Schema.String),
});
export type MemoryRowSource = typeof MemoryRowSource.Type;

export const MemoryRow = Schema.Struct({
  id: Schema.String,
  kind: MemoryKind,
  text: Schema.String,
  topic: Schema.NullOr(Schema.String),
  confidence: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  supersededBy: Schema.NullOr(Schema.String),
  deletedAt: Schema.NullOr(Schema.String),
  source: MemoryRowSource,
  origin: Schema.Literals(["extracted", "saved", "edited"]),
});
export type MemoryRow = typeof MemoryRow.Type;
