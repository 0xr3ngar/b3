// @effect-diagnostics nodeBuiltinImport:off - node:sqlite is the only SQLite binding that loads extensions here.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../config.ts";
import { UNIVERSAL_MIGRATIONS } from "./migrations.ts";
import { resolveSqliteVectorPath } from "./sqliteVector.ts";

export class UniversalDbError extends Schema.TaggedError<UniversalDbError>()("UniversalDbError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `The b3 database failed during ${this.operation}.`;
  }
}

export interface VectorSupport {
  readonly available: boolean;
  readonly reason: string | null;
}

/**
 * The fork's own SQLite file beside `statev2.sqlite`. Upstream owns that file's
 * migrations, VACUUM and extension policy, so fork tables never live there.
 */
export class UniversalDb extends Context.Service<
  UniversalDb,
  {
    readonly path: string;
    readonly vector: VectorSupport;
    /** Synchronous work on the connection; node:sqlite is synchronous and single-connection here. */
    readonly use: <A>(operation: string, f: (db: NodeSqlite.DatabaseSync) => A) => Effect.Effect<A, UniversalDbError>;
    readonly transaction: <A>(
      operation: string,
      f: (db: NodeSqlite.DatabaseSync) => A,
    ) => Effect.Effect<A, UniversalDbError>;
    readonly sizeBytes: Effect.Effect<number>;
  }
>()("t3/universal/UniversalDb") {}

const migrate = (db: NodeSqlite.DatabaseSync) => {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
  const current = row?.user_version ?? 0;
  for (let index = current; index < UNIVERSAL_MIGRATIONS.length; index++) {
    db.exec("BEGIN");
    try {
      db.exec(UNIVERSAL_MIGRATIONS[index] ?? "");
      db.exec(`PRAGMA user_version = ${index + 1}`);
      db.exec("COMMIT");
    } catch (cause) {
      db.exec("ROLLBACK");
      throw cause;
    }
  }
};

interface Host {
  readonly platform: string;
  readonly arch: string;
}

const loadVector = (db: NodeSqlite.DatabaseSync, host: Host): VectorSupport => {
  const resolved = resolveSqliteVectorPath(host);
  if ("error" in resolved) return { available: false, reason: resolved.error };
  try {
    db.loadExtension(resolved.path);
    db.prepare("SELECT vector_version()").get();
    return { available: true, reason: null };
  } catch (cause) {
    return {
      available: false,
      reason: cause instanceof Error ? cause.message : "sqlite-vector failed to load.",
    };
  }
};

export const openUniversalDatabase = (path: string, host: Host) => {
  if (path !== ":memory:") NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  let db: NodeSqlite.DatabaseSync;
  try {
    db = new NodeSqlite.DatabaseSync(path, { allowExtension: true });
  } catch {
    // Runtimes built without extension loading still get FTS-only memory.
    db = new NodeSqlite.DatabaseSync(path);
  }
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  const vector = loadVector(db, host);
  migrate(db);
  return { db, vector };
};

const makeWithDatabase = (path: string, opened: ReturnType<typeof openUniversalDatabase>) => {
  const { db, vector } = opened;
  const use: UniversalDb["Service"]["use"] = (operation, f) =>
    Effect.try({
      try: () => f(db),
      catch: (cause) => new UniversalDbError({ operation, cause }),
    });
  const transaction: UniversalDb["Service"]["transaction"] = (operation, f) =>
    Effect.try({
      try: () => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = f(db);
          db.exec("COMMIT");
          return result;
        } catch (cause) {
          db.exec("ROLLBACK");
          throw cause;
        }
      },
      catch: (cause) => new UniversalDbError({ operation, cause }),
    });
  const sizeBytes = Effect.sync(() => {
    if (path === ":memory:") return 0;
    let total = 0;
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        total += NodeFS.statSync(`${path}${suffix}`).size;
      } catch {
        // Missing WAL/SHM files are normal.
      }
    }
    return total;
  });
  return UniversalDb.of({ path, vector, use, transaction, sizeBytes });
};

const universalDbPath = (stateDir: string) => NodePath.join(stateDir, "universal.sqlite");

export const layer = Layer.effect(
  UniversalDb,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = universalDbPath(config.stateDir);
    const host = { platform: yield* HostProcess.Platform, arch: yield* HostProcess.Architecture };
    const opened = yield* Effect.acquireRelease(
      Effect.try({
        try: () => openUniversalDatabase(path, host),
        catch: (cause) => new UniversalDbError({ operation: "open", cause }),
      }),
      ({ db }) => Effect.sync(() => db.close()),
    );
    return makeWithDatabase(path, opened);
  }),
);

/** In-memory database for tests. */
export const layerMemory = Layer.effect(
  UniversalDb,
  Effect.acquireRelease(
    Effect.all({ platform: HostProcess.Platform, arch: HostProcess.Architecture }).pipe(
      Effect.map((host) => openUniversalDatabase(":memory:", host)),
    ),
    ({ db }) => Effect.sync(() => db.close()),
  ).pipe(Effect.map((opened) => makeWithDatabase(":memory:", opened))),
);
