// Validate the inline <script type="text/babel"> in public/sequence/index.html still
// compiles (the same in-browser transform, run via esbuild's JSX loader). Catches any
// syntax error introduced by an edit without needing a live browser.
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
const html = readFileSync(new URL("../../public/sequence/index.html", import.meta.url), "utf8");
const start = html.indexOf('<script type="text/babel">');
const open = html.indexOf(">", start) + 1;
const end = html.indexOf("</script>", open);
const code = html.slice(open, end);
console.log(`extracted babel script: ${code.length} chars, ~${code.split("\n").length} lines`);
try {
  const out = transformSync(code, { loader: "jsx", jsx: "transform" });
  console.log("esbuild JSX transform: OK ✅ (" + out.code.length + " chars output)");
} catch (e) {
  console.log("esbuild transform FAILED ❌");
  console.log(e.errors ? JSON.stringify(e.errors.slice(0, 5), null, 2) : e.message);
  process.exit(1);
}
