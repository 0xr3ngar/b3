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

/**
 * pnpm nests the optional platform packages under the main one, so the bundle's
 * own location cannot see them. Resolve through sqlite-vector, then fall back to
 * the module itself for a hoisted install.
 */
const findPlatformPackageDir = (name: string, moduleUrl: string): string | null => {
  const fromModule = NodeModule.createRequire(moduleUrl);
  const anchors = [fromModule];
  try {
    anchors.push(NodeModule.createRequire(fromModule.resolve("@sqliteai/sqlite-vector")));
  } catch {
    // Without the main package, only a hoisted platform package is reachable.
  }
  for (const anchor of anchors) {
    try {
      return NodePath.dirname(anchor.resolve(`${name}/package.json`));
    } catch {
      continue;
    }
  }
  return null;
};

export function resolveSqliteVectorPath(
  host: { readonly platform: string; readonly arch: string },
  /** Test seam: the module the platform package is resolved from. */
  moduleUrl: string = import.meta.url,
): { path: string } | { error: string } {
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
  const directory = findPlatformPackageDir(name, moduleUrl);
  if (directory === null) return { error: `${name} is not installed.` };
  // Electron serves unpacked natives from <archive>.asar.unpacked.
  const path = NodePath.join(directory, binary).replace(/(\.asar)([\\/])/, "$1.unpacked$2");
  return NodeFS.existsSync(path) ? { path } : { error: `${name} is missing ${binary}.` };
}
