// @effect-diagnostics nodeBuiltinImport:off - a plain repo script run with node.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

// Fails when the fork changes an upstream file that the seam manifest does not list.
const manifest = JSON.parse(NodeFS.readFileSync(".universal/seams.json", "utf8")) as {
  readonly upstream: string;
  readonly generated: ReadonlyArray<string>;
  readonly seams: Record<string, string>;
  readonly patterns: Record<string, string>;
};
const base = process.argv[2] ?? manifest.upstream;
const run = (args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", args, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const changed = run(["diff", "--name-only", "--diff-filter=M", `${base}...HEAD`]);
const globToRegExp = (glob: string) =>
  new RegExp(`^${glob.replaceAll(".", "\\.").replaceAll("**", "\u0000").replaceAll("*", "[^/]*").replaceAll("\u0000", ".*")}$`);
const patterns = Object.keys(manifest.patterns).map(globToRegExp);
const unlisted = changed.filter(
  (file) =>
    manifest.seams[file] === undefined &&
    !manifest.generated.includes(file) &&
    !patterns.some((pattern) => pattern.test(file)),
);
if (unlisted.length > 0) {
  console.error(`Upstream files changed outside .universal/seams.json:\n${unlisted.join("\n")}`);
  process.exit(1);
}
console.log(`${changed.length} upstream files modified, all listed as seams.`);
