/* NEW-1 (Tennessee) — the REAL resolver against the LIVE State of Tennessee / TDOT services, from Node (no browser).
 *
 * Runs `identifyJurisdiction` + `formatJurisdictionBadge` + `identifyRoadAuthority` for the owner's fixture points with a fetch that
 * hits the real endpoints (via curl, so it rides the sandbox proxy), and asserts the badge text for each. It is the data half of the
 * check; the browser half (the header chip and the Site Analysis panel in the signed-in app) is `verify-tn-jurisdiction-live.mjs`.
 * Known-good arms: Houston and Atlanta resolve to exactly what they always did. Exits 0 on all-pass, 1 on a mismatch, 2 if a service is unreachable. */
import { execFileSync } from "node:child_process";

const { identifyJurisdiction, formatJurisdictionBadge, identifyRoadAuthority } = await import("../src/workspaces/site-planner/lib/jurisdiction.js");
const { createGisCache } = await import("../src/workspaces/site-planner/lib/gisCache.js");

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => Array.from(m.keys())[i] ?? null }; };
let unreachable = 0;
const fetchJson = async (url) => {
  try { return JSON.parse(execFileSync("curl", ["-sS", "-m", "40", "--fail", url], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })); }
  catch (e) { unreachable++; throw new Error("unreachable: " + String(e.message).split("\n")[0]); }
};
const run = (lng, lat) => identifyJurisdiction(lng, lat, { cache: createGisCache({ store: mem(), now: () => Date.now() }), fetchJson, roles: ["county", "city", "etj"] });

const CASES = [
  ["20 Culvert St, Nashville", -86.755160, 36.137653, "Metro Nashville-Davidson County, TN"],
  ["Belle Meade", -86.85, 36.1, "City of Belle Meade, TN · Metro Nashville-Davidson County"],
  ["Memphis proper", -90.049, 35.1495, "City of Memphis, TN · Shelby County"],
  ["Unincorporated Shelby (Eads / Rosemark area)", -89.68, 35.19, "Unincorporated Shelby County, TN"],
  ["Germantown", -89.8101, 35.0868, "City of Germantown, TN · Shelby County"],
  ["Collierville", -89.6645, 35.042, "City of Collierville, TN · Shelby County"],
  ["Murfreesboro proper", -86.3903, 35.8456, "City of Murfreesboro, TN · Rutherford County"],
  ["Epps Mill Rd / I-24 (35.7299, -86.3194)", -86.3194, 35.7299, "Unincorporated Rutherford County, TN"],
  ["Chattanooga", -85.3097, 35.0456, "City of Chattanooga, TN · Hamilton County"],
  ["Clarksville", -87.3595, 36.5298, "City of Clarksville, TN · Montgomery County"],
  ["Knoxville proper", -83.9207, 35.9606, "City of Knoxville, TN · Knox County"],
  ["Unincorporated Knox (Solway)", -84.09, 35.99, "Unincorporated Knox County, TN"],
  ["Goodlettsville, Sumner side", -86.7, 36.345, "City of Goodlettsville, TN · Sumner County"],
  ["Goodlettsville, Davidson side", -86.71, 36.305, "City of Goodlettsville, TN · Metro Nashville-Davidson County"],
  ["Lynchburg (Moore)", -86.3719, 35.2845, "Metro Lynchburg-Moore County, TN"],
  ["Hartsville (Trousdale)", -86.1594, 36.3987, "Metro Hartsville-Trousdale County, TN"],
  ["Rural Lauderdale (statewide-parcel county)", -89.6, 35.7, "Unincorporated Lauderdale County, TN"],
];
let bad = 0;
for (const [name, lng, lat, want] of CASES) {
  const j = await run(lng, lat);
  const b = formatJurisdictionBadge(j);
  const got = b ? b.text : null;
  const ok = got === want && !/etj/i.test(JSON.stringify({ t: b && b.text, n: b && b.gaNote }));
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${got}${ok ? "" : `   (wanted: ${want})`}`);
}
// Road authority at two of them (point mode: nearest segment within the tolerance).
const box = (lng, lat, d = 0.0004) => [[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]];
for (const [name, lng, lat, expectAuth] of [["Culvert St (city street)", -86.755160, 36.137653, "City"], ["Memphis downtown (state route + city streets)", -90.049, 35.1495, "City"],
  ["Epps Mill Rd / I-24 (state interstate + county roads)", -86.3194, 35.7299, "State (TDOT)"]]) {
  const r = await identifyRoadAuthority(lng, lat, { ring: box(lng, lat, name.startsWith("Epps") ? 0.004 : 0.0004), cache: createGisCache({ store: mem(), now: () => Date.now() }), fetchJson });
  const labels = [...new Set(r.roads.map((x) => x.authority.label))];
  const ok = labels.includes(expectAuth) && r.sourceName === "TDOT Road Segment inventory";
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  road @ ${name.padEnd(46)} ${r.roads.slice(0, 4).map((x) => `${x.name} → ${x.authority.label}`).join("; ")}`);
}
// Known-good arms: Texas and Georgia untouched.
const hou = formatJurisdictionBadge(await run(-95.37, 29.76));
const atl = formatJurisdictionBadge(await run(-84.388, 33.749));
const knownOk = hou && /City of Houston/.test(hou.text) && /Harris County/.test(hou.text) && atl && /City of Atlanta, GA/.test(atl.text);
if (!knownOk) bad++;
console.log(`${knownOk ? "PASS" : "FAIL"}  known-good arms: Houston → ${hou && hou.text} · Atlanta → ${atl && atl.text}`);
if (unreachable && bad) { console.log(`VOID: ${unreachable} request(s) unreachable`); process.exit(2); }
console.log(bad ? `\n${bad} FAILED` : `\nall ${CASES.length + 3} checks passed`);
process.exit(bad ? 1 : 0);
