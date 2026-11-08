// @effect-diagnostics nodeBuiltinImport:off - native extension resolution needs Node's module resolver.
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeFS from "node:fs";

const PLATFORM_PACKAGES: Record<string, string> = {
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x86_64",
  "linux-arm64": "linux-arm64",
  "linux-x64": "linux-x86_64",
  "win32-x64": "win32-x86_64",
};

const isMusl = (platform: string) => {
  if (platform !== "linux") return false;
  const report = process.report?.getReport() as
    | { readonly header?: { readonly glibcVersionRuntime?: string } }
    | undefined;
  return report?.header?.glibcVersionRuntime === undefined;
};

/** The package's ESM entry cannot `require` its platform package, so resolve the binary directly. */
export function resolveSqliteVectorPath(host: {
  readonly platform: string;
  readonly arch: string;
}): { path: string } | { error: string } {
  const key = PLATFORM_PACKAGES[`${host.platform}-${host.arch}`];
  if (key === undefined) {
    return { error: `sqlite-vector has no build for ${host.platform}-${host.arch}.` };
  }
  const name = `@sqliteai/sqlite-vector-${key}${isMusl(host.platform) ? "-musl" : ""}`;
  const binary =
    host.platform === "win32"
      ? "vector.dll"
      : host.platform === "darwin"
        ? "vector.dylib"
        : "vector.so";
  try {
    const require = NodeModule.createRequire(import.meta.url);
    const manifest = require.resolve(`${name}/package.json`);
    // Electron serves unpacked natives from app.asar.unpacked.
    const path = NodePath.join(NodePath.dirname(manifest), binary).replace(
      `app.asar${NodePath.sep}`,
      `app.asar.unpacked${NodePath.sep}`,
    );
    return NodeFS.existsSync(path) ? { path } : { error: `${name} is missing ${binary}.` };
  } catch {
    return { error: `${name} is not installed.` };
  }
}
