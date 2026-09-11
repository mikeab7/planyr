import { readFileSync } from "node:fs";
import * as esbuild from "esbuild";
const html = readFileSync("public/sequence/index.html", "utf8");
const open = '<script type="text/babel">';
// NEW-1 — this used to check only the FIRST `<script type="text/babel">` block. The file carries
// TWO: block 1 is a small ~2.3k-line prelude ending at line 2687, block 2 is the ~14.8k-line block
// holding the actual GridView/App component logic — where essentially every real edit lands. A
// syntax error introduced anywhere in block 2 (the vast majority of the file) still printed
// "JSX OK", which is a false-confidence check on exactly the code most likely to be touched.
let from = 0, blockNum = 0, hadError = false;
while (true) {
  const i = html.indexOf(open, from);
  if (i < 0) break;
  blockNum++;
  const start = i + open.length;
  const end = html.indexOf("</script>", start);
  const code = html.slice(start, end);
  const lineOffset = html.slice(0, start).split("\n").length; // 1-based line where code starts
  try {
    await esbuild.transform(code, { loader: "jsx", jsx: "transform" });
    console.log(`Block ${blockNum} JSX OK — ${code.split("\n").length} lines transpiled (starts at file line ${lineOffset})`);
  } catch (e) {
    hadError = true;
    console.error(`Block ${blockNum} JSX ERROR (starts at file line ${lineOffset}):`);
    for (const m of (e.errors || [])) {
      const fileLine = (m.location?.line || 0) + lineOffset - 1;
      console.error(`  ${m.text}  → file line ~${fileLine}: ${m.location?.lineText || ""}`);
    }
  }
  from = end + 1;
}
if (blockNum === 0) { console.error("no babel block"); process.exit(2); }
if (hadError) process.exit(1);
