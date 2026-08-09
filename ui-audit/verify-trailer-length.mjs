/* Self-verification: trailer parking can be a DIFFERENT length from the truck court.
 *
 * The reported bug: "I can't make the trailer parking any different of a length than the truck
 * court, and I should be able to adjust it." Structurally true — every zone in the dock chain was
 * laid out from the court's ONE resolved span, with no per-zone escape (court w=772 / trailer
 * w=772 on the owner's live plan, twice over).
 *
 * The fix is NOT to undo the shared span (that is the deliberate 2026-06-30 fix that stopped the
 * trailer over-hanging the court, and verify-trailer-tracks-court.mjs still guards it). It is the
 * same derive-by-default / preserve-once-touched rule side parking and the dog-ears use: the
 * trailer TRACKS the court until you give it a length, then it keeps that length — clamped to the
 * wall, never reset — through host resizes, bump-out add/delete and court depth changes.
 *
 * Ground truth = the persisted element list (feet, exact) read back from localStorage after each
 * UI action, driven through the REAL render path. Logged-out / this-device mode (no auth).
 * Preview server must be on :4173.
 * Run:  node ui-audit/verify-trailer-length.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEMO_ID = "verify-trailer-length";
const els = [{ id: "b1", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0, dock: "cross" }];
const parcel = { id: "pc1", locked: false, points: [{ x: -900, y: -660 }, { x: 900, y: -660 }, { x: 900, y: 660 }, { x: -900, y: 660 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify trailer length", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-trailer-length");
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const near = (a, b, eps = 3) => Math.abs(a - b) <= eps;

const readEls = async (pred = () => true, tries = 16) => {
  for (let i = 0; i < tries; i++) {
    const got = await page.evaluate((id) => {
      try { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return (m[id] && m[id].els) || null; } catch (e) { return null; }
    }, DEMO_ID);
    if (got && pred(got)) return got;
    await page.waitForTimeout(300);
  }
  return await page.evaluate((id) => { try { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return (m[id] && m[id].els) || []; } catch (e) { return []; } }, DEMO_ID);
};
const topCourt = (a) => a.find((x) => x.truckCourt && x.truckCourt.side === "top") || {};
const topTrailer = (a) => { const c = topCourt(a); return a.find((x) => x.type === "trailer" && x.forCourt === c.id) || {}; };
const building = (a) => a.find((x) => x.id === "b1") || {};

const clickByTitle = async (re, { optional = false } = {}) => {
  const r = await page.evaluate((src) => {
    const rx = new RegExp(src);
    for (const b of document.querySelectorAll("button")) {
      if (b.offsetParent === null) continue;
      const t = (b.getAttribute("title") || b.textContent || "").trim();
      if (rx.test(t) && !b.disabled) { b.click(); return t || "(btn)"; }
    }
    return null;
  }, re.source);
  await page.waitForTimeout(400);
  if (!r && !optional) throw new Error("control not found: " + re);
  return r;
};

// The building rect gives us the feet→screen mapping (its box IS 600×300 ft), so a zone can be
// clicked at its real position rather than a guessed pixel.
const buildingBox = async () => page.evaluate(() => {
  const r = [...document.querySelectorAll("svg rect")].find((x) => (x.getAttribute("fill") || "").toLowerCase() === "#f3ece1");
  if (!r) return null;
  const b = r.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
});
// The inspector is a docked panel that a canvas click no longer opens on its own — open it
// explicitly so the building's dock controls are reachable.
const openProps = async () => {
  const has = await page.evaluate(() => /Extend every dock side|Dock zones|Zone depths/.test(document.body.innerText));
  if (has) return;
  await page.evaluate(() => {
    for (const b of document.querySelectorAll("button")) {
      if ((b.textContent || "").trim() === "Properties") { b.click(); return; }
    }
  });
  await page.waitForTimeout(450);
};
const selectBuilding = async () => {
  const bb = await buildingBox();
  if (!bb) { console.log("✗ building rect not found"); process.exit(1); }
  await page.mouse.click(bb.x + bb.w * 0.35, bb.y + bb.h * 0.4);
  await page.waitForTimeout(400);
  await openProps();
};
// Click a point given in plan FEET relative to the building centre.
const clickFeet = async (fx, fy) => {
  const bb = await buildingBox();
  const ppf = bb.h / 300;
  await page.mouse.click(bb.x + bb.w / 2 + fx * ppf, bb.y + bb.h / 2 + fy * ppf);
  await page.waitForTimeout(400);
};
// Type into the inspector field whose label starts with `label`.
const setField = async (label, value) => {
  const ok = await page.evaluate((lbl) => {
    for (const row of document.querySelectorAll("div")) {
      const span = row.firstElementChild;
      if (!span || span.tagName !== "SPAN") continue;
      if (!(span.textContent || "").trim().startsWith(lbl)) continue;
      const input = row.querySelector("input");
      if (input) { input.focus(); return true; }
    }
    return false;
  }, label);
  if (!ok) throw new Error("field not found: " + label);
  await page.keyboard.press("Control+a");
  await page.keyboard.type(String(value));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
};

// ---- walk the stack outward: court, then trailer ----
await selectBuilding();
await clickByTitle(/Extend every dock side/);
await readEls((a) => a.some((x) => x.truckCourt));
await selectBuilding();
await clickByTitle(/Extend every dock side/);
let e0 = await readEls((a) => a.some((x) => x.type === "trailer" && x.forCourt));
const c0 = topCourt(e0), t0 = topTrailer(e0);
log(near(c0.w, 600) && near(t0.w, 600), `baseline: court and trailer both span the 600′ wall (${(c0.w||0).toFixed(0)} / ${(t0.w||0).toFixed(0)}) — the DEFAULT, unchanged`);

// ---- select the trailer and give it its OWN length ----
// The top trailer sits beyond the court: court 135′ deep from the wall at y=-150, trailer 50′ beyond.
await clickFeet(0, -310);
const picked = await page.evaluate(() => {
  const t = [...document.querySelectorAll("*")].map((n) => n.textContent || "");
  return t.some((s) => /Trailer parking length \(ft\)/.test(s));
});
log(picked, "selecting the trailer opens its inspector, which now offers a LENGTH field (it never had one)");
if (!picked) { await page.screenshot({ path: OUT + "trailer-length-nosel.png" }); }

await setField("Trailer parking length", 420);
let e1 = await readEls((a) => near(topTrailer(a).w, 420, 4));
const c1 = topCourt(e1), t1 = topTrailer(e1);
log(near(t1.w, 420), `THE FIX — trailer set SHORTER than the court: ${(t1.w||0).toFixed(0)}′ (expect 420, was locked to the court)`);
log(near(c1.w, 600), `…and the court is untouched at ${(c1.w||0).toFixed(0)}′ — the two are no longer one span`);
await page.screenshot({ path: OUT + "trailer-length-1-shorter.png" });

// ---- a LONGER trailer than the court, which the shared-span model made impossible ----
await setField("Trailer parking length", 560);
let e2 = await readEls((a) => near(topTrailer(a).w, 560, 4));
log(near(topTrailer(e2).w, 560), `trailer set LONGER than the court's clear face: ${(topTrailer(e2).w||0).toFixed(0)}′ (expect 560)`);

// ---- bump-outs: the COURT pulls in, the pinned trailer does NOT ----
await selectBuilding();
await clickByTitle(/Add dock-corner bump-outs/);
let e3 = await readEls((a) => near(topCourt(a).w, 490, 6));
log(near(topCourt(e3).w, 490), `bump-outs added: court pulls in to the clear face (${(topCourt(e3).w||0).toFixed(0)}′)`);
log(near(topTrailer(e3).w, 560), `…the user-set trailer length SURVIVES it (${(topTrailer(e3).w||0).toFixed(0)}′, expect 560)`);

await selectBuilding();
await clickByTitle(/Remove all bump-outs/);
let e4 = await readEls((a) => !a.some((x) => x.dogEar));
log(near(topCourt(e4).w, 600), `bump-outs removed: court re-expands (${(topCourt(e4).w||0).toFixed(0)}′)`);
log(near(topTrailer(e4).w, 560), `…the trailer still holds its length (${(topTrailer(e4).w||0).toFixed(0)}′, expect 560)`);

// ---- court DEPTH change: the trailer moves outward but keeps its length ----
await clickFeet(0, -220);                                   // select the truck court
await setField("Truck court depth", 180);
let e5 = await readEls((a) => near(topCourt(a).h, 180, 4));
log(near(topCourt(e5).h, 180), `court depth changed to ${(topCourt(e5).h||0).toFixed(0)}′`);
log(near(topTrailer(e5).w, 560), `…the trailer keeps its length through it (${(topTrailer(e5).w||0).toFixed(0)}′, expect 560)`);
log(topTrailer(e5).cy < topTrailer(e4).cy, "…and simply moves outward with the deeper court, rather than being resized");

// ---- HOST RESIZE: shrink past the set length → clamped, not forgotten; grow → springs back ----
await selectBuilding();
await setField("Length (ft)", 460);
let e6 = await readEls((a) => near(building(a).w, 460, 4));
log(near(topTrailer(e6).w, 460), `host shrunk to 460′: the 560′ trailer CLAMPS to the wall (${(topTrailer(e6).w||0).toFixed(0)}′) rather than overhanging`);
await page.screenshot({ path: OUT + "trailer-length-2-clamped.png" });

await selectBuilding();
await setField("Length (ft)", 700);
let e7 = await readEls((a) => near(building(a).w, 700, 4));
log(near(topTrailer(e7).w, 560), `host grown to 700′: the stored 560′ SPRINGS BACK (${(topTrailer(e7).w||0).toFixed(0)}′) — clamped, never reset`);
log(near(topCourt(e7).w, 700), `…while the court still spans the full wall (${(topCourt(e7).w||0).toFixed(0)}′)`);
await page.screenshot({ path: OUT + "trailer-length-3-sprungback.png" });

// ---- "set ↺" hands it back to the court ----
// the trailer, now beyond a 180′-deep court: wall at −150, court to −330, trailer centre −355
await clickFeet(0, -355);
await clickByTitle(/Go back to matching the truck court/, { optional: true });
let e8 = await readEls((a) => near(topTrailer(a).w, topCourt(a).w, 4));
log(near(topTrailer(e8).w, topCourt(e8).w), `"set ↺" returns the trailer to tracking the court (${(topTrailer(e8).w||0).toFixed(0)}′ vs ${(topCourt(e8).w||0).toFixed(0)}′)`);

// ---- the RESIZE GRIP along that axis actually drags (the owner's literal complaint) ----
// The trailer is back to tracking the 700′ court. Drag its left edge inward by 100′ and the length
// must stick — the same capture the typed field uses, reached the way a user actually reaches it.
{
  const bb = await buildingBox();
  const ppf = bb.h / 300;
  const cxPx = bb.x + bb.w / 2, cyPx = bb.y + bb.h / 2;
  const px = (fx, fy) => ({ x: cxPx + fx * ppf, y: cyPx + fy * ppf });
  const from = px(-350, -355), to = px(-250, -355);        // left edge midpoint → 100′ inward
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const e9 = await readEls((a) => (topTrailer(a).w || 0) < 690);
  const t9 = topTrailer(e9);
  log(t9.w > 520 && t9.w < 680, `dragging the trailer's end grip resizes it along the wall (${(t9.w || 0).toFixed(0)}′ from 700′)`);
  log(near(topCourt(e9).w, 700), `…and the court is NOT dragged with it (${(topCourt(e9).w || 0).toFixed(0)}′)`);
  log(Number.isFinite(t9.alongLen) && t9.alongLen > 0, `…the dragged length is REMEMBERED on the trailer (alongLen=${t9.alongLen})`);
  await page.screenshot({ path: OUT + "trailer-length-4-dragged.png" });
}

console.log(errors.length ? `\nPAGE ERRORS:\n${errors.slice(0, 8).join("\n")}` : "\n(no page errors)");
console.log(fail === 0 ? "\n✓ ALL TRAILER-LENGTH CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
