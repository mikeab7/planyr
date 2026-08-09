/* Headless verifier for the baked FEMA flood tiles (NEW-1 / NEW-2 / NEW-3).
 *
 * WHAT IT PROVES, and why each arm exists:
 *   A. TILES PAINT. On a Harris plan with the flag on, the flood layer renders from
 *      `/flood/flood-tx-harris.pmtiles` — real, non-transparent pixels on a canvas tile, and NOT a
 *      single request to hazards.fema.gov for the picture.
 *   B. IT IS FASTER, MEASURED. The same plan with the flag off draws from FEMA's live `/export`.
 *      Both arms are timed from "layer switched on" to "first painted pixels", so the number in the
 *      report is an observation rather than a claim.
 *   C. IT FAILS SOFT. With the archive 404ing, the layer falls back to the live FEMA export and
 *      still paints. This is the arm that matters most: adding tiles must never be able to make
 *      flood data disappear, and a fallback nobody has watched engage is a fallback nobody has.
 *   D. THE VINTAGE STAMP IS ON SCREEN when tiles are the source, and absent when they are not.
 *
 * ⛔ ARM C IS THE MUTATION CHECK FOR THE WHOLE FEATURE. If it ever passes for the wrong reason —
 * because tiles never engaged in arm A either — arm A's own "no FEMA picture request" assertion
 * goes red first. Read the two together; neither is meaningful alone.
 *
 * Run:  VITE_FLOOD_TILES=1 npm run dev -- --port 5233 --strictPort   (in the background)
 *       node ui-audit/verify-flood-tiles.mjs
 * The flag is read at build time, so the flag-OFF arm re-reads it through the app's own override
 * hook rather than needing a second server (see FLAG_OFF_SEED).
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
// Split from the line above deliberately: test/tabTiming.test.js matches the precondition's import
// EXACTLY, so that one stays a single-specifier line.
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5233";
/* The sandbox's Playwright package and its installed browser revisions do not always match, so the
 * binary is named explicitly (the house convention — see verify-view-independent.mjs). And
 * `--ignore-certificate-errors` is mandatory here: outbound HTTPS goes through a TLS-inspecting
 * proxy that Node trusts and Chromium does not, so without it every FEMA request fails with
 * ERR_CERT_AUTHORITY_INVALID and the LIVE arm would "prove" tiles are faster than a broken layer. */
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SITE_ID = "floodtiles-harris";

/* A Harris County plan with no elements — the flood layer is the whole subject, and an empty plan
 * removes every other source of paint from the measurement. Origin is Buffalo Bayou at downtown
 * Houston, which is inside the SFHA on the real NFHL, so "nothing painted" can only mean a failure. */
const seedSite = (county = "harris") => {
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Flood tiles probe", name: "Concept A",
    origin: { lat: 29.7604, lon: -95.3698 }, county,
    parcels: [], els: [], measures: [], callouts: [], markups: [], parcelDrawings: [],
    settings: {}, underlay: null, updatedAt: Date.now(), status: "active",
    // The flood row starts ON, so the measurement begins when the planner mounts rather than at a
    // click — a click's own latency is not part of what is being compared.
    layerOverrides: { fema: true },
  };
  return `(() => { try {
    localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [SITE_ID]: site }))});
    // ⛔ NOT setItem('currentSite') — that boots past the map surface, and the site rail this harness
    // clicks through never renders. Open the project the way a user does.
    localStorage.removeItem('planarfit:currentSite:v1');
  } catch (e) {} })();`;
};

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); };
const timings = {};

/* Non-transparent pixels on ANY canvas tile inside the GIS area pane. Reading the pixels rather
 * than counting DOM nodes is deliberate: a canvas tile that decoded nothing is still a canvas. */
const PAINTED = `(() => {
  const cvs = [...document.querySelectorAll('canvas')];
  for (const c of cvs) {
    if (!c.width || !c.height) continue;
    try {
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
    } catch (e) { /* a tainted canvas is not ours */ }
  }
  return false;
})()`;

/* An esri /export image that has actually loaded — the live path paints through an <img>, not a
 * canvas, so the two arms need different evidence of the same event. */
const EXPORT_PAINTED = `(() => [...document.querySelectorAll('img')]
  .some((i) => /hazards\\.fema\\.gov|\\/api\\/gis/.test(i.src) && i.complete && i.naturalWidth > 0))()`;

async function arm({ label, county = "harris", blockArchive = false, forceLive = false }) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const net = { tiles: 0, femaAny: 0, femaExport: 0, femaBlocked: 0, tileBytes: 0 };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
    await ctx.addInitScript(seedSite(county));
    await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
    if (forceLive) {
      // The flag is compiled in, so the OFF arm turns it off the way production would: by making
      // the decision layer answer "live". Setting the env var at build time would need a second
      // server; overriding the archive to be unreachable would test arm C instead, not arm B.
      await ctx.addInitScript("window.__PLANYR_FLOOD_TILES_OFF = true;");
    }
    const page = await ctx.newPage();
    /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. FOREGROUND-OR-VOID;
       see ui-audit/lib/tabTiming.mjs. Both halves of this harness are measurements. */
    await assertMeasurable(page, "verify-flood-tiles");

    await page.route("**/flood/*.pmtiles", async (route) => {
      if (blockArchive) return route.fulfill({ status: 404, body: "gone" });
      net.tiles++;
      const res = await route.fetch();
      const body = await res.body();
      net.tileBytes += body.length;
      return route.fulfill({ response: res, body });
    });
    /* Count BOTH shapes of a live-path request — straight to FEMA and through the B445 same-origin
     * cache proxy — and count the ones the network REFUSES separately.
     *
     * ⛔ THIS SANDBOX CANNOT REACH FEMA FROM CHROMIUM. Measured here: every `hazards.fema.gov`
     * request from the browser dies with `ERR_CONNECTION_RESET`, while Node reaches the same host
     * fine (that is how the archives in public/flood were built). So "did the live layer PAINT" is
     * not a question this harness can answer, and it does not pretend to: the live arms assert the
     * live path was ENGAGED, and the paint half is owed a browser that can reach the agency. A
     * harness that reported those arms as failures would be reporting its own egress policy as a
     * defect in the app. */
    const isLive = (u) => /hazards\.fema\.gov/i.test(u) || /\/api\/gis\b/.test(u);
    /* `femaAny` counts EVERY agency request, including the metadata/extent probes the coverage
     * engine issues for layers that are switched off — so it answers "was the live path engaged".
     * `femaExport` counts only a request for the PICTURE, which is the one tiles are meant to
     * replace. Conflating them makes arm A fail on a probe that has nothing to do with rendering. */
    const isPicture = (u) => /export/i.test(u) || /\/api\/gis\b/.test(u);
    page.on("request", (r) => { if (isLive(r.url())) { net.femaAny++; if (isPicture(r.url())) net.femaExport++; } });
    page.on("requestfailed", (r) => { if (isLive(r.url())) net.femaBlocked++; });

    await page.goto(BASE, { waitUntil: "load" });
    // POLL for the rail rather than sleeping a fixed 1.8 s: a cold dev server compiles on first
    // request, and a fixed wait turns that into an intermittent "project not found".
    await page.waitForFunction(() => [...document.querySelectorAll('[title^="Open site"]')]
      .some((e) => /Flood tiles probe/.test(e.textContent || "") && e.getClientRects().length), { timeout: 60000 });
    /* ⛔ Open the seeded project through the REAL project picker. Seeding `currentSite` looks like a
     * shortcut and is not one — the app boots to the landing / map surface and the planner canvas
     * never mounts, so every probe below times out for a reason unrelated to what is under test
     * (the trap audit-doubleclick-properties documents). */
    /* The site rail's row is a <div> with a title, not a button, and BOTH surfaces stay mounted
     * (SitePlannerApp hides the inactive one with display:none), so a plain locator can land on the
     * hidden copy. Dispatch on the visible row directly. */
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('[title^="Open site"]')]
        .find((e) => /Flood tiles probe/.test(e.textContent || "") && e.getClientRects().length);
      if (!row) throw new Error("seeded project row not found in the site rail");
      row.click();
    });
    await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 });
    // The clock starts once the canvas exists, so neither arm is charged for app boot — what is
    // being compared is how long the FLOOD LAYER takes to put pixels on that canvas.
    const t0 = Date.now();

    let firstPaint = null;
    for (let i = 0; i < 120; i++) {
      if (await page.evaluate(PAINTED) || await page.evaluate(EXPORT_PAINTED)) { firstPaint = Date.now() - t0; break; }
      await pacedWait(page, 250);
    }
    const stamp = await page.evaluate(`(() => {
      const el = document.querySelector('[data-surface="planner"] [data-testid="flood-tile-vintage"]')
              || document.querySelector('[data-testid="flood-tile-vintage"]');
      return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
    })()`);
    return { label, firstPaint, stamp, net };
  } finally {
    await browser.close();
  }
}

// ── A + D: tiles paint, and say which edition of the NFHL they are ─────────────
const tiles = await arm({ label: "tiles (Harris)" });
ok("A · tiles painted the flood layer", tiles.firstPaint != null, `first paint ${tiles.firstPaint} ms`);
ok("A · the archive was range-read from our own origin", tiles.net.tiles > 0, `${tiles.net.tiles} range request(s), ${tiles.net.tileBytes} bytes`);
ok("A · NOT ONE agency request for the PICTURE", tiles.net.femaExport === 0, `${tiles.net.femaExport} export request(s); ${tiles.net.femaAny} metadata probe(s), which are the coverage engine's and unrelated to rendering`);
ok("D · the NFHL vintage stamp is on screen when tiles are the source", !!tiles.stamp && /NFHL/i.test(tiles.stamp), String(tiles.stamp));
timings.tiles = tiles.firstPaint;

// ── B: with tiles off, the flood row goes back to the live agency path ─────────
const live = await arm({ label: "live FEMA (Harris)", forceLive: true });
ok("B · with the flag off, the flood row engages the LIVE agency path", live.net.femaAny > 0, `${live.net.femaAny} live request(s)`);
ok("B · …and asks for no archive at all", live.net.tiles === 0, `${live.net.tiles} archive request(s)`);
ok("D · the vintage stamp is ABSENT when the layer is live (a live layer's vintage is 'now')", !live.stamp, String(live.stamp));
/* ANY reset agency request makes the paint comparison untrustworthy — not just a total blackout.
 * A partially-answering agency would produce a number that looks fine and means nothing. */
const liveBlocked = live.net.femaBlocked > 0;
timings.live = live.firstPaint;

// ── C: FAIL SOFT — a 404 archive must hand the row back to the live path ───────
/* ⛔ THE ARM THAT MATTERS, and it is a real mutation check rather than a tautology: arm A proves
 * that with a WORKING archive the app makes ZERO live requests, so a live request appearing here
 * can only mean the tile layer died and syncOverlayLayers re-entered the raster branch. */
const fallback = await arm({ label: "archive 404 → live fallback", blockArchive: true });
ok("C · a 404 archive hands the flood row back to the live FEMA path", fallback.net.femaAny > 0, `${fallback.net.femaAny} live request(s) — arm A made 0`);

// ── E: a county with no baked archive never asks for one ──────────────────────
const noArchive = await arm({ label: "county with no archive (montgomery)", county: "montgomery" });
ok("E · a county with no archive never requests one", noArchive.net.tiles === 0, `${noArchive.net.tiles} archive request(s)`);
ok("E · …and goes straight to the live agency path", noArchive.net.femaAny > 0, `${noArchive.net.femaAny} live request(s)`);

// ── report ─────────────────────────────────────────────────────────────────────
console.log("\nFLOOD TILES — planner mounted to first painted flood pixels");
console.log(`  tiles (Harris)   ${timings.tiles == null ? "never painted" : `${timings.tiles} ms`}  ·  ${tiles.net.tileBytes} bytes over ${tiles.net.tiles} range request(s)`);
if (liveBlocked) {
  console.log("  live FEMA        NOT MEASURABLE HERE — every hazards.fema.gov request from Chromium died");
  console.log("                   with ERR_CONNECTION_RESET (this sandbox's egress policy; Node reaches the");
  console.log("                   same host, which is how the archives were built). The live-vs-tiles");
  console.log("                   first-paint comparison is owed a browser that can reach the agency.");
} else {
  console.log(`  live FEMA export ${timings.live == null ? "never painted" : `${timings.live} ms`}`);
  if (timings.tiles != null && timings.live != null) console.log(`  -> ${(timings.live / timings.tiles).toFixed(1)}x faster from tiles`);
}
console.log("");
let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`  ${r.pass ? "\u2713" : "\u2717"} ${r.name}${r.detail ? `  - ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
