/* Self-verification for the B872 "footprint reshape fencing" round 2 fixes (owner-reported,
 * driven live on production — plan "ZZ TEST - reshape footprint - safe to delete", Goose Creek,
 * Building 2 e1454729ykduhm):
 *
 *   NEW-1 — Reshape used to REFUSE outright on a building carrying bump-outs, pointing nowhere
 *     actionable. It now auto-clears the bump-outs and enters reshape mode in one click, AND the
 *     right-click menu carries a standalone "Remove bump-outs" row whenever the building has any.
 *   NEW-2 — A corner drag could overshoot and write a self-crossing "bow-tie" polygon. The vertex
 *     now REFUSES to move into a self-intersecting/degenerate position on the frame that would
 *     create it (never only after the fact), and warns.
 *   NEW-3 — The Properties panel's Bump-outs [−]/[＋] stepper used to be all-or-nothing (a single
 *     press of [−] took the count straight to 0). It now moves one corner per press, like every
 *     sibling row (Dock zones, Car parking).
 *   NEW-4 — A blocking refusal must render in the toast's ERROR color (dark red), never the same
 *     green used for a completed action.
 *
 * Ground truth = the persisted element list (feet, exact), read straight out of localStorage, the
 * same discipline `verify-bumpout-anchor-style.mjs` uses. Logged-out, no external GIS.
 * Run:  node ui-audit/verify-b872-round2.mjs   (preview server on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { dogEarGeom } from "/home/user/planyr/src/workspaces/site-planner/lib/dogEar.js";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";

const DEMO_ID = "verify-b872-round2";
// b1: cross-dock (w>h), unrotated, 600x300 at the origin — top/bottom are the loaded dock walls,
// left/right are the free end walls. Four bump-outs, one per corner.
const B1 = { id: "b1", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0, dock: "cross" };
const corners = [["top", -1], ["top", 1], ["bottom", -1], ["bottom", 1]];
const bumps1 = corners.map(([side, sign], i) => ({
  id: `de${i}`, type: "building", ...dogEarGeom(B1, { side, sign }),
  attachedTo: "b1", noFit: true, noLabel: true, dock: "none", dogEar: { side, sign },
}));
// b2: a second cross-dock building, no bump-outs — the NEW-3 stepper case, kept well clear of b1.
const B2 = { id: "b2", type: "building", cx: 1400, cy: 0, w: 500, h: 250, rot: 0, dock: "cross" };
const els = [B1, ...bumps1, B2];
const parcel = { id: "pc1", locked: false, points: [{ x: -1000, y: -900 }, { x: 2100, y: -900 }, { x: 2100, y: 900 }, { x: -1000, y: 900 }] };
const demoSite = { id: DEMO_ID, groupId: DEMO_ID, site: "Verify B872 round 2", name: "Plan 1", origin: null, county: null,
  parcels: [parcel], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.25, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-b872-round2");
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) {}
await page.waitForTimeout(700);

let fail = 0;
const log = (ok, m) => { console.log((ok ? "✓ " : "✗ ") + m); if (!ok) fail++; };
const readEls = async () => page.evaluate((id) => { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return (m[id] && m[id].els) || []; }, DEMO_ID);
const bumpsOf = (els, id) => els.filter((x) => x.attachedTo === id && x.dogEar);
const toastState = () => page.evaluate(() => {
  const cands = [...document.querySelectorAll("div")].filter((d) => (d.textContent || "").trim().length && getComputedStyle(d).position === "fixed" && getComputedStyle(d).borderRadius && parseInt(getComputedStyle(d).borderRadius) > 40);
  const d = cands.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  return d ? { text: d.textContent.trim(), bg: getComputedStyle(d).backgroundColor } : null;
});
const rgb = (s) => (s.match(/\d+/g) || []).map(Number);
const isRed = (bg) => { const [r, g, b] = rgb(bg); return r > 100 && r > g * 1.6 && r > b * 1.6; }; // #7f1d1d-ish
const isGreen = (bg) => { const [r, g, b] = rgb(bg); return g > 100 && g > r * 1.3 && g > b * 1.3; }; // #15803d-ish

// A self-intersection check mirroring SitePlanner.jsx's own polySelfIntersects/segsCross —
// standalone here (that function isn't exported), used only to grade the FINAL persisted ring.
const o3 = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
const segsCross = (p1, p2, p3, p4) => { const o1 = o3(p1, p2, p3), o2 = o3(p1, p2, p4), o3_ = o3(p3, p4, p1), o4 = o3(p3, p4, p2); return !!o1 && !!o2 && !!o3_ && !!o4 && o1 !== o2 && o3_ !== o4; };
const selfIntersects = (pts) => { const n = pts.length; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { if ((i + 1) % n === j || (j + 1) % n === i) continue; if (segsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true; } return false; };
const shoelace = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; };

// ---------- NEW-1 · right-click menu carries "Remove bump-outs", AND reshape auto-clears + proceeds ----------
async function menuAt(x, y) {
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  await page.mouse.click(x, y, { button: "right" }); await page.waitForTimeout(350);
  return page.evaluate(() => {
    const menu = [...document.querySelectorAll(".menu")].filter((m) => m.getBoundingClientRect().width > 0).pop();
    if (!menu) return null;
    return [...menu.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter((t) => t && t.length < 60);
  });
}
const b1Box = async () => page.evaluate(() => document.querySelector('[data-el-id="b1"]').getBoundingClientRect());
let box = await b1Box();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const rows = await menuAt(cx, cy);
log(!!rows && rows.some((t) => /^Add bump-outs/i.test(t)), `NEW-1a: right-click menu offers "Add bump-outs" — ${JSON.stringify(rows)}`);
log(!!rows && rows.some((t) => /^Remove bump-outs$/i.test(t)), `NEW-1b: right-click menu offers "Remove bump-outs" (the building already carries 4)`);
const editRow = rows && rows.find((t) => /Edit footprint/i.test(t));
log(!!editRow, `NEW-1c: right-click menu offers "Edit footprint (reshape)"`);

// Click "Edit footprint (reshape)" — must NOT refuse; must clear the bumps and enter reshape mode.
await page.locator(".menu button", { hasText: "Edit footprint" }).first().click();
await page.waitForTimeout(500);
let e1 = await readEls();
const b1After = e1.find((x) => x.id === "b1");
log(Array.isArray(b1After?.points) && b1After.points.length === 4 && b1After.footEdit === true,
  `NEW-1d: building promoted to an editable polygon (points=${b1After?.points?.length}, footEdit=${b1After?.footEdit})`);
log(bumpsOf(e1, "b1").length === 0, `NEW-1e: all 4 bump-outs were cleared automatically (remaining: ${bumpsOf(e1, "b1").length})`);
let toast = await toastState();
log(!!toast && /Cleared 4 corner bump-out/i.test(toast.text) && /reshape mode/i.test(toast.text),
  `NEW-1f: the toast SAYS what happened — "${toast?.text}"`);
log(!!toast && !/Remove the corner bump-outs before editing/i.test(toast.text),
  `NEW-1g: the old dead-end refusal toast never appears`);
log(!!toast && isGreen(toast.bg) && !isRed(toast.bg),
  `NEW-4a: a COMPLETED action's toast renders in the success color, not red — bg ${toast?.bg}`);
await page.screenshot({ path: OUT + "b872-round2-new1-cleared.png" });

// ---------- NEW-3 · the Properties [-]/[+] stepper moves ONE bump-out per press, not all four ----------
box = await page.evaluate(() => document.querySelector('[data-el-id="b2"]').getBoundingClientRect());
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(350);
await page.getByRole("button", { name: /^Properties$/ }).click().catch(() => {});
await page.waitForTimeout(300);
const plus = page.locator('button[title*="Add one dock-corner bump-out"]').first();
const minus = page.locator('button[title="Remove one bump-out"]').first();
await plus.click({ timeout: 5000 }).catch(async (e) => { log(false, `NEW-3 setup: could not find the [+] stepper button — ${e.message}`); });
await page.waitForTimeout(300);
let eB2 = await readEls();
log(bumpsOf(eB2, "b2").length === 1, `NEW-3a: one press of [+] adds exactly ONE bump-out (count=${bumpsOf(eB2, "b2").length})`);
await plus.click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(300);
eB2 = await readEls();
log(bumpsOf(eB2, "b2").length === 2, `NEW-3b: a second press of [+] adds one more (count=${bumpsOf(eB2, "b2").length}, not jumping to 4)`);
await minus.click({ timeout: 5000 }).catch(async (e) => { log(false, `NEW-3 setup: could not find the [−] stepper button — ${e.message}`); });
await page.waitForTimeout(300);
eB2 = await readEls();
log(bumpsOf(eB2, "b2").length === 1,
  `NEW-3c: one press of [−] removes exactly ONE bump-out (count=${bumpsOf(eB2, "b2").length}) — was "Remove all bump-outs" on one press`);
await page.screenshot({ path: OUT + "b872-round2-new3-stepper.png" });

// ---------- NEW-2 · a corner drag can no longer overshoot into a self-crossing polygon ----------
// b1 is already in reshape mode (footEdit) from the NEW-1 check above, but the NEW-3 checks moved
// selection to b2 — re-select b1 so its vertex handles (handle-layer, selection-gated) render again.
// Its top-right corner sits on the TOP dock wall (a cross-dock building's loaded side), which is
// exactly the reported repro's shape: a dock-wall corner slides ALONG the wall (projectOntoLine,
// unbounded) rather than snapping, so an overshoot in that direction is the one this class of bug
// can actually produce.
box = await b1Box();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(350);
box = await b1Box();
const trHandle = await page.evaluate(({ x, y }) => {
  const hs = [...document.querySelectorAll('[data-testid="vtx-handle"]')].map((h) => { const b = h.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  hs.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
  return hs[0] || null;
}, { x: box.x + box.width, y: box.y });
log(!!trHandle, `NEW-2 setup: found the top-right vertex handle — ${JSON.stringify(trHandle)}`);
if (trHandle) {
  const before = (await readEls()).find((x) => x.id === "b1");
  await page.mouse.move(trHandle.x, trHandle.y);
  await page.mouse.down();
  // Drag it far past the top-left corner along the dock wall — the exact reported gesture (a
  // corner "overshooting" along a loaded wall). Several steps so the per-frame guard sees every
  // intermediate frame, same as a real drag.
  const farX = box.x - 400; // well past the building's own left edge
  for (let i = 1; i <= 20; i++) await page.mouse.move(trHandle.x + (farX - trHandle.x) * (i / 20), trHandle.y, { steps: 1 });
  await page.waitForTimeout(150);
  const midToast = await toastState();
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = (await readEls()).find((x) => x.id === "b1");
  const finalRing = after && after.points;
  log(!!finalRing && !selfIntersects(finalRing), `NEW-2a: the FINAL persisted ring is never self-intersecting — ${JSON.stringify(finalRing)}`);
  log(!!finalRing && shoelace(finalRing) > 1, `NEW-2b: the FINAL persisted ring keeps a real, positive area (${finalRing ? shoelace(finalRing).toFixed(1) : "n/a"} sf)`);
  // The dragged vertex must have been HELD well short of the cursor's extreme target — proof the
  // guard fired mid-drag rather than only cleaning up after release.
  const draggedPt = finalRing && finalRing[1]; // TR is index 1 in rectRing's TL,TR,BR,BL order
  log(!!draggedPt && draggedPt.x > before.cx - before.w / 2 - 5,
    `NEW-2c: the corner was held at/near the boundary rather than following the cursor past it (x=${draggedPt?.x?.toFixed(1)}, left edge≈${(before.cx - before.w / 2).toFixed(1)})`);
  log(!!midToast && /Reshape held/i.test(midToast.text) && isRed(midToast.bg),
    `NEW-2d/NEW-4b: mid-drag the refusal toast fires AND renders in the ERROR color — "${midToast?.text}" bg ${midToast?.bg}`);
  await page.screenshot({ path: OUT + "b872-round2-new2-guard.png" });
}

console.log(errors.length ? `\nPAGE ERRORS:\n${errors.slice(0, 5).join("\n")}` : "\n(no page errors)");
console.log(fail === 0 ? "\n✓ ALL B872-ROUND-2 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
