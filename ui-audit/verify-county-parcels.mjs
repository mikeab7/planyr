/* NEW-1 (2026-11-13) — ONE county-parcel verification runner, driven by a table.
 *
 * Adding the next county = adding a ROW to ui-audit/county-parcels/cases.mjs. See ui-audit/county-parcels/README.md.
 * Generalises ui-audit/verify-ga-county-batch-20260923.mjs: the SHIPPED `candidateCountiesForPoint` says which sources the app
 * would ask for a point, the SHIPPED `queryAtPoint` asks each, and the row says what a pass looks like.
 *
 *   node ui-audit/verify-county-parcels.mjs                  run every row (routing + live)
 *   node ui-audit/verify-county-parcels.mjs --only V1179284  one row, by case id or by ledger id it covers
 *   node ui-audit/verify-county-parcels.mjs --routing-only   no network at all (what CI runs, via the vitest suite)
 *   node ui-audit/verify-county-parcels.mjs --prove-red       also re-judge each passing point against deliberately wrong
 *                                                             expectations and require every one to FAIL (a runner that
 *                                                             cannot go red is not evidence)
 *   node ui-audit/verify-county-parcels.mjs --json out.json   machine-readable result
 *   node ui-audit/verify-county-parcels.mjs --list            print the rows and what ledger ids they cover
 *
 * Exit: 0 all PASS · 1 any FAIL · 2 no FAIL but at least one VOID (host unreachable from this machine; --allow-void makes it 0).
 * TLS: this runner NEVER disables certificate checks. In a sandbox with an egress proxy it re-launches itself with Node's
 * own proxy support (NODE_USE_ENV_PROXY=1), which uses the CA bundle the environment already installed.
 */
import { spawnSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

// Re-launch once with Node's env-proxy support when an egress proxy is configured (Node's fetch ignores HTTPS_PROXY by default).
const proxied = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxied && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ["--disable-warning=UNDICI-EHPA", fileURLToPath(import.meta.url), ...args], {
    stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  process.exit(r.status ?? 1);
}

const { installFetchLog, expandCase, collectPoint, judgePoint, judgeCase, rollup, mutantsOf } = await import("./lib/countyParcelRunner.mjs");
const fetchLog = installFetchLog(); // must wrap fetch BEFORE the app modules capture it
const { COUNTIES, COUNTIES_MAP, candidateCountiesForPoint } = await import("../src/workspaces/site-planner/lib/counties.js");
const { setCountyPolygons } = await import("../src/workspaces/site-planner/lib/countyPolygons.js");
const { queryAtPoint } = await import("../src/workspaces/site-planner/lib/arcgis.js");
const { CASES } = await import("./county-parcels/cases.mjs");

if (flag("--list")) {
  for (const c of CASES) console.log(`${c.id.padEnd(34)} ${(c.covers || []).join(",").padEnd(12)} ${c.place}`);
  process.exit(0);
}

await setCountyPolygons(JSON.parse(readFileSync(path.join(here, "..", "public", "geo", "county-polygons.json"), "utf8")));

const git = (c) => { try { return execSync(c, { cwd: path.join(here, ".."), stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "unknown"; } };
console.log(`county-parcels runner · code under test = git ${git("git rev-parse --short HEAD")} (${git("git rev-parse --abbrev-ref HEAD")}) · ${new Date().toISOString()}`);
// Name the deployed build too, so "I tested X" can be compared with what planyr.io serves (read no-store, same run).
let deployed = "unreachable from this machine";
try { const r = await fetch("https://planyr.io/version.json?cb=" + Date.now(), { cache: "no-store", signal: AbortSignal.timeout(10000) }); deployed = r.ok ? JSON.stringify(await r.json()).slice(0, 160) : `HTTP ${r.status}`; } catch { /* named above */ }
console.log(`planyr.io /version.json: ${deployed}`);
console.log(`(source-level run: the shipped counties.js/arcgis.js are executed directly against the live county servers — not a click on planyr.io)\n`);

// COUNTIES holds the hand-written source rows (idField, addrField, help); COUNTIES_MAP the routing view (bbox, layerUrl). Merge both.
const cfgFor = (k) => (COUNTIES[k] || COUNTIES_MAP[k]) ? { ...COUNTIES[k], ...COUNTIES_MAP[k], idField: (COUNTIES_MAP[k] || {}).idField ?? (COUNTIES[k] || {}).idField } : undefined;

// Why a host did not answer: an egress-policy refusal is a different finding from a county server that is itself down.
// With a proxy configured we ask the proxy directly (a bare CONNECT) — its status line is the evidence, not a guess.
async function probeHost(host) {
  if (proxied) {
    const { connect } = await import("node:net");
    const u = new URL(proxied);
    const status = await new Promise((resolve) => {
      const sock = connect({ host: u.hostname, port: Number(u.port) || 80 });
      let buf = "";
      const done = (v) => { sock.destroy(); resolve(v); };
      sock.setTimeout(10000, () => done("timeout waiting for the proxy"));
      sock.on("error", (e) => done(`proxy connection error ${e.code || e.message}`));
      sock.on("connect", () => sock.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`));
      sock.on("data", (d) => { buf += d.toString(); if (buf.includes("\r\n")) done(buf.split("\r\n")[0]); });
    });
    if (/\s200\s/.test(status)) return `the proxy opens a tunnel to ${host} (${status}), so the failure is on the county's side or in the request itself`;
    if (/\s40[37]\s/.test(status)) return `the egress proxy refused the tunnel (${status}) — a sandbox policy, NOT evidence about the county`;
    return `proxy said: ${status}`;
  }
  try {
    const r = await fetch(`https://${host}/`, { signal: AbortSignal.timeout(10000) });
    return `host answers HTTP ${r.status} to a plain GET, so the failure is specific to the parcel request`;
  } catch (e) {
    const why = `${e.cause?.code || ""} ${e.cause?.message || e.message}`.trim();
    return /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|CONNECT_TIMEOUT|timeout|aborted/i.test(why) ? `the host itself did not answer (${why}) — looks like a server-side outage` : `unclassified (${why})`;
  }
}

const deps = {
  candidatesFor: (lat, lng) => candidateCountiesForPoint(lat, lng),
  cfgFor,
  query: (url, lng, lat) => queryAtPoint(url, lng, lat),
  fetchLog, probeHost,
};

const only = opt("--only");
const rows = CASES.filter((c) => !only || c.id === only || (c.covers || []).includes(only));
if (!rows.length) { console.error(`no row matches --only ${only}`); process.exit(1); }

const results = [];
let redProofFailures = 0, redProofRuns = 0;
for (const c of rows) {
  const pts = expandCase(c);
  const verdicts = [];
  for (const p of pts) {
    const observed = await collectPoint(p, deps, { routingOnly: flag("--routing-only") });
    const v = judgePoint(p, observed, cfgFor);
    if (flag("--prove-red") && v.status === "PASS") {
      for (const m of mutantsOf(p)) {
        redProofRuns++;
        const mv = judgePoint(m.point, observed, cfgFor);
        if (mv.status !== "FAIL") { redProofFailures++; console.log(`  ✗ PROVE-RED: "${m.name}" on ${p.label} did NOT fail (${mv.status}) — the judge cannot see this defect`); }
      }
    }
    verdicts.push({ point: p, observed, ...v });
  }
  const caseChecks = judgeCase(c, verdicts);
  const status = rollup(verdicts, caseChecks);
  results.push({ id: c.id, covers: c.covers || [], place: c.place, status, verdicts, caseChecks });

  console.log(`${status === "PASS" ? "✓" : status === "VOID" ? "○" : "✗"} ${status}  ${c.id}  [${(c.covers || []).join(", ")}]  ${c.place}`);
  for (const v of verdicts) {
    const tag = v.status === "PASS" ? "✓" : v.status === "VOID" ? "○" : "✗";
    const ev = v.evidence.pin ? ` · ${v.evidence.field}=${v.evidence.pin} · ${v.evidence.requests} req` : "";
    const rt = v.status === "VOID" ? " · routing ✓ (live not run)" : "";
    console.log(`    ${tag} ${v.point.label} (${v.point.lat}, ${v.point.lng})${ev}${rt}`);
    for (const ch of v.checks) if (!ch.ok) console.log(`        ✗ [${ch.cause}] ${ch.label}`);
    if (v.void) console.log(`        ○ live half VOID: ${v.void}`);
  }
  for (const ch of caseChecks) console.log(`    ${ch.ok ? "✓" : "✗"} ${ch.label}`);
}

const n = (s) => results.filter((r) => r.status === s).length;
console.log(`\n${rows.length} row(s): ${n("PASS")} PASS · ${n("FAIL")} FAIL · ${n("VOID")} VOID`);
if (flag("--prove-red")) console.log(`prove-red: ${redProofRuns} deliberately-wrong expectations re-judged against real answers, ${redProofRuns - redProofFailures} correctly FAILED${redProofFailures ? ` · ${redProofFailures} NOT CAUGHT` : ""}`);
if (n("VOID")) console.log("VOID is not a pass: the live half could not run for that row from this machine. Run it where the host is reachable.");

const jsonPath = opt("--json");
if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ at: new Date().toISOString(), sha: git("git rev-parse HEAD"), results: results.map((r) => ({ ...r, verdicts: r.verdicts.map((v) => ({ label: v.point.label, lat: v.point.lat, lng: v.point.lng, status: v.status, cause: v.cause, void: v.void, evidence: v.evidence, failed: v.checks.filter((c) => !c.ok) })) })) }, null, 2));

if (redProofFailures) process.exit(1);
if (n("FAIL")) process.exit(1);
if (n("VOID") && !flag("--allow-void") && !flag("--routing-only")) process.exit(2);
process.exit(0);
