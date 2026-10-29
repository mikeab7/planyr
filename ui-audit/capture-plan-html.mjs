/* capture-plan-html — dump the REAL app's rendered HTML for the Yield panel, the Drainage panel and the plan SVG,
 * for a fixed set of committed fixtures, so a pure refactor of SitePlanner.jsx can be PROVEN to change nothing:
 *   node ui-audit/capture-plan-html.mjs --base http://localhost:4173 --out /tmp/before.json     (on main)
 *   node ui-audit/capture-plan-html.mjs --base http://localhost:4174 --out /tmp/after.json      (on the branch)
 *   node ui-audit/capture-plan-html.mjs --diff /tmp/before.json /tmp/after.json                 (exit 1 on any byte of difference)
 * Captures, per scenario: [data-testid=yield-metrics] and [data-testid=drainage-panel] (closed AND with every
 * aria-expanded=false disclosure opened — the Assumptions / Costs branches), and the planner canvas <svg> at fit and at a
 * close zoom (the LOD gates differ). Logged out, no network: the Drainage panel is driven by a REMEMBERED check seeded into
 * settings.drainage.lastCheck (the same seed verify-pond-verdict-rows uses), so no GIS fetch is needed.
 * CONTROL: run the capture twice on the same build and --diff the two — the harness is only a proof if that comes back
 * identical (an id or timestamp that moves between runs would make every "no change" claim meaningless). */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };

if (process.argv.includes("--diff")) {
  const [a, b] = process.argv.slice(process.argv.indexOf("--diff") + 1, process.argv.indexOf("--diff") + 3).map((p) => JSON.parse(readFileSync(p, "utf8")));
  let bad = 0, n = 0;
  for (const sc of Object.keys({ ...a, ...b })) {
    for (const k of Object.keys({ ...(a[sc] || {}), ...(b[sc] || {}) })) {
      n++;
      const x = a[sc]?.[k], y = b[sc]?.[k];
      if (x === y) { console.log(`✓ ${sc} · ${k}${typeof x === "string" ? ` (${x.length} chars)` : ""}`); continue; }
      bad++;
      let i = 0; const s = x || "", t = y || "";
      while (i < s.length && i < t.length && s[i] === t[i]) i++;
      console.log(`✗ ${sc} · ${k}: first difference at char ${i}\n    before …${s.slice(Math.max(0, i - 60), i + 90)}\n    after  …${t.slice(Math.max(0, i - 60), i + 90)}`);
    }
  }
  console.log(bad ? `\n${bad} of ${n} captures DIFFER` : `\nall ${n} captures byte-identical`);
  process.exit(bad ? 1 : 0);
}

const BASE = arg("base", "http://localhost:4173"), OUT = arg("out", "/tmp/claude-0/plan-html.json");
const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"));
const keep = (fx) => Object.fromEntries(["parcels", "parcelDrawings", "els", "markups", "measures", "callouts", "settings", "county", "origin", "sheetOverlays", "layerOverrides", "layerAbove"].filter((k) => fx[k] !== undefined).map((k) => [k, fx[k]]));

const slim = (county) => ({
  authority: { primaryReviewerId: county, channelAuthority: null, overlays: [], ambiguous: [], flags: [], mudState: null, jurisdiction: { city: [], county: [county], etj: [] } },
  flood: { zones: [], state: "loaded", ageMs: 0 },
  channel: null, watershed: null, groundElevFt: 90, groundDatum: "NAVD88",
});
const remembered = (county, pondIds) => ({
  autoFacts: false,
  lastCheck: { ...slim(county), sig: "seed-sig", checkedAt: Date.now() - 3 * 86400000,
    detSplit: { screened: true, fmZonesSig: "seed:0", byId: Object.fromEntries(pondIds.map((id) => [id, { wseFt: null, inTrigger: false, estPoolDepthFt: 0 }])) } },
});
const pondIdsOf = (els) => (els || []).filter((e) => e.type === "pond").map((e) => e.id);

const centreOfFirst = (els, type) => { const e = els.find((x) => x.type === type); if (!e) return null; if (e.cx !== undefined) return [e.cx, e.cy]; const p = e.points || []; return p.length ? [p.reduce((a, q) => a + q.x, 0) / p.length, p.reduce((a, q) => a + q.y, 0) / p.length] : null; };
function scenarios() {
  const out = {};
  const bain = fixture("bain-concept-original");
  out["tx-bain-pond"] = { site: { ...keep(bain), settings: { ...(bain.settings || {}), drainage: remembered("Fort Bend", pondIdsOf(bain.els)) } }, at: centreOfFirst(bain.els, "building") };
  const rich = fixture("richfield-concept-a");
  out["tx-richfield-pond"] = { site: { ...keep(rich), settings: { ...(rich.settings || {}), drainage: remembered("Harris", pondIdsOf(rich.els)) } }, at: centreOfFirst(rich.els, "pond") };
  const weld = fixture("weld-concept-a");
  const weldEls = [...weld.els, { id: "pw1", type: "pond", cx: 400, cy: 300, w: 220, h: 140, rot: 0, det: { depth: 8, freeboard: 1, slope: 3, role: "detention" } }];
  out["co-weld"] = { site: { els: weldEls, county: "weld", origin: { lat: 40.42, lon: -104.71 }, parcels: [], settings: { drainage: remembered("Weld", ["pw1"]) } }, at: centreOfFirst(weldEls, "building") };
  const ts = fixture("tsakiris-concept-a-2026-10-29");
  out["tsakiris-roads"] = { site: { els: ts.els, county: "waller", parcels: [], settings: {} }, at: [-216, 422] };
  out["no-site"] = { site: { els: [], parcels: [], county: null, origin: null, settings: {} }, at: null }; // a blank plan: no parcel, no location, nothing drawn
  return out;
}

const browser = await chromium.launch({ args: ["--ignore-certificate-errors"], ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}) });
const result = {};
for (const [name, sc] of Object.entries(scenarios())) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  if (sc.site) {
    const id = `capture-${name}`;
    const rec = { id, groupId: id, site: "Fixture", name: "Concept A", status: "active", measures: [], callouts: [], markups: [], deletedIds: [], underlay: null, updatedAt: 1700000000000, ...sc.site };
    await ctx.addInitScript(([i, r]) => { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [i]: r })); localStorage.setItem("planarfit:currentSite:v1", i); }, [id, rec]);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click().catch(() => {});
  await page.getByTestId("planner-canvas").waitFor({ timeout: 30000 });
  await assertMeasurable(page, "capture-plan-html");
  await page.waitForTimeout(2500);
  const cap = {};
  const grab = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.outerHTML : null; }, sel);
  const openAll = async (root) => { for (let pass = 0; pass < 4; pass++) { const n = await page.evaluate((r) => { const els = [...document.querySelectorAll(`${r} [aria-expanded="false"]`)]; els.forEach((e) => e.click()); return els.length; }, root); if (!n) break; await page.waitForTimeout(250); } };
  for (const [tab, sel, key] of [["Yield", '[data-testid="yield-metrics"]', "yield"], ["Drainage", '[data-testid="drainage-panel"]', "drainage"]]) {
    await page.locator(`button[title="${tab}"]`).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);
    cap[`${key}-closed`] = await grab(sel);
    await openAll(sel);
    await page.waitForTimeout(400);
    cap[`${key}-open`] = await grab(sel);
  }
  await page.getByRole("button", { name: "Zoom to fit" }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  /* innerHTML, not outerHTML: the <svg> root carries per-mount ids and live view numbers (data-planner-mount, data-reg-dx …)
     that differ between two runs of the SAME build — the drawing inside is what the renderer produces. */
  const grabInner = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.innerHTML : null; }, sel);
  cap["canvas-fit"] = await grabInner('[data-testid="planner-canvas"]');
  if (sc.at) {
    await page.evaluate(([x, y, ppf]) => window.__plannerView.centerOn(x, y, ppf), [...sc.at, 6]);
    await page.waitForTimeout(1800);
    cap["canvas-close"] = await grabInner('[data-testid="planner-canvas"]');
  }
  if (errors.length) cap["pageerrors"] = errors.join("\n");
  result[name] = cap;
  console.log(name, Object.fromEntries(Object.entries(cap).map(([k, v]) => [k, v ? v.length : null])));
  await ctx.close();
}
await browser.close();
writeFileSync(OUT, JSON.stringify(result));
console.log("wrote", OUT);
