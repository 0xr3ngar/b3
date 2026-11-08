// @effect-diagnostics nodeBuiltinImport:off - the resolver reads real files from a fixture tree.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveSqliteVectorPath } from "./sqliteVector.ts";

const VECTOR_PACKAGE = "@sqliteai/sqlite-vector-darwin-arm64";
const DARWIN_ARM64 = { platform: "darwin", arch: "arm64" } as const;
const MAIN_PACKAGE_JSON = JSON.stringify({ main: "dist/index.js" });
const PLATFORM_PACKAGE_JSON = JSON.stringify({ main: "index.js" });

const writeFixture = (root: string, files: Readonly<Record<string, string>>) => {
  for (const [relative, contents] of Object.entries(files)) {
    const target = NodePath.join(root, relative);
    NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
    NodeFS.writeFileSync(target, contents);
  }
};

const anchorUrl = (root: string, relative: string) =>
  NodeURL.pathToFileURL(NodePath.join(root, relative)).href;

describe("resolveSqliteVectorPath", () => {
  it.effect("finds the platform package pnpm nests under sqlite-vector", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-sqlite-vector-" });
      writeFixture(root, {
        "app.asar/bin.mjs": "",
        "app.asar/node_modules/@sqliteai/sqlite-vector/package.json": MAIN_PACKAGE_JSON,
        "app.asar/node_modules/@sqliteai/sqlite-vector/dist/index.js": "",
        [`app.asar/node_modules/@sqliteai/sqlite-vector/node_modules/${VECTOR_PACKAGE}/package.json`]:
          PLATFORM_PACKAGE_JSON,
        [`app.asar.unpacked/node_modules/@sqliteai/sqlite-vector/node_modules/${VECTOR_PACKAGE}/vector.dylib`]:
          "",
      });

      const resolved = resolveSqliteVectorPath(DARWIN_ARM64, anchorUrl(root, "app.asar/bin.mjs"));

      expect(resolved).toEqual({
        path: path.join(
          root,
          `app.asar.unpacked/node_modules/@sqliteai/sqlite-vector/node_modules/${VECTOR_PACKAGE}/vector.dylib`,
        ),
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("resolves a hoisted platform package without an archive", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-sqlite-vector-" });
      writeFixture(root, {
        "bin.mjs": "",
        "node_modules/@sqliteai/sqlite-vector/package.json": MAIN_PACKAGE_JSON,
        "node_modules/@sqliteai/sqlite-vector/dist/index.js": "",
        [`node_modules/${VECTOR_PACKAGE}/package.json`]: PLATFORM_PACKAGE_JSON,
        [`node_modules/${VECTOR_PACKAGE}/vector.dylib`]: "",
      });

      const resolved = resolveSqliteVectorPath(DARWIN_ARM64, anchorUrl(root, "bin.mjs"));

      expect(resolved).toEqual({
        path: path.join(root, `node_modules/${VECTOR_PACKAGE}/vector.dylib`),
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a missing platform package", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-sqlite-vector-" });
      writeFixture(root, { "bin.mjs": "" });

      const resolved = resolveSqliteVectorPath(DARWIN_ARM64, anchorUrl(root, "bin.mjs"));

      expect(resolved).toEqual({ error: `${VECTOR_PACKAGE} is not installed.` });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it("reports a host with no published build", () => {
    const resolved = resolveSqliteVectorPath({ platform: "win32", arch: "arm64" }, import.meta.url);
    expect(resolved).toEqual({ error: "sqlite-vector has no build for win32-arm64." });
  });
});
