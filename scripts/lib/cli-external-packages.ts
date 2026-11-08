/** Keep bundler externals and staged runtime dependency roots aligned. */
// Filesystem-loaded externals need dependencies outside the bundle.
const CLI_RUNTIME_EXTERNAL_PREFIXES = [
  // Cursor ships computed Webpack imports and platform helper packages.
  "@cursor/sdk",
  // Playwright reads package.json and browsers.json beside its runtime modules.
  "playwright-core",
  "node-pty",
  "ffi-rs",
  "@yuuang/",
  "@ff-labs/",
  "transcribe-cpp",
  "@transcribe-cpp/",
  "koffi",
  "@koromix/",
  "@napi-rs/keyring",
  "@clerk/electron-passkeys",
  "node-gyp-build",
  "node-addon-api",
  "bufferutil",
  "utf-8-validate",
  // universal-seam:native-externals (b3 embeddings and vector search load native binaries)
  "onnxruntime-",
  "@sqliteai/",
] as const;

// Match Cursor dependency boundaries so zod does not externalize zod-to-json-schema.
const CURSOR_RUNTIME_DEPENDENCIES = [
  "@bufbuild/protobuf",
  "@connectrpc/connect",
  "@connectrpc/connect-node",
  "@connectrpc/connect-web",
  "@statsig/js-client",
  "@statsig/client-core",
  "zod",
  "undici",
  "@fastify/busboy",
] as const;

// universal-seam:native-externals (the runtime closure of b3's native embedder packages)
const UNIVERSAL_RUNTIME_EXTERNALS = new Set([
  "sharp",
  "adm-zip",
  "global-agent",
  "flatbuffers",
  "guid-typescript",
  "long",
  "platform",
  "protobufjs",
  "detect-libc",
  "semver",
  "boolean",
  "es6-error",
  "matcher",
  "roarr",
  "serialize-error",
  "@types/node",
  "undici-types",
  "escape-string-regexp",
  "detect-node",
  "globalthis",
  "json-stringify-safe",
  "semver-compare",
  "sprintf-js",
  "type-fest",
  "define-properties",
  "gopd",
  "define-data-property",
  "has-property-descriptors",
  "object-keys",
  "es-define-property",
  "es-errors",
]);

export function isRuntimeExternalCliDependency(id: string): boolean {
  const bare = id.startsWith("@") ? id.split("/").slice(0, 2).join("/") : (id.split("/")[0] ?? id);
  return (
    UNIVERSAL_RUNTIME_EXTERNALS.has(bare) ||
    ["@huggingface/", "@img/", "@protobufjs/"].some((prefix) => id.startsWith(prefix)) ||
    CLI_RUNTIME_EXTERNAL_PREFIXES.some((prefix) => id.startsWith(prefix)) ||
    CURSOR_RUNTIME_DEPENDENCIES.some((name) => id === name || id.startsWith(`${name}/`))
  );
}

/** Use neverBundle: false from alwaysBundle means no opinion and leaves transitive packages bundled. */
export function isExternalCliDependency(id: string): boolean {
  return isRuntimeExternalCliDependency(id);
}

export function shouldBundleCliDependency(id: string): boolean {
  if (id.startsWith("node:")) return false;
  return !isExternalCliDependency(id);
}

export function selectCliRuntimeExternalDependencies(
  dependencies: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).filter(([name]) => isRuntimeExternalCliDependency(name)),
  );
}

/** regionCount distinguishes a clean bundle from a changed marker format the scan cannot see. */
export function findInlinedExternalPackages(source: string): {
  readonly regionCount: number;
  readonly inlined: ReadonlyArray<string>;
  readonly inlinedPackages: ReadonlyArray<string>;
} {
  // Rolldown marks each inlined module with a `//#region <path>` line; newer
  // releases (vite-plus 1.4) emit a bare `// <path>` line instead.
  const regionPattern = /^\/\/(?:#region)?[ \t]+(\S+)[ \t]*$/gm;
  const packagePattern = /node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//g;

  let regionCount = 0;
  const inlined = new Set<string>();
  const inlinedPackages = new Set<string>();
  for (const region of source.matchAll(regionPattern)) {
    regionCount += 1;
    const regionPath = region[1] ?? "";
    for (const candidate of regionPath.matchAll(packagePattern)) {
      const name = candidate[1];
      if (name === undefined || name === ".pnpm") continue;
      inlinedPackages.add(name);
      if (isExternalCliDependency(name)) inlined.add(name);
    }
  }

  return {
    regionCount,
    inlined: [...inlined].sort(),
    inlinedPackages: [...inlinedPackages].sort(),
  };
}
