/* verify-zoning-legend-live — DeSoto zoning legend headed by government, no false "too detailed", Southaven names (B2507063 ×2, B2507064 ×2, B2589344, V2038400).
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-zoning-legend-live.mjs [https://planyr.io] [--expect-sha <sha>] [--shots <dir>]
 *
 * LIVE, signed in as the test account, on the Map page (finder), Layers › Jurisdictions › Zoning on. For each view it opens the row's ▾ (the legend), READS the legend rows and the
 * row's status line, and writes a SCREENSHOT of the page (the owner's complaint is that data assertions passed while the picture was wrong — LOOK at the PNGs). Asserts: a heading per
 * government, no "(Olive Branch)"-style suffix on any row, no red "too detailed" / "Zoom in to see" line while polygons are drawn (checked repeatedly while zooming OUT from street level
 * and panning), Southaven rows carry their names. Known-good arm: the Olive Branch view must list Olive Branch's "M-1 · Light Industrial" (the 2026-10-29 sourced name), or the run is VOID. */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const EXPECT_SHA = flag("--expect-sha"), SHOTS = flag("--shots");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
await assertMeasurable(page, "verify-zoning-legend-live");
await page.setViewportSize({ width: 1400, height: 900 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);
const sleep = (ms) => page.waitForTimeout(ms);
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

const panel = () => page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="layer-panel"][data-surface="finder"]'), null, { timeout: 60000 });
await sleep(1500);
const setView = (lat, lng, z) => page.evaluate(([a, b, c]) => window.__mapFinderMap.setView([a, b], c, { animate: false }), [lat, lng, z]);
await setView(34.9618, -89.8295, 13);
await sleep(1500);

// Layers › Jurisdictions › Zoning on
const p = panel();
const grp = p.getByTestId("layer-group-jur");
if (await grp.count()) await grp.click(); else await p.getByTestId("layer-group-select").selectOption("jur");
await sleep(300);
const cb = p.locator('[data-testid="layer-row-ms_desoto_zoning"] input[type="checkbox"]').first();
check("the Zoning row is offered at Olive Branch", (await cb.count()) > 0);
if (await cb.count()) { if (!(await cb.isChecked())) await cb.check(); }
await sleep(9000);
const caret = p.getByTestId("layer-caret-ms_desoto_zoning");
if ((await caret.getAttribute("aria-expanded")) !== "true") await caret.click();
await sleep(600);

const read = () => page.evaluate(() => {
  const row = document.querySelector('[data-testid="layer-panel"][data-surface="finder"] [data-testid="layer-row-ms_desoto_zoning"]');
  const menu = row && (row.querySelector('[data-testid="layer-row-ms_desoto_zoning-menu"]') || row.parentElement.querySelector('[data-testid="layer-row-ms_desoto_zoning-menu"]'));
  const legend = menu && menu.querySelector('[data-part="legend"]');
  const items = legend ? [...legend.children].map((el) => ({ heading: el.getAttribute("data-part") === "legend-heading", text: el.textContent.trim() })) : [];
  const status = menu && menu.querySelector('[data-part="status"]');
  const txt = (row ? row.parentElement.innerText : "");
  return { items, status: status ? status.textContent.trim() : null, warn: /too detailed|Zoom in to see|simpler copy|\d+k points/i.test(txt) ? txt.match(/.*(too detailed|Zoom in to see|simpler copy|\d+k points).*/i)[0] : null };
});
const fmt = (r) => r.items.map((i) => (i.heading ? `# ${i.text}` : `   ${i.text}`)).join("\n");

async function view(name, lat, lng, z) {
  await setView(lat, lng, z);
  await sleep(9000);
  const r = await read();
  console.log(`\n── ${name} (${lat}, ${lng}, z${z})\n${fmt(r) || "(empty legend)"}\nstatus: ${r.status} · warning: ${r.warn}`);
  await shot(name);
  check(`${name}: no suffix on any row`, !r.items.some((i) => !i.heading && /\((Olive Branch|Southaven|Horn Lake|Hernando|Walls|Unincorporated)/.test(i.text)));
  check(`${name}: no red "too detailed" / "Zoom in to see" line while polygons are drawn`, !r.warn, r.warn || "");
  return r;
}

const ob = await view("olive-branch-z13", 34.9618, -89.8295, 13);
check("KNOWN-GOOD: the Olive Branch view lists the 2026-10-29 sourced name 'M-1 · Light Industrial'", ob.items.some((i) => /^M-1 · Light Industrial$/.test(i.text)), "");
if (!ob.items.some((i) => /^M-1 · Light Industrial$/.test(i.text))) voided++;
check("Olive Branch view: a heading 'Olive Branch' leads", ob.items[0] && ob.items[0].heading && /Olive Branch/.test(ob.items[0].text), ob.items[0] && ob.items[0].text);

const sh = await view("southaven-z13", 34.9889, -90.0126, 13);
const shIdx = sh.items.findIndex((i) => i.heading && i.text === "Southaven");
check("Southaven view: a 'Southaven' heading", shIdx >= 0);
const shRows = shIdx >= 0 ? sh.items.slice(shIdx + 1, (sh.items.slice(shIdx + 1).findIndex((i) => i.heading) + 1 + shIdx) || undefined).filter((i) => !i.heading) : [];
check("Southaven rows carry Southaven's names (e.g. 'C-3 · General Commercial' / 'R-… · Single-Family Residential' / 'PUD · Planned Unit Development')", shRows.some((i) => / · (General Commercial|Single-Family Residential|Planned Unit Development|Planned Commercial)$/.test(i.text)), shRows.slice(0, 8).map((i) => i.text).join(" | "));

await view("unincorporated-z13", 34.80, -89.76, 13);
const several = await view("several-places-z11", 34.93, -89.9, 11);
check("several places in view: more than one heading", several.items.filter((i) => i.heading).length > 1, several.items.filter((i) => i.heading).map((i) => i.text).join(", "));

// zoom OUT from street level, then pan across Olive Branch and the unincorporated county, polling the row for any red line the whole way
const warns = [];
const poll = async (label) => { const r = await read(); if (r.warn) warns.push(`${label}: ${r.warn}`); };
await setView(34.9618, -89.8295, 17); await sleep(5000); await poll("z17");
for (const z of [16, 15, 14, 13, 12]) { await setView(34.9618, -89.8295, z); for (let i = 0; i < 4; i++) { await sleep(2500); await poll(`z${z}`); } }
await shot("zoomed-out-after-street-level");
for (const [lat, lng] of [[34.9618, -89.76], [34.9, -89.76], [34.85, -89.8], [34.9618, -89.9], [34.9889, -90.0126]]) { await setView(lat, lng, 13); for (let i = 0; i < 3; i++) { await sleep(2500); await poll(`pan ${lat},${lng}`); } }
await shot("after-panning");
check("zooming out from street level and panning: the row never showed a red line", warns.length === 0, warns.slice(0, 3).join(" | "));

console.log(`\n${failed ? "FAILED" : "PASSED"} (${failed} failed${voided ? `, ${voided} VOID` : ""}) · build ${served}`);
await s.close();
process.exit(failed || voided ? 1 : 0);
