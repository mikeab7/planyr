/* Self-verification for the flexible outward "layer stack" (B495).
 *
 * The owner wanted to choose what the next outward layer is — a road behind the trailer buffer, a
 * landscape buffer behind parking, etc. The fast "+" keeps the preset sequence; a new "Add layer ▾"
 * chooser appends a specific catalog layer (sidewalk / parking / landscape buffer / road). This
 * drives the real panel controls and reads the persisted element list (feet, exact) back from
 * localStorage to confirm the layers land, bond, and peel correctly. Logged-out / this-device mode.
 * Run:  node ui-audit/verify-zone-catalog.mjs   (preview server must be on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEMO_ID = "verify-b495";
const els = [{ id: "b1", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0, dock: "cross" }];
const parcel = { id: "pc1", locked: false, points: [{ x: -1100, y: -800 }, { x: 1100, y: -800 }, { x: 1100, y: 800 }, { x: -1100, y: 800 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B495", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const near = (a, b, eps = 2) => Math.abs(a - b) <= eps;

const readEls = async (pred = () => true, tries = 14) => {
  for (let i = 0; i < tries; i++) {
    const got = await page.evaluate((id) => { try { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return (m[id] && m[id].els) || null; } catch (e) { return null; } }, DEMO_ID);
    if (got && pred(got)) return got;
    await page.waitForTimeout(300);
  }
  return await page.evaluate((id) => { try { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return (m[id] && m[id].els) || []; } catch (e) { return []; } }, DEMO_ID);
};

// click a visible panel button whose title/text matches `re`
const clickByText = async (re, { optional = false } = {}) => {
  const r = await page.evaluate((src) => {
    const rx = new RegExp(src);
    for (const b of document.querySelectorAll("button")) {
      if (b.offsetParent === null || b.disabled) continue;
      const t = (b.getAttribute("title") || b.textContent || "").trim();
      if (rx.test(t)) { b.click(); return t || "(btn)"; }
    }
    return null;
  }, re.source);
  await page.waitForTimeout(350);
  if (!r && !optional) throw new Error("control not found: " + re);
  return r;
};
// Open the "Add layer ▾" whose own row label matches `labelRe`, then click the "＋ <chipWord>" chip.
const addLayer = async (labelRe, chipWord) => {
  const opened = await page.evaluate((lsrc) => {
    const lrx = new RegExp(lsrc);
    const btn = [...document.querySelectorAll("button")].find((b) => /Add layer/.test(b.textContent || "") && lrx.test((b.parentElement && b.parentElement.textContent) || ""));
    if (btn) { btn.click(); return true; }
    return false;
  }, labelRe.source);
  await page.waitForTimeout(250);
  // the chip text is exactly "＋ <word>" — anchored so it never matches the toolbar "Road" tool
  const picked = await page.evaluate((w) => {
    const rx = new RegExp("^＋\\s*" + w, "i");
    const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent !== null && rx.test((x.textContent || "").trim()));
    if (b) { b.click(); return (b.textContent || "").trim(); }
    return null;
  }, chipWord);
  await page.waitForTimeout(300);
  return opened && picked;
};

// select the building
const bsel = await page.evaluate(() => {
  const r = [...document.querySelectorAll("svg rect")].find((x) => (x.getAttribute("fill") || "").toLowerCase() === "#f3ece1");
  if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width * 0.35, y: b.y + b.height * 0.4 };
});
if (!bsel) { console.log("✗ building rect not found"); process.exit(1); }
await page.mouse.click(bsel.x, bsel.y);
await page.waitForTimeout(400);

// ---- 0) fast "+" builds the preset court → trailer → buffer ----
await clickByText(/Extend every dock side/);
await clickByText(/Extend every dock side/);
await clickByText(/Extend every dock side/);
let e0 = await readEls((a) => a.some((x) => x.type === "landscape" && x.forTrailer));
const court = e0.find((x) => x.truckCourt && x.truckCourt.side === "top");
const buffer = e0.find((x) => x.type === "landscape" && x.forTrailer && x.attachedTo === "b1");
log(!!court && !!buffer, `preset dock stack built (court + trailer + buffer present)`);

// ---- 1) Add a ROAD behind the dock stack ----
await addLayer(/Behind the dock stack/, "Road");
let e1 = await readEls((a) => a.some((x) => x.type === "road" && x.attachedTo === "b1"));
const roads = e1.filter((x) => x.type === "road" && x.attachedTo === "b1");
const topBuffer = e1.find((x) => x.type === "landscape" && x.forTrailer && x.truckCourt == null && x.attachedTo === "b1" && x.cy < 0);
const dockRoad = roads.find((x) => x.cy < 0); // top dock side road
log(roads.length >= 1, `B495 ROAD appended behind the dock stack (${roads.length} on dock sides)`);
log(!!dockRoad && !!dockRoad.prevZone && !!dockRoad.travelW, `road carries prevZone bond + travelW (prevZone=${dockRoad && dockRoad.prevZone ? "set" : "MISSING"}, travelW=${dockRoad ? dockRoad.travelW : "?"})`);
// road sits flush beyond the buffer (its near face == buffer far face), full wall length
if (dockRoad && topBuffer) {
  const roadNear = Math.abs(dockRoad.cy) - dockRoad.h / 2, bufFar = Math.abs(topBuffer.cy) + topBuffer.h / 2;
  log(near(roadNear, bufFar) && near(dockRoad.w, 600), `road flush beyond buffer + full 600′ wall (gap ${(roadNear - bufFar).toFixed(1)}, w=${dockRoad.w.toFixed(0)})`);
}
await page.screenshot({ path: OUT + "b495-road.png" });

// ---- 2) Add a LANDSCAPE BUFFER on the rear / non-dock sides ----
await addLayer(/Rear/, "Landscape buffer");
let e2 = await readEls((a) => a.some((x) => x.type === "landscape" && x.stackSide && (x.stackSide === "left" || x.stackSide === "right")));
const rearLand = e2.filter((x) => x.type === "landscape" && (x.stackSide === "left" || x.stackSide === "right"));
log(rearLand.length >= 1, `B495 LANDSCAPE BUFFER appended on a non-dock (rear) side (${rearLand.length})`);

// ---- 3) "−" peels the OUTERMOST first (the road), buffer stays (LIFO) ----
await clickByText(/Pull every dock side/);
let e3 = await readEls((a) => !a.some((x) => x.type === "road" && x.attachedTo === "b1" && x.cy < 0));
const roadsAfter = e3.filter((x) => x.type === "road" && x.attachedTo === "b1");
const bufferAfter = e3.find((x) => x.type === "landscape" && x.forTrailer && x.attachedTo === "b1");
log(roadsAfter.length < roads.length && !!bufferAfter, `LIFO remove peeled the road first; the buffer remains (roads ${roads.length}→${roadsAfter.length}, buffer ${bufferAfter ? "kept" : "GONE"})`);

console.log(errors.length ? `\nPAGE ERRORS:\n${errors.slice(0, 8).join("\n")}` : "\n(no page errors)");
console.log(fail === 0 ? "\n✓ ALL B495 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
