// Validate every inline <script type="text/babel"> in public/sequence/index.html still
// compiles (the same in-browser transform, run via esbuild's JSX loader). Catches any
// syntax error introduced by an edit without needing a live browser.
//
// index.html carries TWO such blocks — the formula-engine IIFE (~1,100 lines) and the main
// app (~12,800 lines, everything from GridView/GanttView/AutomationPanel down). The original
// version of this checker only ever found the FIRST `indexOf` match, so it validated the small
// formula-engine block and silently never touched the app block where nearly all real edits
// land — a syntax error there would have passed this check clean. Fixed to walk every block.
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
const html = readFileSync(new URL("../../public/sequence/index.html", import.meta.url), "utf8");
const MARKER = '<script type="text/babel">';
let searchFrom = 0, blockNum = 0, failed = false;
while (true) {
  const start = html.indexOf(MARKER, searchFrom);
  if (start === -1) break;
  blockNum++;
  const open = html.indexOf(">", start) + 1;
  const end = html.indexOf("</script>", open);
  const code = html.slice(open, end);
  console.log(`block ${blockNum}: ${code.length} chars, ~${code.split("\n").length} lines`);
  try {
    const out = transformSync(code, { loader: "jsx", jsx: "transform" });
    console.log(`  esbuild JSX transform: OK ✅ (${out.code.length} chars output)`);
  } catch (e) {
    console.log(`  esbuild transform FAILED ❌`);
    console.log(e.errors ? JSON.stringify(e.errors.slice(0, 5), null, 2) : e.message);
    failed = true;
  }
  searchFrom = end + 1;
}
if (blockNum === 0) { console.log("no <script type=\"text/babel\"> blocks found"); process.exit(1); }
if (failed) process.exit(1);
