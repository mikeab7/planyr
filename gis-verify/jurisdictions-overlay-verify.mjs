/* B176 / V44 verification — the "Jurisdictions" overlay group, end to end.
 *
 * Two layers of proof:
 *   1. UI WIRING — the "Jurisdictions" group + its four toggles (County / City limits /
 *      City ETJ / MUD) render in the Layers panel and toggle without JS errors.
 *   2. TILE PAINT (the V44 gate) — with all four layers ON, the running app actually
 *      fires each layer's data request and gets a real answer back. We record every
 *      network response to the four data hosts and read each layer's status dot:
 *        county / ETJ → services.arcgis.com  (told apart by AGOL org hash)
 *        city         → feature.geographic.texas.gov
 *        MUD          → harcags.harcresearch.org  (the host that needed the egress
 *                       allowlist — only reachable from a fresh session)
 *      PASS per layer = ≥1 HTTP 200 from its host AND its status dot reads "loaded".
 *
 * The MUD host (harcresearch.org) is CORS-blocked for cross-origin fetch but its image
 * export paints via a CORS-exempt <img>, so a benign console/CORS message is expected
 * there — we gate on real page exceptions + the per-layer 200/dot result, not on that.
 *
 * Run (needs `npx vite preview --port 4173` up): node gis-verify/jurisdictions-overlay-verify.mjs
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// Each layer's data host. county vs ETJ both live on services.arcgis.com, so they're
// told apart by their AGOL org hash. `kind` notes how the layer loads its data.
const PROBES = {
  county: { label: "County boundaries",     match: "KTcxiTD9dsQw4r7Z",             kind: "feature", hits: [] },
  city:   { label: "City limits",           match: "feature.geographic.texas.gov", kind: "feature", hits: [] },
  etj:    { label: "City ETJ",              match: "su8ic9KbA7PYVxPS",             kind: "feature", hits: [] },
  mud:    { label: "MUD / water districts", match: "harcags.harcresearch.org",     kind: "image",   hits: [] },
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();

const pageErrors = [];   // real JS exceptions — these fail the test
const consoleErrors = []; // console errors (may include benign cross-origin probe noise)
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

// Record every response to the four data hosts (status + content-type).
page.on("response", (resp) => {
  const u = resp.url();
  for (const p of Object.values(PROBES)) {
    if (u.includes(p.match)) {
      const h = resp.headers();
      p.hits.push({ status: resp.status(), ct: (h["content-type"] || "").split(";")[0] });
    }
  }
});

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);

// 1) UI wiring present
const want = ["Jurisdictions", "County boundaries", "City limits", "City ETJ", "MUD / water districts"];
const found = {};
for (const t of want) found[t] = (await page.getByText(t, { exact: false }).count()) > 0;

// 2) Toggle all four boundary layers ON
for (const p of Object.values(PROBES)) {
  try {
    const cb = page.locator(`label:has-text("${p.label}") input[type="checkbox"]`).first();
    await cb.check({ timeout: 5000 });
  } catch (e) { pageErrors.push(`toggle "${p.label}" failed: ${e.message}`); }
}

// Zoom out to ~z9 so the MUD-dense western/suburban belt (Katy / Cypress / Fort Bend)
// is in view — still at/above every layer's minZoom (city/ETJ 9, county 6). This is the
// "known-MUD parcel" area from B176; it also forces a fresh query/export at the test view.
await page.waitForTimeout(700);
for (let i = 0; i < 2; i++) { await page.locator(".leaflet-control-zoom-out").click().catch(() => {}); await page.waitForTimeout(500); }

await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(4000);

// 3) Read each layer's status dot (a <span title="loaded|loading…|no data|failed">)
const KNOWN = ["loading…", "loaded", "no data", "failed"];
async function statusOf(labelText) {
  const titles = await page.locator(`label:has-text("${labelText}") span[title]`).evaluateAll(
    (els) => els.map((e) => e.getAttribute("title"))
  );
  return titles.find((t) => KNOWN.includes(t)) || null;
}
const dots = {};
for (const [k, p] of Object.entries(PROBES)) dots[k] = await statusOf(p.label);

await page.screenshot({ path: "gis-verify/jurisdictions-tiles-verify.png" });

// 4) Verdict
const uiPass = want.every((t) => found[t]);
const perLayer = {};
let layersPass = true;
for (const [k, p] of Object.entries(PROBES)) {
  const http200 = p.hits.filter((h) => h.status === 200).length;
  const statuses = [...new Set(p.hits.map((h) => h.status))];
  const cts = [...new Set(p.hits.map((h) => h.ct).filter(Boolean))];
  const ok = http200 > 0 && dots[k] === "loaded";
  perLayer[k] = { host: p.match, kind: p.kind, requests: p.hits.length, http200, statuses, contentTypes: cts, dot: dots[k], pass: ok };
  layersPass = layersPass && ok;
}
const pass = uiPass && layersPass && pageErrors.length === 0;

console.log("UI text present:", found);
console.log("Per-layer network + status:\n" + JSON.stringify(perLayer, null, 2));
console.log("pageErrors:", pageErrors.length, pageErrors.slice(0, 6));
console.log("consoleErrors (non-fatal, incl. expected MUD CORS probe):", consoleErrors.length);
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

await ctx.close();
await browser.close();
process.exit(pass ? 0 : 1);
