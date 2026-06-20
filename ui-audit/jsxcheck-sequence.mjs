import { readFileSync } from "node:fs";
import * as esbuild from "esbuild";
const html = readFileSync("public/sequence/index.html", "utf8");
const open = '<script type="text/babel">';
const i = html.indexOf(open);
if (i < 0) { console.error("no babel block"); process.exit(2); }
const start = i + open.length;
const end = html.indexOf("</script>", start);
const code = html.slice(start, end);
const lineOffset = html.slice(0, start).split("\n").length; // 1-based line where code starts
try {
  await esbuild.transform(code, { loader: "jsx", jsx: "transform" });
  console.log(`JSX OK — ${code.split("\n").length} lines transpiled (block starts at file line ${lineOffset})`);
} catch (e) {
  console.error("JSX ERROR:");
  for (const m of (e.errors||[])) {
    const fileLine = (m.location?.line||0) + lineOffset - 1;
    console.error(`  ${m.text}  → file line ~${fileLine}: ${m.location?.lineText||""}`);
  }
  process.exit(1);
}
