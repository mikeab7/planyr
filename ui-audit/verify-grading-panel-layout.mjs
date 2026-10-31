/* verify-grading-panel-layout (NEW-1, owner 2026-10-31) — drives the REAL Grading panel + controller (ui-audit/harness/grading-harness.*)
 * on the owner's Concept A (?owner=2) in headless Chromium and asserts the APPROVED LAYOUT:
 *   exactly one element carries the finished floor; none of the retired words; HAUL before CUT and FILL; a floors table of three rows
 *   whose second row types that floor (the pill flips to TYPED); the Ground block holds exactly two numbers; Limits of disturbance
 *   reads -10 on a fresh plan and typing +20 pushes the limit past the property line (the limit signature moves and a point 15 ft
 *   outside the parcel is inside the limit); a threshold flag is ONE sentence with its action link. Screenshots, light and dark, at
 *   the dock width, land in ui-audit/screenshots/grading/.
 *   node ui-audit/verify-grading-panel-layout.mjs        (starts its own vite dev server on :5198) */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5198, BASE = `http://localhost:${PORT}`;
const EXEC = process.env.PW_CHROME || undefined;
const fails = [], notes = [];
const check = (name, ok, extra = "") => { (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };
const SHOTS = new URL("./screenshots/grading/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await sleep(300); }
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const errs = [];
  const open = async (qs = "") => {
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 1500 } })).newPage();
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });   // the sandbox proxy refuses off-origin fetches (map tiles, fonts) — not an app error
    await page.goto(`${BASE}/ui-audit/harness/grading-harness.html?owner=2&buildable=0&zoom=site&mode=boundary${qs}`);
    await assertMeasurable(page, "verify-grading-panel-layout");
    await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    return page;
  };
  const floorOf = (page) => page.evaluate(() => { const i = document.querySelector('[data-testid="grading-ffe"]'); return i ? +i.value : null; });
  const settled = async (page) => {
    await page.waitForFunction(() => { const i = document.querySelector('[data-testid="grading-ffe"]'); return i && /\d/.test(i.value); }, null, { timeout: 120000 });
    await page.waitForFunction(() => document.querySelector('[data-floors-pending="0"]') && document.querySelectorAll("[data-floor-row]").length >= 2 && document.querySelector("[data-grading-earthwork='1']"), null, { timeout: 180000 });
  };

  // ================= 1. the default view =================
  let page = await open();
  await settled(page);
  const ffe0 = await floorOf(page);
  check("the floor is already there and plausible", ffe0 != null && ffe0 > 700 && ffe0 < 900, `${ffe0} ft`);
  const panel = await page.evaluate(() => document.querySelector("#panel").innerText);
  check("exactly ONE element carries the finished floor (one editor, no copy in Ground or the header)", await page.evaluate((f) => {
    const inputs = [...document.querySelectorAll("#panel input")].filter((i) => Math.abs(parseFloat(i.value) - f) < 0.001);
    const ground = document.querySelector('[data-section="ground"]').innerText;
    return document.querySelectorAll("[data-ffe-value]").length === 1 && inputs.length === 1 && !ground.includes(String(f));
  }, ffe0));
  check("the pill reads AUTO · NO HAUL", (await page.textContent('[data-ffe-source="auto"]')) === "AUTO · NO HAUL");
  for (const w of ["Around the layout", "To the boundary", "daylight inside", "faces uphill", "uphill", "steeper than", "Slopes daylight", "Grading margin", "Balanced", "Level ground", "Least cut"]) check(`panel does not say "${w}"`, !panel.includes(w));
  check("no 'clear' flag line", (await page.locator('[data-grading-flag="clear"]').count()) === 0);
  check("HAUL precedes CUT and FILL in DOM order", await page.evaluate(() => {
    const h = document.querySelector('[data-tile="haul"]'), c = document.querySelector('[data-tile="cut"]'), f = document.querySelector('[data-tile="fill"]');
    return !!h && !!c && !!f && !!(h.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(c.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  const tiles = await page.evaluate(() => ["haul", "cut", "fill"].map((k) => [document.querySelector(`[data-tile-value="${k}"]`).textContent, document.querySelector(`[data-tile-sub="${k}"]`).textContent]));
  check("tile sub-lines: haul balanced|N CY in|out, cut 'deepest N ft', fill 'tallest N ft'", /^(balanced|[\d,]+ CY (in|out))$/.test(tiles[0][1]) && /^deepest \d+ ft$/.test(tiles[1][1]) && /^tallest \d+ ft$/.test(tiles[2][1]), JSON.stringify(tiles));
  check("section order: inputs · tiles · (flags) · floors · on the map · ground", await page.evaluate(() => {
    const idx = ["inputs", "tiles", "floors", "on-the-map", "ground"].map((k) => { const e = document.querySelector(`[data-section="${k}"]`); return e ? e.getBoundingClientRect().top : -1; });
    return idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
  }));
  check("single building: no selector, no card chrome", (await page.locator('[data-section="buildings"]').count()) === 0);

  // ---- Limits of disturbance
  check("Limits of disturbance shows -10 on a fresh plan", (await page.inputValue('[data-testid="grading-limit-offset"]')) === "-10");
  check("the old Grading margin / Undisturbed buffer rows are out of the panel body", !/Undisturbed buffer|Grading margin/.test(panel));
  const sig0 = await page.getAttribute("[data-graded-area]", "data-limit-sig");
  const probe = await page.evaluate(() => {
    const ring = window.__harness.ring; let best = null;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b.x - a.x, b.y - a.y); if (!best || L > best.L) best = { a, b, L }; }
    const mx = (best.a.x + best.b.x) / 2, my = (best.a.y + best.b.y) / 2, nx = -(best.b.y - best.a.y) / best.L, ny = (best.b.x - best.a.x) / best.L;
    const inside = (p) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const A = ring[i], B = ring[j]; if ((A.y > p.y) !== (B.y > p.y) && p.x < ((B.x - A.x) * (p.y - A.y)) / (B.y - A.y) + A.x) c = !c; } return c; };
    const sgn = inside({ x: mx + nx * 3, y: my + ny * 3 }) ? -1 : 1;
    const out = { x: mx + sgn * nx * 15, y: my + sgn * ny * 15 }, inn = { x: mx - sgn * nx * 5, y: my - sgn * ny * 5 };
    return { out, inn, outsideParcel: !inside(out), insideParcel: inside(inn), outInLimit: window.__harness.pointInLimit(out), innInLimit: window.__harness.pointInLimit(inn) };
  });
  check("probe: 15 ft outside the parcel is outside the limit at -10; 5 ft inside is in the margin (outside the limit)", probe.outsideParcel && !probe.outInLimit && probe.insideParcel && !probe.innInLimit, JSON.stringify({ o: probe.outInLimit, i: probe.innInLimit }));
  await page.fill('[data-testid="grading-limit-offset"]', "+20");
  await page.keyboard.press("Enter");
  await page.waitForFunction((s) => document.querySelector("[data-graded-area]").getAttribute("data-limit-sig") !== s, sig0, { timeout: 120000 });
  const probe2 = await page.evaluate((p) => ({ out: window.__harness.pointInLimit(p.out), inn: window.__harness.pointInLimit(p.inn) }), probe);
  check("typing +20 moves the limit outward: the band's limit signature changes and the point 15 ft outside the parcel is now INSIDE the limit", probe2.out && probe2.inn, JSON.stringify(probe2));
  check("the field reads +20 and the stored margin is -20", (await page.inputValue('[data-testid="grading-limit-offset"]')) === "+20" && (await page.evaluate(() => window.__harness.settings.grading.gradingMarginFt)) === -20);
  await page.fill('[data-testid="grading-limit-offset"]', "90"); await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  check("past +50 is capped at +50", (await page.inputValue('[data-testid="grading-limit-offset"]')) === "+50");
  await page.click('[data-testid="grading-limit-minus"]');
  check("the − button steps one foot inside", (await page.inputValue('[data-testid="grading-limit-offset"]')) === "+49");
  await page.fill('[data-testid="grading-limit-offset"]', "-10"); await page.keyboard.press("Enter");
  await page.waitForFunction((s) => document.querySelector("[data-graded-area]").getAttribute("data-limit-sig") === s, sig0, { timeout: 120000 });
  check("back at -10 the limit is the original one", true);
  await settled(page);

  // ---- the floors table
  check("the floors table has three rows", (await page.locator("[data-floor-row]").count()) === 3, String(await page.locator("[data-floor-row]").count()));
  const rows = await page.evaluate(() => [...document.querySelectorAll("[data-floor-row]")].map((r) => ({ k: r.dataset.floorRow, e: +r.dataset.floorE, cur: r.dataset.floorCurrent, t: r.innerText.replace(/\s+/g, " ") })));
  check("rows are no haul · least digging · shortest slopes, no duplicate floor", rows.map((r) => r.k).join() === "nohaul,digging,slopes" && new Set(rows.map((r) => r.e)).size === 3, JSON.stringify(rows.map((r) => [r.k, r.e])));
  check("the current floor's row is the highlighted one", rows[0].cur === "1" && rows.slice(1).every((r) => r.cur === "0"));
  check("each row carries haul, deepest cut and tallest fill", rows.every((r) => /(^|\s)[+−]?[\d,]+k? \d+ ft \d+ ft/.test(r.t)), rows[0].t);
  check("HAUL BY FLOOR curve: zero line, a mark per row, the current floor as a dot, a half-foot curve", await page.evaluate(() => {
    const c = document.querySelector("[data-haul-curve]"); if (!c) return false;
    const pl = c.querySelector("polyline").getAttribute("points").trim().split(/\s+/).length;
    return !!c.querySelector("[data-haul-zero]") && c.querySelectorAll("[data-haul-mark]").length === 3 && !!c.querySelector("[data-haul-current]") && pl >= 20;
  }));
  const second = rows[1];
  await page.click('[data-floor-row="digging"]');
  await page.waitForSelector('[data-ffe-source="typed"]', { timeout: 30000 });
  check("clicking the second row flips the pill to TYPED", (await page.textContent('[data-ffe-source="typed"]')) === "TYPED");
  check("…and types that floor into the one field", Math.abs((await floorOf(page)) - second.e) < 0.01, `${await floorOf(page)} vs ${second.e}`);
  await page.waitForFunction((e) => document.querySelector('[data-floor-row="digging"]')?.dataset.floorCurrent === "1" || [...document.querySelectorAll("[data-floor-row]")].some((r) => Math.abs(+r.dataset.floorE - e) < 0.05 && r.dataset.floorCurrent === "1"), second.e, { timeout: 60000 });
  check("the table still shows the balanced floor (the typed case keeps its no-haul row)", (await page.locator('[data-floor-row="nohaul"]').count()) === 1 && Math.abs(+(await page.getAttribute('[data-floor-row="nohaul"]', "data-floor-e")) - ffe0) < 0.06);
  await page.click('[data-ffe-reset]');
  await page.waitForSelector('[data-ffe-source="auto"]');
  check("the TYPED pill resets to auto", Math.abs((await floorOf(page)) - ffe0) < 0.06);
  await settled(page);

  // ---- Ground: exactly two numbers
  check("the Ground block has exactly two numbers", (await page.locator("[data-ground-stat]").count()) === 2);
  const gtxt = await page.evaluate(() => document.querySelector('[data-section="ground"]').innerText.replace(/\s+/g, " "));
  check("Ground: '<n> of <n> AC', 'one pad at 2:1, no walls', '<n> ft relief · a to b', a severity pill", /[\d.]+ of [\d.]+ AC/.test(gtxt) && /one pad at 2:1, no walls/.test(gtxt) && /\d+ ft/.test(gtxt) && /relief · \d+ to \d+/.test(gtxt) && /(WORKABLE|TIGHT|STEEP)/.test(gtxt), gtxt);
  check("Ground: no floor, no steepness row", !/steeper|FFE|finish/i.test(gtxt) && (await page.locator("[data-ground-row]").count()) === 0);
  check("Ground keeps the 'Show buildable area on map' button", (await page.locator("[data-ground-show-buildable]").count()) === 1);

  // ---- ON THE MAP + legend
  check("ON THE MAP: four pills", (await page.locator('[data-section="on-the-map"] input[type=checkbox]').count()) === 4);
  check("legend: cut, fill, limits line, existing contour", (await page.locator("[data-legend]").count()) === 4);
  await page.click('[data-testid="grading-show-spots"]');
  await page.waitForFunction(() => document.querySelectorAll("[data-spot-set],[data-pad-corner]").length === 0, null, { timeout: 15000 });
  check("Spot elevations pill hides the labels, not the picture", (await page.locator('[data-layer="cutfill"]').count()) === 1);
  await page.click('[data-testid="grading-show-spots"]');

  // ---- the header: On switch, gear
  check("the On switch and the gear ride the header", await page.evaluate(() => { const h = document.querySelector("#panel-header-actions"); return !!h && !!h.querySelector('[data-testid="grading-plan-switch"]') && !!h.querySelector("[data-grading-gear]"); }));
  await page.click("[data-grading-gear]");
  const gear = await page.evaluate(() => document.querySelector("[data-grading-settings]")?.innerText || "");
  check("the gear holds the undisturbed buffer and the terrace depth (not the limit or the slopes)", /Undisturbed buffer/.test(gear) && /terrace or wall is usual/.test(gear) && !/Grading margin|Grading slopes/.test(gear), gear.replace(/\s+/g, " ").slice(0, 160));
  await page.keyboard.press("Escape"); await page.mouse.click(1200, 1400);

  // ---- threshold flags: a flag exists only when a number crosses its threshold (the owner's Concept A really does reach 29 ft of fill)
  const flagTexts = () => page.evaluate(() => [...document.querySelectorAll('[data-grading-flag="1"]')].map((f) => ({ k: f.dataset.flagKind, t: f.querySelector("[data-flag-text]").textContent, links: [...f.querySelectorAll("button")].map((b) => b.textContent) })));
  await page.evaluate(() => window.__harness.setSettings((s) => ({ grading: { ...s.grading, terraceDepthFt: 1, maxCutFillFt: 1 } })));
  await page.waitForFunction(() => [...document.querySelectorAll("[data-flag-text]")].some((e) => /Past 1 ft/.test(e.textContent)), null, { timeout: 60000 });
  const flags = await flagTexts();
  check("every flag is ONE sentence (or two short ones in the approved form) with only the links it owns", flags.length > 0 && flags.every((f) => /^(Fill|Cut) reaches \d+ ft( at the [\w ]+| on the [\w ]+| in the middle)?\. Past 1 ft, sites usually terrace or wall\.$/.test(f.t) && f.links.length === 1 && f.links[0] === "Second pad"), JSON.stringify(flags));
  check("…and states no state name", flags.every((f) => !/Georgia|Texas/.test(f.t)));
  check("no flag describes the ground (uphill/downhill/faces/crosses/run lengths)", flags.every((f) => !/uphill|downhill|faces|crosses|runs \d+ ft/i.test(f.t)));
  await page.screenshot({ path: `${SHOTS}panel-layout-flags.png`, clip: { x: 0, y: 0, width: 340, height: 1500 } });
  // "Second pad" searches ON CLICK (never on open): it reads "Looking…", then either moves the building or says no move within 240 ft clears it
  await page.evaluate(() => window.__harness.setSettings((s) => ({ grading: { ...s.grading, terraceDepthFt: 25, maxCutFillFt: 25 } })));
  await page.waitForFunction(() => [...document.querySelectorAll("[data-flag-text]")].some((e) => /Past 25 ft/.test(e.textContent)), null, { timeout: 60000 });
  check("on open the 'Second pad' link has searched NOTHING (idle, enabled)", (await page.locator('[data-fix="move"][data-fix-state="idle"]').count()) >= 1);
  const ring0 = await page.evaluate(() => JSON.stringify(window.__harness.els[0].ring[0]));
  await page.locator('[data-fix="move"]').first().click();
  await page.waitForFunction((r0) => JSON.stringify(window.__harness.els[0].ring[0]) !== r0 || document.querySelector('[data-fix-state="none"]'), ring0, { timeout: 240000 });
  const moved = await page.evaluate((r0) => JSON.stringify(window.__harness.els[0].ring[0]) !== r0, ring0);
  check("clicking 'Second pad' either moves the building or says no move within 240 ft clears it", moved || (await page.locator('[data-fix-state="none"]').count()) >= 1, moved ? "moved" : "none found");
  await page.evaluate(() => window.__harness.setSettings((s) => ({ grading: { ...s.grading, terraceDepthFt: 200, maxCutFillFt: 200 } })));
  await page.waitForFunction(() => document.querySelectorAll('[data-flag-kind^="depth"]').length === 0, null, { timeout: 60000 });
  check("raise the thresholds past the ground and the flags are gone — and nothing says 'clear'", (await page.locator('[data-grading-flag="clear"]').count()) === 0 && (await page.locator('[data-section="flags"]').count()) === 0);
  await page.evaluate(() => window.__harness.setSettings((s) => ({ grading: { ...s.grading, terraceDepthFt: 12, maxCutFillFt: 12 } })));
  await settled(page);
  await page.screenshot({ path: `${SHOTS}panel-layout-light.png`, clip: { x: 0, y: 0, width: 340, height: 1500 } });
  await page.close();

  // ================= 2. dark theme screenshot =================
  page = await open("&theme=dark");
  await settled(page);
  await page.screenshot({ path: `${SHOTS}panel-layout-dark.png`, clip: { x: 0, y: 0, width: 340, height: 1500 } });
  check("dark theme renders (screenshot saved)", true);
  await page.close();

  // ================= 3. several buildings: a thin selector, ONE set of blocks =================
  page = await open("&sel=none");
  await page.close();
  page = await (async () => {
    const p = await (await browser.newContext({ viewport: { width: 1500, height: 1500 } })).newPage();
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(`${BASE}/ui-audit/harness/grading-harness.html?two=1&buildable=0&zoom=site&mode=boundary`);
    await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    return p;
  })();
  await page.waitForFunction(() => document.querySelectorAll("[data-grading-card]").length === 2 && document.querySelector('[data-testid="grading-ffe"]')?.value, null, { timeout: 180000 });
  check("two buildings: a selector with two rows above ONE floor field", (await page.locator('[data-section="buildings"] [data-grading-card]').count()) === 2 && (await page.locator('[data-testid="grading-ffe"]').count()) === 1);
  check("ON THE MAP and GROUND appear once", (await page.locator('[data-section="on-the-map"]').count()) === 1 && (await page.locator('[data-section="ground"]').count()) === 1);
  const f1 = await floorOf(page);
  await page.click('[data-grading-card="b2"]');
  await page.waitForFunction((f) => { const i = document.querySelector('[data-testid="grading-ffe"]'); return i && i.value && Math.abs(+i.value - f) > 0.05; }, f1, { timeout: 120000 });
  check("clicking the other building focuses it (the one floor field now shows its floor)", (await page.locator('[data-testid="grading-ffe"]').count()) === 1);
  await page.close();

  check("no page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
  await browser.close();
} finally {
  vite.kill();
}
console.log(notes.join("\n"));
if (fails.length) { console.log("\n" + fails.join("\n")); process.exit(1); }
console.log(`\nverify-grading-panel-layout: ${notes.length} checks passed`);
