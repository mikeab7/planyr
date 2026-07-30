/**
 * NEW-1 — state + country outlines at wide zoom: verify what REACHES THE SCREEN.
 *
 * WHY PIXELS AND NETWORK, NOT MODULE STATE. B1127 is the cautionary tale in this repo:
 * twenty-six unit tests passed while every Colorado site showed a spinner forever, because
 * nothing asserted on the rendered result. So this harness never asks the Leaflet instance
 * anything. It drives the map with the SAME affordance the owner uses — the +/- zoom
 * control — and then judges two observables:
 *
 *   1. PIXELS. A screenshot of the map, scored for boundary-coloured pixels. Boundaries
 *      present at wide zoom, MORE of them once state lines join, and NONE at site zoom.
 *   2. THE NETWORK. Neither the layer chunk nor the ~100 KB geometry asset may be
 *      requested before the user zooms out — the bundle-budget promise is only real if
 *      nothing fetches it at boot.
 *
 * Zoom is driven by clicking the zoom-out control past its floor, so the starting zoom
 * never has to be assumed: the map clamps at its minimum (3) and every later position is
 * counted from that known floor. No internals are read to establish it.
 *
 * The sandbox blocks external tile hosts, so the basemap is blank here. That is fine and
 * in fact makes the pixel test cleaner — with no imagery, the only thing that can put a
 * dark hairline on the map is this layer. It does mean the check proves the lines are
 * DRAWN, not that they read well over live aerial imagery; that judgement is the live one.
 *
 * Run:  npm run build && npx vite preview --port 4173 &   then
 *       node ui-audit/verify-admin-boundaries.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const OUT = new URL("./screens/admin-boundaries/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/* No saved sites at all: no pins, no plans, nothing on the map but the layer under test,
 * and no `currentSite` so the app lands on the map finder rather than the planner. */
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', '{}');
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

const results = [];
const ok = (label, cond, extra = "") => {
  results.push(cond);
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
};

/* How much INK the boundary layer has actually put on screen, read back out of the
 * rendered raster with getImageData — the pixels themselves, not any module's opinion
 * about them. The layer owns its pane outright, so every non-transparent pixel in there
 * is a boundary and nothing else; zero ink means nothing is drawn, whatever the code
 * believes. Also returns the pane's on-screen geometry, because ink inside a collapsed or
 * hidden pane would not reach the eye. */
const inkAndPane = (page) => page.evaluate(() => {
  const pane = document.querySelector(".leaflet-pane.leaflet-adminboundaries-pane");
  if (!pane) return { ink: 0, levels: "(no pane)", pane: null };
  const cs = getComputedStyle(pane);
  let ink = 0, w = 0, h = 0;
  for (const c of pane.querySelectorAll("canvas")) {
    if (!c.width || !c.height) continue;
    /* The PANE itself is a zero-size positioning context — Leaflet absolutely-positions
     * the canvas inside it — so the on-screen box to check is the canvas's, not the pane's. */
    const box = c.getBoundingClientRect();
    w = Math.max(w, Math.round(box.width)); h = Math.max(h, Math.round(box.height));
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink++;
  }
  return {
    ink,
    levels: pane.dataset.levels ?? "",
    pane: { w, h, pointerEvents: cs.pointerEvents, visibility: cs.visibility, display: cs.display, zIndex: cs.zIndex },
  };
});

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
await ctx.addInitScript(seed);

/* Every external host is unreachable from the sandbox; abort them outright so a hanging
 * tile request can never be mistaken for a slow app. Same-origin traffic passes through
 * and is what the network assertions below watch. */
const asked = [];
await ctx.route("**/*", (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE)) { asked.push(url.slice(BASE.length)); return route.continue(); }
  if (url.startsWith("http")) return route.abort();
  return route.continue();
});

const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector(".leaflet-container", { timeout: 20000 });
await page.waitForTimeout(2500);

const askedFor = (frag) => asked.some((u) => u.includes(frag));

console.log("\nNEW-1 · wide-zoom state + country outlines\n");

/* ---- 1. nothing is fetched at boot ---------------------------------------------------- */
ok("at site zoom, the geometry asset is never requested", !askedFor("geo/admin-boundaries.json"));
ok("at site zoom, the boundary layer chunk is never requested", !askedFor("adminBoundaryLayer"));

const map = page.locator(".leaflet-container").first();
const zoomOut = page.locator(".leaflet-control-zoom-out").first();
const zoomIn = page.locator(".leaflet-control-zoom-in").first();
/* Leaflet ignores a zoom-control click while a zoom animation is still running, so the
 * clicks are spaced well clear of it — a tighter loop silently drops levels and lands the
 * map somewhere other than where the test thinks it is. */
const click = async (btn, times) => {
  for (let i = 0; i < times; i++) { await btn.click({ force: true }); await page.waitForTimeout(500); }
  await page.waitForTimeout(800);
};

/* ---- 2. site zoom: nothing drawn ------------------------------------------------------ */
await map.screenshot({ path: `${OUT}site-zoom.png` });
const atSite = (await inkAndPane(page)).ink;

/* ---- 3. zoom out to the floor (clamps at 3): countries only --------------------------- */
await click(zoomOut, 10);           // more than enough to hit the min-zoom floor from any start
await page.waitForTimeout(1500);    // the chunk + asset land on the first crossing
await map.screenshot({ path: `${OUT}zoom-floor.png` });
const floor = await inkAndPane(page);

ok("zooming out requests the geometry asset", askedFor("geo/admin-boundaries.json"));
ok("zooming out requests the boundary layer chunk", askedFor("adminBoundaryLayer"));
ok("boundaries are ON SCREEN at the widest zoom", floor.ink > 2000, `${floor.ink} lit px`);
ok("boundaries are ABSENT at site working zoom", atSite === 0, `${atSite} lit px before any zoom-out`);
ok("the pane they are drawn in is really on screen", !!floor.pane && floor.pane.w > 400 && floor.pane.h > 300
  && floor.pane.visibility === "visible" && floor.pane.display !== "none",
  floor.pane ? `${floor.pane.w}x${floor.pane.h} ${floor.pane.visibility}` : "(no pane)");

/* ---- 4. the two levels, and where each one switches on -------------------------------- */
/* Ink cannot be compared across zooms — a level closer in shows less of the world, so the
 * total falls even as detail is added. What IS comparable is WHICH levels are drawn, which
 * the layer stamps on its own pane after each sync. Both are checked: the stamp says which
 * levels the layer put down, the ink says something actually landed on the raster. */
ok("at the widest zoom, countries only — fifty state outlines would be mush here",
  floor.levels === "country", `data-levels="${floor.levels}"`);

await click(zoomIn, 2);             // the floor is 3, so this is zoom 5
await map.screenshot({ path: `${OUT}zoom-states.png` });
const states = await inkAndPane(page);
ok("state outlines join the countries once they can resolve",
  states.levels === "country admin1", `data-levels="${states.levels}"`);
ok("and the added level really reaches the raster", states.ink > 2000, `${states.ink} lit px`);

/* ---- 5. back in to site zoom: gone again ---------------------------------------------- */
await click(zoomIn, 10);            // zoom 5 → 15, well inside the old floor of 8
await map.screenshot({ path: `${OUT}back-to-site.png` });
const back = await inkAndPane(page);
ok("boundaries disappear again on the way back in to site zoom", back.ink === 0 && back.levels === "",
  `${back.ink} lit px, data-levels="${back.levels}"`);

/* ---- 6. the layer never steals a click, and never sits over site geometry -------------- */
ok("the boundary pane cannot take a click from the map", floor.pane?.pointerEvents === "none", floor.pane?.pointerEvents);
ok("the boundary pane sits below the vector-overlay pane (400) and every marker",
  Number(floor.pane?.zIndex) < 400, `z-index ${floor.pane?.zIndex}`);

ok("no page errors", errors.length === 0, errors[0] || "");

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${failed ? `✗ ${failed} of ${results.length} checks failed` : `✓ all ${results.length} checks passed`}`);
console.log(`  screenshots → ui-audit/screens/admin-boundaries/`);
process.exit(failed ? 1 : 0);
