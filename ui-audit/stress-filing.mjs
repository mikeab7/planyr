/* Stress test (B360): never-auto-guess / no cross-project misfile, on the REAL corpus. Dev-only. */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { matchProjectInText } from "../src/shared/files/matchProject.js";
import { KNOWN_PROJECTS, projectFromFilename } from "./lib/filingScore.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "corpus");
if (!existsSync(dir)) { console.log("no corpus"); process.exit(0); }
const files = readdirSync(dir).filter((f) => f.endsWith(".txt"));

let bad = 0;
for (const f of files) {
  const text = readFileSync(join(dir, f), "utf8");
  const expect = projectFromFilename(f);
  const d = matchProjectInText(text, KNOWN_PROJECTS);
  const got = d.matched ? (KNOWN_PROJECTS.find((p) => p.id === d.projectId) || {}).name : "(needs filing)";
  // per-project scores to expose any wrong project scoring high
  const scores = KNOWN_PROJECTS.map((p) => {
    const one = matchProjectInText(text, [p]);
    return `${p.name}:${one.confidence.toFixed(2)}`;
  }).join("  ");
  const cross = d.matched && expect && got !== expect; // matched the WRONG project = misfile
  if (cross) bad++;
  console.log(`${cross ? "❌MISFILE" : d.matched ? "✓file" : "·hold"}  got=${(got||"").padEnd(14)} want=${(expect||"?").padEnd(12)} conf=${d.confidence.toFixed(2)} [${d.reason}]`);
  console.log(`        scores: ${scores}   ${f.slice(0,40)}`);
}
console.log(`\n${bad === 0 ? "✅ no cross-project misfiles" : "❌ " + bad + " MISFILE(S)"} across ${files.length} real sheets`);
