// @effect-diagnostics nodeBuiltinImport:off - Node reads the widget document and formats the generated module.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const root = NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const html = NodeFS.readFileSync(NodePath.join(root, "src", "learn-widget.html"), "utf8");
const out = NodePath.join(root, "src", "learnWidget.generated.ts");
const previewPath = NodePath.join(root, "dev", "preview.html");
const escaped = html
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");
const preview = NodeFS.readFileSync(previewPath, "utf8");
let matched = false;
const stamped = preview.replace(
  /(<iframe\b[^>]*?\ssrcdoc=)(['"])[\s\S]*?\2/,
  (_match, open: string) => {
    matched = true;
    return `${open}"${escaped}"`;
  },
);
if (!matched) {
  process.stderr.write("preview.html is missing an iframe srcdoc attribute\n");
  process.exit(1);
}
NodeFS.writeFileSync(previewPath, stamped);
NodeFS.writeFileSync(out, `export const LEARN_WIDGET_HTML = ${JSON.stringify(html)};\n`);

const formatted = NodeChildProcess.spawnSync(
  NodePath.join(root, "../../node_modules/.bin/vp"),
  ["fmt", out, previewPath],
  { cwd: root, stdio: "inherit" },
);
if (formatted.status !== 0) process.exit(formatted.status ?? 1);
