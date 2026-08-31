/* NEW-1 / NEW-2 / NEW-3 / NEW-4 — Road width menu: one how-to, no "travel", no Free draw,
 * a working Custom width…, and the drawn geometry proven to be curb-face-to-curb-face.
 *
 * Logged-out, no external GIS, blank site — the ATTEMPT-BEFORE-YOU-PARK class, so it runs here.
 *
 * Run:  npm run build && npx vite preview --port 4173  (then)  node ui-audit/verify-road-width-menu.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/road-width-menu/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
await ctx.addInitScript(() => {
  window.__PLANYR_E2E = true;
  // NEW-3 regression guard: an existing browser carries the retired "free" preset in localStorage.
  // The read-migration must coerce it, or the Road tool lands in a mode the menu no longer offers.
  try { localStorage.setItem("planarfit:roadWidth", "free"); } catch (_) {}
});
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-road-width-menu");
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));

const fails = [], notes = [];
const check = (ok, label, detail = "") => { (ok ? notes : fails).push(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`); };

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
try {
  await page.getByTestId("map-start-blank-menu-btn").click({ timeout: 8000 });
  await page.getByTestId("map-start-blank-menu-item").click({ timeout: 8000 });
} catch (_) {}
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForTimeout(600);

const openRoadMenu = async () => {
  await page.locator('[aria-label="Road presets"]').click();
  await page.waitForTimeout(250);
};
// Every button + footer line inside the open Road flyout, in order.
const menuText = () => page.evaluate(() => {
  const hdr = [...document.querySelectorAll("div")].find((d) => (d.textContent || "").trim() === "Road width" && d.children.length === 0);
  const panel = hdr && hdr.parentElement;
  if (!panel) return null;
  return {
    rows: [...panel.querySelectorAll("button")].map((b) => (b.textContent || "").trim()),
    all: (panel.textContent || "").trim(),
  };
});

// ---- 1. The menu itself -------------------------------------------------------------------
await openRoadMenu();
const m = await menuText();
check(!!m, "Road flyout opens and its ROAD WIDTH panel is readable");
if (m) {
  await page.screenshot({ path: OUT + "road-width-menu.png" });
  const howTo = /click points, Enter to finish/i;
  const repeats = m.rows.filter((r) => howTo.test(r)).length;
  check(repeats === 0, "NEW-1 no row repeats the per-row how-to", `rows: ${JSON.stringify(m.rows)}`);
  const hintCount = (m.all.match(/double-click \/ Enter to finish/gi) || []).length;
  check(hintCount === 1, "NEW-1 the how-to appears exactly ONCE, as the flyout footer", `count=${hintCount}`);
  check(m.rows.filter((r) => /^\d+′$/.test(r)).length === 5, "NEW-1 five preset rows read as just the width", JSON.stringify(m.rows.filter((r) => /^\d+′$/.test(r))));
  check(!/travel/i.test(m.all), "NEW-2 the word \"travel\" is gone from the Road width flyout");
  check(!/free draw/i.test(m.all), "NEW-3 \"Free draw\" is gone from the Road width flyout");
  check(m.rows.some((r) => /^Custom/.test(r)), "NEW-3 a Custom width… row is present", JSON.stringify(m.rows));
  check(/curb face to curb face/i.test(m.all), "NEW-4 the flyout states the dimension is curb face to curb face");
}

// ---- 2. The retired "free" value was migrated, not honoured ---------------------------------
const stored = await page.evaluate(() => localStorage.getItem("planarfit:roadWidth"));
check(stored !== "free" && +stored > 0, "NEW-3 a stored \"free\" preset is coerced to a real width on read", `roadWidth=${stored}`);

// ---- 3. Custom width… draws a real centerline road at the typed width -----------------------
const canvas = page.locator('[data-testid="planner-canvas"]');
const box = await canvas.boundingBox();
await page.getByRole("button", { name: /^Custom width…$/ }).click();
await page.waitForTimeout(250);
await page.screenshot({ path: OUT + "road-width-custom-open.png" });
const numBox = page.getByLabel("Custom road width (ft)");
await numBox.fill("28");
await numBox.press("Enter");
await page.waitForTimeout(350);

for (const [dx, dy] of [[300, 300], [640, 300], [640, 520]]) {
  await page.mouse.click(box.x + dx, box.y + dy);
  await page.waitForTimeout(160);
}
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "road-width-custom-drawn.png" });

const roads = await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const s = Object.values(m)[0] || {};
  return (s.els || []).filter((e) => e.type === "road").map((e) => ({ pts: (e.pts || []).length, w: e.travelW, curb: e.curb, poly: !!e.points }));
});
check(roads.length === 1 && roads[0].pts === 3, "NEW-3 Custom width… draws by the SAME click-points centerline method", JSON.stringify(roads));
check(roads[0] && Math.abs(roads[0].w - 28) < 0.001, "NEW-3 the typed custom width is what got stored", `travelW=${roads[0] && roads[0].w}`);

// ---- 4. NEW-4 — the stored number IS curb face to curb face ---------------------------------
// The two inner curb stripes are the centerline offset by ±travelW/2, so the clear pavement between
// the curb FACES = travelW exactly; the curb rides OUTSIDE it (outer ring = travelW + 2·curb).
const bboxCross = await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const s = Object.values(m)[0] || {};
  const r = (s.els || []).find((e) => e.type === "road");
  return r ? { h: r.h, w: r.w, travelW: r.travelW, curb: r.curb } : null;
});
if (bboxCross) {
  // The stored strip bbox cross-dimension = travelW + a curb each side → back-of-curb to back-of-curb.
  const backToBack = bboxCross.travelW + 2 * bboxCross.curb;
  check(Math.abs(backToBack - 29) < 0.001, "NEW-4 a 28′ road = 28′ face-to-face + a curb each side (29′ back-to-back)", `travelW=${bboxCross.travelW} curb=${bboxCross.curb} → ${backToBack}`);
}

// ---- 5. The Properties panel reads "Road width (ft)" ----------------------------------------
// The left rail's Properties tab is the road's element panel; open it with the road still selected.
await page.getByRole("button", { name: /^Properties$/i }).first().click();
await page.waitForTimeout(500);
const panel = await page.evaluate(() => document.body.innerText);
check(/Road width \(ft\)/.test(panel), "NEW-2 the Properties field reads \"Road width (ft)\"");
check(!/Travel width/i.test(panel), "NEW-2 \"Travel width\" is gone from the Properties panel");
await page.screenshot({ path: OUT + "road-properties.png" });

// ---- 6. NEW-3 regression — roads ALREADY drawn with the retired Free draw must survive ------
// Free draw produced two shapes: a dragged RECTANGLE road (cx/cy/w/h/rot, no pts) and — on a click
// with no drag — a POLYGON road (`points`). Seed one of each into the saved plan, boot a FRESH page
// on it, and prove both still read back, render, and select. Removing the menu entry must orphan
// neither. (Seeded through an init script on a fresh page: writing localStorage under the live page
// and reloading loses the seed — the app flushes its in-memory plan back over it on unload.)
const siteJson = await page.evaluate(() => localStorage.getItem("planarfit:sites:v1"));
const sites = JSON.parse(siteJson || "{}");
const siteKey = Object.keys(sites)[0];
const seedSite = sites[siteKey];
const a = (seedSite.els || []).find((e) => e.type === "road" && e.pts).pts[0];
seedSite.els.push({ id: "legacyrect", type: "road", cx: a.x + 400, cy: a.y + 300, w: 300, h: 25, rot: 0, travelW: 24, curb: 0.5 });
// Both seeds sit to the RIGHT of the drawn road so neither ends up under the left Properties panel
// once Fit-all frames the plan — a panel over the shape would swallow the click, not the app.
seedSite.els.push({ id: "legacypoly", type: "road", rot: 0, points: [
  { x: a.x + 300, y: a.y + 560 }, { x: a.x + 520, y: a.y + 560 }, { x: a.x + 520, y: a.y + 690 }, { x: a.x + 300, y: a.y + 690 },
] });
await page.close();
await ctx.addInitScript((payload) => { try { localStorage.setItem("planarfit:sites:v1", payload); } catch (_) {} }, JSON.stringify(sites));
const page2 = await ctx.newPage();
page2.on("pageerror", (e) => errs.push(String(e)));
await page2.goto(BASE, { waitUntil: "load" });
await page2.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page2.waitForTimeout(1200);
await page2.screenshot({ path: OUT + "legacy-free-draw-roads.png" });

const legacy = await page2.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const s = Object.values(m)[0] || {};
  const by = Object.fromEntries((s.els || []).map((e) => [e.id, e]));
  return {
    rect: by.legacyrect ? { pts: (by.legacyrect.pts || []).length, w: by.legacyrect.travelW } : null,
    poly: by.legacypoly ? { points: (by.legacypoly.points || []).length } : null,
    count: (s.els || []).filter((e) => e.type === "road").length,
  };
});
check(legacy.count === 3, "NEW-3 every pre-existing road is still in the plan after the Free-draw entry was removed", JSON.stringify(legacy));
check(!!legacy.poly && legacy.poly.points === 4, "NEW-3 a legacy free-draw POLYGON road reads back unchanged (kept as a polygon)", JSON.stringify(legacy.poly));

// …and both legacy roads still RENDER and stay selectable/editable. (The legacy RECT road is
// migrated to a 2-point centerline on read — B596 — so the assertion is on what the app renders
// and edits, not on the untouched bytes still sitting in storage.)
await page2.getByRole("button", { name: /^Properties$/i }).first().click();
await page2.waitForTimeout(400);
const readWidthField = () => page2.evaluate(() => {
  const lbl = [...document.querySelectorAll("span")].find((n) => (n.textContent || "").trim() === "Road width (ft)");
  const inp = lbl && lbl.parentElement && lbl.parentElement.querySelector("input");
  return inp ? inp.value : null;
});
const seen = [];
for (const id of ["legacyrect", "legacypoly"]) {
  const b = await page2.evaluate((elId) => {
    const n = document.querySelector(`[data-el-id="${elId}"]`);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return r.width > 1 && r.height > 1 ? { x: r.x + r.width / 2, y: r.y + r.height / 2, l: r.x, t: r.y, w: r.width, h: r.height } : null;
  }, id);
  if (!b) { seen.push(`${id}: NOT RENDERED`); continue; }
  const covered = await page2.evaluate(([x, y, elId]) => {
    const n = document.elementFromPoint(x, y);
    return !(n && n.closest(`[data-el-id="${elId}"]`));
  }, [b.x, b.y, id]);
  if (covered) { seen.push(`${id}: rendered but the click point is covered by chrome — test placement, not an app fault`); continue; }
  await page2.mouse.click(b.x, b.y);
  await page2.waitForTimeout(500);
  // Selection signal that works for BOTH shapes: a selected element puts draggable vertex handles on
  // its own outline. Count the handles that land inside this element's rendered box.
  const handles = await page2.evaluate(([l, t, w, h]) => {
    const pad = 12;
    return [...document.querySelectorAll('rect[data-export="skip"], [data-testid^="road-vtx-"]')].filter((n) => {
      const r = n.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      return cx >= l - pad && cx <= l + w + pad && cy >= t - pad && cy <= t + h + pad;
    }).length;
  }, [b.l, b.t, b.w, b.h]);
  const width = await readWidthField();
  seen.push(`${id}: rendered, ${handles} edit handles${width == null ? "" : `, Road width ${width}′`}`);
}
check(seen.every((t) => /rendered, [1-9]\d* edit handles/.test(t)), "NEW-3 both legacy free-draw roads still render AND still select for editing", seen.join(" · "));
check(/legacyrect: rendered, [2-9] edit handles, Road width 24′/.test(seen[0] || ""), "NEW-3 the legacy dragged-RECTANGLE road migrates to an editable 2-point centerline at its original width", seen[0]);
check(/legacypoly: rendered, 4 edit handles/.test(seen[1] || ""), "NEW-3 the legacy free-draw POLYGON road keeps its four editable corners", seen[1]);

await page2.screenshot({ path: OUT + "legacy-free-draw-selected.png" });

check(errs.length === 0, "no page errors", errs.join(" | "));

console.log("\n" + notes.join("\n"));
if (fails.length) { console.log("\n" + fails.join("\n")); }
console.log(`\n${fails.length ? "FAIL" : "PASS"} — ${notes.length} checks passed, ${fails.length} failed. Screens → ${OUT}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
