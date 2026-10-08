#!/usr/bin/env node
/* perf-plan-store-scaling — B2165120's acceptance instrument. Does an edit's write cost stay FLAT as the library grows?
 *
 * Runs ui-audit/perf-edit-switch.mjs (real pointer drags on the owner's real plan, between plan switches) at several library sizes, in TWO arms
 * that differ in ONE thing — the storage layout (`--layout plan` = one entry per plan, `--layout blob` = planStore's kill switch = the old whole-library
 * entry) — same build, same machine, same plans. Verdict: lib/storeScaling.mjs (VOID, never green, if the arms did not run what they claim).
 *
 *   xvfb-run -a --server-args="-screen 0 1800x1000x24" node ui-audit/perf-plan-store-scaling.mjs [--sizes 5,50,150] [--plan-kb 8] [--edits 2] [--switches 4] [--assert]
 *   (needs a built app on BASE_URL, default http://localhost:4173/ — `npm run build && npx vite preview --port 4173`)
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { storeScalingVerdict } from "./lib/storeScaling.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const SIZES = argOf("--sizes", "5,50,150").split(",").map(Number).filter(Boolean);
const PLAN_KB = argOf("--plan-kb", "8"), EDITS = argOf("--edits", "2"), SWITCHES = argOf("--switches", "4");
const ASSERT = process.argv.includes("--assert");
const dir = mkdtempSync(join(tmpdir(), "planstore-scaling-"));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

const arms = { plan: [], blob: [] };
for (const layout of ["plan", "blob"]) {
  for (const n of SIZES) {
    const out = join(dir, `${layout}-${n}.json`);
    process.stderr.write(`· ${layout} @ ${n} plans …\n`);
    const r = spawnSync("node", [join(HERE, "perf-edit-switch.mjs"), "--switches", SWITCHES, "--edits", EDITS, "--store-plans", String(n), "--plan-kb", PLAN_KB, "--layout", layout, "--json", "--out", out], { stdio: ["ignore", "ignore", "inherit"], timeout: 900000 });
    if (!existsSync(out)) { console.error(`run ${layout}@${n} produced no output (exit ${r.status})`); continue; }
    const d = JSON.parse(readFileSync(out, "utf8"));
    const log = d.editLog || [];
    arms[layout].push({
      plans: n, edits: log.length, layoutObserved: d.layoutObserved,
      writeKBMedian: +med(log.map((e) => (e.big?.wBytes || 0) / 1000)).toFixed(1),
      writeKBMax: +Math.max(0, ...log.map((e) => (e.big?.wBytes || 0) / 1000)).toFixed(1),
      largestWriteKB: +Math.max(0, ...log.map((e) => (e.big?.wMax || 0) / 1000)).toFixed(1),
      writeMsMedian: +med(log.map((e) => e.big?.wMs || 0)).toFixed(1),
      callsMedian: med(log.map((e) => e.big?.wN || 0)),
    });
  }
}
const v = storeScalingVerdict(arms, {});
console.log("\nlayout  plans  edits  median KB written  max KB  largest write KB  setItem ms (median)  writes/edit  library KB (observed)");
for (const l of ["plan", "blob"]) for (const a of v[l]) console.log(`${l.padEnd(6)}  ${String(a.plans).padStart(5)}  ${String(a.edits).padStart(5)}  ${String(a.writeKBMedian).padStart(17)}  ${String(a.writeKBMax).padStart(6)}  ${String(a.largestWriteKB).padStart(16)}  ${String(a.writeMsMedian).padStart(19)}  ${String(a.callsMedian).padStart(11)}  ${a.layoutObserved ? a.layoutObserved.legacyKB : "?"}`);
console.log("\n" + v.lines.join("\n"));
console.log(v.void ? "\nVOID" : v.pass ? "\nPASS" : "\nFAIL");
if (ASSERT && !v.pass) process.exit(1);
