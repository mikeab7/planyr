/* Self-verification for B121 (edge-dimension callouts folded into the label collision pool +
 * "Show dimensions" / "Show areas" toggles) and B148 (no world-space site-summary banner), driven
 * in the REAL app on the Vite preview (:4173), logged-out / this-device mode. Run:
 *   npm run build && npm run preview &   # then:
 *   node ui-audit/verify-b121-b148.mjs
 *
 * Seeds a dense building + paving strip + pond + 2nd building layout, zooms to fit, and asserts:
 *   B121-A: NO red dimension number (<text fill=#dc2626>) overlaps a centred element label
 *           (<text> with <tspan> children) — at fit zoom AND zoomed in. The pile-up is resolved.
 *   B121-B: seeding settings.showDims=false hides ALL red dimensions; showAreas=false drops the
 *           sf/acre line from labels (name + the pond "Holds…ac-ft" storage line stay). The ⚙ Setup
 *           panel renders both checkboxes and unchecking "Show dimensions" live-hides the callouts.
 *   B148  : no on-canvas text balloons — text height holds CONSTANT while the drawing grows on
 *           zoom-in (a world-space banner would scale with ppf); totals live in screen-space UI.
 * Ground truth = the rendered DOM + zero page errors.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const parcel = { id: "pc1", locked: false, points: [{ x: -360, y: -300 }, { x: 360, y: -300 }, { x: 360, y: 300 }, { x: -360, y: 300 }] };
// A packed layout so labels + dimension callouts land close together at fit zoom.
const els = [
  { id: "b1", type: "building", cx: -90, cy: -150, w: 420, h: 170, rot: 0 },
  { id: "pv1", type: "paving", cx: -90, cy: 10, w: 420, h: 90, rot: 0 },
  { id: "pond1", type: "pond", cx: 210, cy: 170, w: 260, h: 200, rot: 0 },
  { id: "b2", type: "building", cx: -230, cy: 190, w: 200, h: 150, rot: 0 },
];
const siteWith = (settings) => ({
  id: "verify-b121", groupId: "verify-b121", site: "Verify B121/B148", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [],
  callouts: [], markups: [], settings, underlay: null, parcelDrawings: [], updatedAt: 1,
});
const seedFor = (settings) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ "verify-b121": siteWith(settings) })}));
  localStorage.setItem('planarfit:currentSite:v1', 'verify-b121');
} catch (e) {} })();`;

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const rectsIntersect = (a, b, tol = 3) =>
  a.x + a.w - tol > b.x && b.x + b.w - tol > a.x && a.y + a.h - tol > b.y && b.y + b.h - tol > a.y;

// Read the on-canvas texts: red dimension numbers vs centred element labels (tspan-bearing).
const readTexts = (page) => page.evaluate(() => {
  const svg = [...document.querySelectorAll("svg")].sort((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return (rb.width * rb.height) - (ra.width * ra.height);
  })[0];
  if (!svg) return { dims: [], labels: [], maxH: 0, maxRectW: 0 };
  const texts = [...svg.querySelectorAll("text")];
  const box = (t) => { const b = t.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, s: t.textContent }; };
  const isRed = (t) => (t.getAttribute("fill") || "").toLowerCase() === "#dc2626";
  const dims = texts.filter((t) => isRed(t) && t.getBoundingClientRect().width > 0).map(box);
  const labels = texts.filter((t) => !isRed(t) && t.querySelector("tspan") && t.getBoundingClientRect().width > 0).map(box);
  const maxH = Math.max(0, ...texts.map((t) => t.getBoundingClientRect().height));
  const maxRectW = Math.max(0, ...[...svg.querySelectorAll("rect")].map((r) => r.getBoundingClientRect().width));
  return { dims, labels, maxH, maxRectW };
});

async function boot(ctx, settings) {
  await ctx.addInitScript(seedFor(settings));
  const page = await ctx.newPage();
  const errors = [];
  const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
  await page.waitForTimeout(500);
  return { page, errors };
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });

// ---------- Load 1: default settings (both toggles ON) ----------
{
  const { page, errors } = await boot(ctx, {});
  const t = await readTexts(page);
  await page.screenshot({ path: OUT + "b121-default.png" });
  log(t.dims.length > 0, `B121: red dimension callouts render at fit zoom (${t.dims.length} shown)`);
  log(t.labels.length > 0, `B121: centred element labels render (${t.labels.length} shown)`);
  let overlaps = 0, worst = null;
  for (const d of t.dims) for (const l of t.labels) if (rectsIntersect(d, l)) { overlaps++; worst = worst || { d: d.s, l: l.s }; }
  log(overlaps === 0, `B121: NO red dimension overprints a centred label (${overlaps} overlaps${worst ? ` e.g. "${worst.d}" on "${worst.l}"` : ""})`);
  log(t.maxH < 80, `B148: no giant world-space banner at fit zoom (tallest text ${t.maxH.toFixed(1)}px — a normal multi-line label)`);
  await page.mouse.move(720, 450);
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(40); }
  await page.waitForTimeout(400);
  const tz = await readTexts(page);
  log(tz.maxRectW > t.maxRectW * 1.4, `B148: zoom-in actually enlarged the drawing (widest shape ${t.maxRectW.toFixed(0)}px → ${tz.maxRectW.toFixed(0)}px)`);
  log(Math.abs(tz.maxH - t.maxH) < 6, `B148: text size held CONSTANT across that zoom (${t.maxH.toFixed(1)}px → ${tz.maxH.toFixed(1)}px) — no text is drawn in world feet`);
  let zOverlaps = 0;
  for (const d of tz.dims) for (const l of tz.labels) if (rectsIntersect(d, l)) zOverlaps++;
  log(zOverlaps === 0, `B121: no-overprint invariant still holds zoomed IN (${zOverlaps} overlaps among ${tz.dims.length} dims / ${tz.labels.length} labels)`);
  log(errors.length === 0, `no page errors (${errors.length})` + (errors.length ? " → " + errors.slice(0, 2).join(" | ") : ""));
  await page.close();
}

// ---------- Load 2: showDims = false ----------
{
  const { page } = await boot(ctx, { showDims: false });
  const t = await readTexts(page);
  await page.screenshot({ path: OUT + "b121-nodims.png" });
  log(t.dims.length === 0, `B121 toggle: settings.showDims=false hides ALL red dimensions (${t.dims.length} shown)`);
  log(t.labels.length > 0, `B121 toggle: element labels still render with dimensions off (${t.labels.length})`);
  await page.close();
}

// ---------- Load 3: showAreas = false ----------
{
  const { page } = await boot(ctx, { showAreas: false });
  const t = await readTexts(page);
  await page.screenshot({ path: OUT + "b121-noareas.png" });
  // "sf" appears ONLY on area lines; the pond's KEPT storage line is "Holds N ac-ft …" (no "sf").
  const anyArea = t.labels.some((l) => /sf/i.test(l.s || ""));
  const anyName = t.labels.some((l) => /Building|Pond|Paving/i.test(l.s || ""));
  log(!anyArea, `B121 toggle: settings.showAreas=false drops the sf/acre line from labels (any "sf" line left: ${anyArea})`);
  log(anyName, `B121 toggle: element NAME labels stay when areas are off (${anyName})`);
  await page.close();
}

// ---------- Load 4: the ⚙ Setup panel exposes both checkboxes, and toggling one works live ----------
{
  const { page } = await boot(ctx, {});
  let opened = false;
  for (const sel of ['button:has-text("Setup")', '[title="Setup"]', 'button:has-text("⚙")']) {
    try { await page.locator(sel).first().click({ timeout: 2500 }); opened = true; break; } catch (e) { /* try next */ }
  }
  await page.waitForTimeout(400);
  const hasToggles = await page.evaluate(() => {
    const t = document.body.innerText;
    return { dims: /Show dimensions/i.test(t), areas: /Show areas/i.test(t) };
  });
  log(opened && hasToggles.dims && hasToggles.areas, `B121 UI: the Setup panel shows "Show dimensions" + "Show areas" checkboxes (opened:${opened} dims:${hasToggles.dims} areas:${hasToggles.areas})`);
  if (hasToggles.dims) {
    const before = (await readTexts(page)).dims.length;
    try { await page.locator('label:has-text("Show dimensions") input[type=checkbox]').first().uncheck({ timeout: 2500 }); }
    catch (e) { try { await page.getByText("Show dimensions").locator("xpath=./ancestor::label//input").first().uncheck({ timeout: 2500 }); } catch (e2) { /* noop */ } }
    await page.waitForTimeout(400);
    const after = (await readTexts(page)).dims.length;
    log(before > 0 && after === 0, `B121 UI: unchecking "Show dimensions" live-hides the red callouts (${before} → ${after})`);
    await page.screenshot({ path: OUT + "b121-toggle-live.png" });
  }
  await page.close();
}

console.log(fail ? `\n✗ ${fail} check(s) failed` : "\n✓ all checks passed");
await browser.close();
process.exit(fail ? 1 : 0);
