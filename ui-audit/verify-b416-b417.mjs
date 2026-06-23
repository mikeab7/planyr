/* Self-verification for B416 (trailer parking is dock-side-only) + B417 (building depth is
 * the dock-normal footprint span, never an attached truck court's depth).
 *
 * Reproduces the owner's screenshot: a 580′(w) × 664′(h) building. Because h > w the dock
 * sides resolve to LEFT/RIGHT, yet the plan carries a 135′ truck-court stack (court → trailer
 * → buffer) STRANDED on the TOP (a non-dock short side) — the exact defect. On open the planner
 * runs `pruneStrandedZones`, so:
 *
 *   B416 — Scenario A (stranded on TOP): the whole top stack is pruned → ZERO truck-court
 *          paving strips remain. Scenario B (the SAME stack on a real dock side, LEFT): it
 *          survives → the court strip is still drawn. So pruning is targeted, not blanket.
 *   B417 — the building's red depth dimension reads its footprint depth (580′), and no stray
 *          135′ truck-court dimension is left floating over the building.
 *
 * Logged-out / this-device mode (no auth needed).
 * Run:  node ui-audit/verify-b416-b417.mjs   (preview server must be on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const PAVING = "#d6d1c7"; // truck-court canvas fill (planStyle TYPE.paving), lower-cased

// A full dock-zone stack (court → trailer → buffer) bonded to building `b1` on `side`,
// positioned roughly where `layoutZone` would put it (exact geometry is irrelevant to the
// strip COUNT this harness checks — only the tags drive the prune).
const W = 580, H = 664;
const stackOn = (side) => {
  const id = (p) => `${p}-${side}`;
  if (side === "top") return [
    { id: id("court"), type: "paving", cx: 0, cy: -(H / 2 + 67.5), w: W, h: 135, rot: 0, attachedTo: "b1", truckCourt: { side }, zd: 135 },
    { id: id("trlr"), type: "trailer", cx: 0, cy: -(H / 2 + 135 + 25), w: W, h: 50, rot: 0, attachedTo: "b1", forCourt: id("court"), zd: 50, cfg: { trailerW: 12, trailerL: 50, trailerAisle: 0, single: true } },
    { id: id("buf"), type: "landscape", cx: 0, cy: -(H / 2 + 185 + 7.5), w: W, h: 15, rot: 0, attachedTo: "b1", forTrailer: id("trlr"), buffer: true, zd: 15 },
  ];
  // left
  return [
    { id: id("court"), type: "paving", cx: -(W / 2 + 67.5), cy: 0, w: 135, h: H, rot: 0, attachedTo: "b1", truckCourt: { side }, zd: 135 },
    { id: id("trlr"), type: "trailer", cx: -(W / 2 + 135 + 25), cy: 0, w: H, h: 50, rot: 90, attachedTo: "b1", forCourt: id("court"), zd: 50, cfg: { trailerW: 12, trailerL: 50, trailerAisle: 0, single: true } },
    { id: id("buf"), type: "landscape", cx: -(W / 2 + 185 + 7.5), cy: 0, w: 15, h: H, rot: 0, attachedTo: "b1", forTrailer: id("trlr"), buffer: true, zd: 15 },
  ];
};

const building = { id: "b1", type: "building", cx: 0, cy: 0, w: W, h: H, rot: 0, dock: "cross", dockSide: "right" };
const parcel = { id: "pc1", locked: false, points: [{ x: -900, y: -900 }, { x: 900, y: -900 }, { x: 900, y: 900 }, { x: -900, y: 900 }] };

const seedFor = (stackSide, demoId) => {
  const els = [building, ...stackOn(stackSide)];
  const site = {
    id: demoId, groupId: demoId, site: "Verify B416", name: "Plan 1",
    origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
    markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  return `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [demoId]: site })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoId)});
  } catch (e) {} })();`;
};

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

// Count the truck-court paving strips on screen + collect every red dimension number drawn.
const probe = async (seed, shot) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1400);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
  await page.waitForTimeout(500);
  const res = await page.evaluate((PAVING) => {
    const rects = [...document.querySelectorAll("svg rect")];
    const paving = rects.filter((r) => (r.getAttribute("fill") || "").toLowerCase() === PAVING).length;
    const dims = [...document.querySelectorAll("svg text")]
      .map((t) => (t.textContent || "").trim())
      .filter((s) => /^\d+[′']$/.test(s));
    return { paving, dims };
  }, PAVING);
  await page.screenshot({ path: OUT + shot });
  await ctx.close();
  return res;
};

let fail = 0;

// ---- Scenario A: stack stranded on the TOP (a non-dock side) → must be pruned ----
console.log("== B416: a truck-court stack stranded on a non-dock side is pruned on open ==");
const a = await probe(seedFor("top", "verify-b416-stranded"), "b416-stranded-pruned.png");
console.log(`  Scenario A (stack on TOP, docks are left/right): paving strips on screen = ${a.paving}  dims=${JSON.stringify(a.dims)}`);
if (a.paving !== 0) { console.log("  ✗ a stranded truck court is STILL drawn on the non-dock side"); fail++; }
else console.log("  ✓ no truck-court strip on the non-dock side");
// B417: the depth dim is the footprint span (580), and there is no stray 135 court depth left.
if (a.dims.includes("135′") || a.dims.includes("135'")) { console.log("  ✗ a stray 135′ truck-court depth is still floating over the building"); fail++; }
else console.log("  ✓ no stray 135′ depth dimension");
if (a.dims.some((d) => d.startsWith("580"))) console.log("  ✓ building depth dimension reads its 580′ footprint depth");
else { console.log("  ✗ building 580′ footprint-depth dimension not found"); fail++; }

// ---- Scenario B: the SAME stack on a real dock side (LEFT) → must survive ----
console.log("== B416: an identical stack on a real dock side is KEPT (prune is targeted) ==");
const b = await probe(seedFor("left", "verify-b416-kept"), "b416-dockside-kept.png");
console.log(`  Scenario B (stack on LEFT, a dock side): paving strips on screen = ${b.paving}`);
if (b.paving < 1) { console.log("  ✗ a valid dock-side truck court was wrongly pruned"); fail++; }
else console.log("  ✓ the dock-side truck court survives");

console.log(fail === 0 ? "\n✓ ALL B416+B417 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
