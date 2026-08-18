// Validate every inline <script type="text/babel"> in public/sequence/index.html still
// compiles (the same in-browser transform, run via esbuild's JSX loader). Catches any
// syntax error introduced by an edit without needing a live browser.
//
// index.html carries TWO such blocks — the formula-engine IIFE (~1,100 lines) and the main
// app (~12,800 lines, everything from GridView/GanttView/AutomationPanel down). The original
// version of this checker only ever found the FIRST `indexOf` match, so it validated the small
// formula-engine block and silently never touched the app block where nearly all real edits
// land — a syntax error there would have passed this check clean. Fixed to walk every block.
//
// B643105-b — `checkBabelBlocks` is exported (pure: no I/O, no console, no process.exit) so
// `test/checkBabel.test.js` can drive it against an IN-MEMORY mutated string — never a file
// written to disk — and prove inside the enforced CI gate that this checker actually fails on a
// real syntax error, not just that it exists and happens to pass. That proof lived only in a
// chat transcript before this test; nothing stopped a future edit turning this file into an
// unconditional pass while CI stayed green forever.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const MARKER = '<script type="text/babel">';

/** Walk every <script type="text/babel"> block in `html` and esbuild-JSX-transform each one.
 *  Returns one result per block found: { blockNum, chars, lines, ok, error, outLength }.
 *  `error` is esbuild's own error list (or [{text: message}]) when `ok` is false, else null. */
export function checkBabelBlocks(html) {
  const blocks = [];
  let searchFrom = 0, blockNum = 0;
  while (true) {
    const start = html.indexOf(MARKER, searchFrom);
    if (start === -1) break;
    blockNum++;
    const open = html.indexOf(">", start) + 1;
    const end = html.indexOf("</script>", open);
    const code = html.slice(open, end);
    let ok = true, error = null, outLength = null;
    try {
      const out = transformSync(code, { loader: "jsx", jsx: "transform" });
      outLength = out.code.length;
    } catch (e) {
      ok = false;
      error = e.errors ? e.errors.slice(0, 5) : [{ text: e.message }];
    }
    blocks.push({ blockNum, chars: code.length, lines: code.split("\n").length, ok, error, outLength });
    searchFrom = end + 1;
  }
  return blocks;
}

function main() {
  const html = readFileSync(new URL("../../public/sequence/index.html", import.meta.url), "utf8");
  const blocks = checkBabelBlocks(html);
  if (blocks.length === 0) { console.log('no <script type="text/babel"> blocks found'); process.exit(1); }
  let failed = false;
  for (const b of blocks) {
    console.log(`block ${b.blockNum}: ${b.chars} chars, ~${b.lines} lines`);
    if (b.ok) {
      console.log(`  esbuild JSX transform: OK ✅ (${b.outLength} chars output)`);
    } else {
      console.log(`  esbuild transform FAILED ❌`);
      console.log(JSON.stringify(b.error, null, 2));
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

// Only run the CLI (read the real file, print, exit) when this file is executed directly —
// never on import, so `checkBabelBlocks` is safe for a test to pull in.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
