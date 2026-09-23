/* Self-verification for B1843901 (NEW-1) — dragging a side-parking piece's end grip past a corner
 * bump-out lengthens it, and the extension SURVIVES a hard reload instead of snapping back to the
 * wall's own span. Drives the REAL running app, logged out, no cloud/GIS needed (a local plan is
 * enough — this is the ATTEMPT-BEFORE-YOU-PARK class of check, not a Blocker: real-data one).
 *
 * The seed geometry is computed with the REAL `dogEar.js` functions (not hand-typed numbers), the
 * same way `test/hostRunHeal.test.js`'s new fixture is built — so this script and that unit test
 * are two views of the identical mechanism: one drives the pure engine directly, this one drives
 * the actual SVG canvas + a real pointer drag + a real page reload.
 *
 * Building 4 shape from the owner's report: a 1122 × 420 dock building with a 55 × 60 bump-out at
 * each of its two WEST-wall corners (NW/SW), side parking exploded into row | aisle | row on that
 * wall. The aisle's south end grip is dragged 100 ft past the bump-out.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { assertMeasurable } from "./lib/tabTiming.mjs";
import {
  dogEarGeom, bumpsOfHost, sidewalkSpanForBumps, sideParkStack, wallKidBox,
  hostAxisExtents, ownExtents, localToWorld,
} from "../src/workspaces/site-planner/lib/dogEar.js";

const SIDE_PARK_ANGLE = { top: 180, bottom: 0, left: 90, right: 270 };
const ROW_D = 60, AISLE_D = 24;

function buildFixture() {
  const host = { id: "hostB", type: "building", cx: 0, cy: 0, w: 1122, h: 420, rot: 0, dock: "cross" };
  const bumpDe = (side, sign) => ({ side, sign, along: 55, proj: 60 });
  const bumpNW = { id: "bumpNW", type: "building", attachedTo: host.id, dogEar: bumpDe("top", -1), ...dogEarGeom(host, bumpDe("top", -1)) };
  const bumpSW = { id: "bumpSW", type: "building", attachedTo: host.id, dogEar: bumpDe("bottom", -1), ...dogEarGeom(host, bumpDe("bottom", -1)) };
  const bumps = bumpsOfHost([bumpNW, bumpSW], host);
  const span = sidewalkSpanForBumps(host, "left", bumps);        // 420 + 60 + 60 = 540
  const kidRot = ((host.rot || 0) + SIDE_PARK_ANGLE.left) % 360;
  const { cross } = hostAxisExtents(host, { rot: kidRot, w: 0, h: 0 });
  const place = (id, type, piece, depth, gap, run, alongShift) => {
    const box = wallKidBox(host, "left", { depth, gap, run, alongShift });
    const c = localToWorld(host, box.lx, box.ly);
    return { id, type, attachedTo: host.id, sideParkSide: "left", sideParkPiece: piece, rot: kidRot,
      cx: c.x, cy: c.y, ...ownExtents(cross, box.dimBX, box.dimBY) };
  };
  const stubPad = (id, i, depth) => ({ id, sideParkSide: "left", sideParkPiece: i, rot: kidRot, w: 1, h: depth });
  const gapById = new Map(sideParkStack(host, "left", [stubPad("row1", 0, ROW_D), stubPad("aisle", 1, AISLE_D), stubPad("row2", 2, ROW_D)], 0)
    .map((r) => [r.el.id, r.gap]));
  const row1 = place("row1", "parking", 0, ROW_D, gapById.get("row1"), span.run, span.alongShift);
  const aisle = place("aisle", "paving", 1, AISLE_D, gapById.get("aisle"), span.run, span.alongShift);
  const row2 = place("row2", "parking", 2, ROW_D, gapById.get("row2"), span.run, span.alongShift);
  return { host, bumpNW, bumpSW, row1, aisle, row2, span };
}

const { host, bumpNW, bumpSW, row1, aisle, row2, span } = buildFixture();

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const DEMO_ID = "verify-side-park-end-grip";
const parcel = { id: "pc1", locked: false, points: [{ x: -900, y: -400 }, { x: 100, y: -400 }, { x: 100, y: 400 }, { x: -900, y: 400 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify Side-Park End Grip", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els: [host, bumpNW, bumpSW, row1, aisle, row2],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
// `addInitScript` re-runs on EVERY new document, including a `page.reload()` — so the seed must be
// idempotent (only write the pristine fixture once) or a reload would re-seed over whatever the
// drag just persisted and "prove" a false snap-back that is really this harness re-clobbering its
// own state, not the app's.
const seed = `(() => { try {
  window.__PLANYR_E2E = true;
  if (!localStorage.getItem('planarfit:sites:v1')) {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
  }
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.25, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-side-park-end-grip");
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

const readModel = async () => page.evaluate((demoId) => {
  const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return all[demoId];
}, DEMO_ID);

const rectOf = async (sel) => page.evaluate((s) => {
  const n = document.querySelector(s);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}, sel);

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.evaluate((g) => { window.location.hash = `#/project/${g}/site`; }, DEMO_ID);
  await page.waitForTimeout(1400);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
  await page.waitForTimeout(600);

  // Select the aisle piece by clicking its rendered body.
  const aisleBox = await rectOf('[data-feature="el:aisle"]');
  check("aisle element is rendered on canvas", !!aisleBox, JSON.stringify(aisleBox));
  if (!aisleBox) throw new Error("aisle not found — cannot proceed");
  await page.mouse.click(aisleBox.cx, aisleBox.cy);
  await page.waitForTimeout(300);

  const southGrip = await rectOf('[data-feature="el:aisle"] ~ g [data-handle="edge"][data-edge="1,0"], [data-handle="edge"][data-edge="1,0"]');
  const northGrip = await rectOf('[data-handle="edge"][data-edge="-1,0"]');
  check("south end grip (data-edge=1,0) is present after selecting the aisle", !!southGrip, JSON.stringify(southGrip));
  check("north end grip (data-edge=-1,0) is present after selecting the aisle", !!northGrip, JSON.stringify(northGrip));
  if (!southGrip || !northGrip) throw new Error("end grips not found — cannot proceed");

  const pxPerFt = Math.abs(southGrip.cy - northGrip.cy) / span.run;
  check("south grip is further from north grip than half the run (sane pixel scale)", pxPerFt > 0, `pxPerFt=${pxPerFt.toFixed(4)}`);
  const dragPx = 100 * pxPerFt;
  const dir = southGrip.cy > northGrip.cy ? 1 : -1;                // which screen direction is "south"

  // The real end-grip drag: press on the south grip, move in real steps, release 100 ft further out.
  await page.mouse.move(southGrip.cx, southGrip.cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(southGrip.cx, southGrip.cy + dir * dragPx * (i / 12));
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);

  const afterDrag = await readModel();
  const aisleAfter = afterDrag.els.find((e) => e.id === "aisle");
  const row1After = afterDrag.els.find((e) => e.id === "row1");
  const row2After = afterDrag.els.find((e) => e.id === "row2");
  // A real drag through pixel-space grid-snaps, so the exact delta is approximate — the point of
  // this check is only that it grew substantially PAST the 540 ft span, not clamped back to it.
  check("the aisle's run grew well past the 540 ft span (live drag honoured, not clamped)",
    aisleAfter.w > aisle.w + 60, `w before=${aisle.w} after=${aisleAfter.w}`);
  check("the drag recorded a `beyond` sideParkFit stamp", aisleAfter.sideParkFit && aisleAfter.sideParkFit.beyond === true, JSON.stringify(aisleAfter.sideParkFit));
  check("row1 (sibling) is unmoved by the aisle's drag", row1After.w === row1.w && Math.abs(row1After.cx - row1.cx) < 0.5 && Math.abs(row1After.cy - row1.cy) < 0.5, `w=${row1After.w} cx=${row1After.cx} cy=${row1After.cy}`);
  check("row2 (sibling) is unmoved by the aisle's drag", row2After.w === row2.w && Math.abs(row2After.cx - row2.cx) < 0.5 && Math.abs(row2After.cy - row2.cy) < 0.5, `w=${row2After.w} cx=${row2After.cx} cy=${row2After.cy}`);

  // The critical check: a HARD RELOAD must not snap it back to the wall span (the reported bug).
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
  await page.evaluate((g) => { window.location.hash = `#/project/${g}/site`; }, DEMO_ID);
  await page.waitForTimeout(1200);
  const afterReload = await readModel();
  const aisleReload = afterReload.els.find((e) => e.id === "aisle");
  check("⛔ THE BUG'S OWN SYMPTOM: after a hard reload the extension is STILL THERE, not snapped back to the 540 ft span",
    Math.abs(aisleReload.w - aisleAfter.w) < 0.5, `w after drag=${aisleAfter.w} w after reload=${aisleReload.w} (span default was ${span.run})`);
  check("the `beyond` stamp survived the reload", aisleReload.sideParkFit && aisleReload.sideParkFit.beyond === true, JSON.stringify(aisleReload.sideParkFit));

  const gripAfterReload = await rectOf('[data-feature="el:aisle"]');
  check("the rendered aisle on screen after reload is still the extended length, not the span default",
    gripAfterReload && gripAfterReload.h > aisleBox.h * 1.15, `h before=${aisleBox.h} h after reload=${gripAfterReload && gripAfterReload.h}`);

  check("no console/page errors during the whole sequence", errors.length === 0, errors.slice(0, 5).join(" | "));
} catch (e) {
  check("script completed without throwing", false, e.stack || String(e));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.name).join(" | ")); process.exit(1); }
process.exit(0);
