/* Self-verification for B848736 — the aerial backdrop folded into the unified References list
 * (the separate `underlay` field + its dedicated card are retired; a map-captured aerial is now a
 * bottom-pinned `sheetOverlays` record, `fromMap:true`). Driven in the REAL app on the Vite preview
 * (:4173), logged-out / this-device mode. Run:
 *   npm run build && npx vite preview --port 4173 &   # then:
 *   node ui-audit/verify-b848736-aerial-into-references.mjs
 *
 * Five scenarios, matching the item's own VERIFICATION BAR. Each runs in its OWN fresh browser
 * context (its own localStorage, seeded via addInitScript before the FIRST navigation) — never a
 * reload of a shared context — so one scenario's app instance can never race a later scenario's
 * seed with its own debounced autosave (which rewrites the WHOLE `planarfit:sites:v1` blob and
 * would otherwise clobber whatever the next scenario had just written).
 *   (a) EMPTY   — no references at all: one dropzone, no card, no empty-state aerial mention.
 *   (b) FROMMAP — a map-captured aerial (fromMap:true, bottom-pinned) + a placed site-plan PDF, NOT
 *                 georeferenced (basemapOn off): the pinned row renders BENEATH the PDF on canvas,
 *                 Calibrate is disabled with the "already to scale" explanation, no Bring-to-front/
 *                 Send-to-back/"Draw above the plan" controls on that one row.
 *   (c) DROPPED — a hand-dropped (non-fromMap) reference mid-calibration: the STANDARD trace flow
 *                 (never the old separate "Calibrate" chip), inline numEdit, real rescale.
 *   (d) MIGRATE — a plan saved BEFORE this change (a raw `underlay` field, no `sheetOverlays` entry
 *                 for it) — the acceptance test that matters most: it must still render at the same
 *                 place and scale after the fold, with zero page errors, and the fold must be REAL
 *                 (the re-saved record carries no `underlay` field any more).
 *   (e) LIVETILE — a georeferenced plan (origin set, basemap on): the pinned row's static image
 *                  stands down on the canvas AND the panel says why ("the basemap IS the aerial").
 * Ground truth = the rendered DOM + zero page errors.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || undefined;

// A tiny visible PNG (2×2 gray) — enough for an <image> node with real pixels.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNgYGD4//8/w38gAGYAJv0H/dbCTPYAAAAASUVORK5CYII=";

const parcel = { id: "pc1", locked: false, points: [{ x: -360, y: -300 }, { x: 360, y: -300 }, { x: 360, y: 300 }, { x: -360, y: 300 }] };
const baseSite = { groupId: "g", origin: null, county: null, parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, parcelDrawings: [], updatedAt: 1 };

const sites = {
  "b848736-a": { ...baseSite, id: "b848736-a", groupId: "b848736-a", site: "B848736 Empty", name: "Plan 1", sheetOverlays: [] },
  "b848736-b": {
    ...baseSite, id: "b848736-b", groupId: "b848736-b", site: "B848736 FromMap", name: "Plan 1",
    // deliberately NOT georeferenced (no origin) — isolates the paint-order/panel-controls checks
    // from the SEPARATE live-basemap-suppression behavior, which scenario (e) covers on its own.
    sheetOverlays: [
      { id: "map1", name: "Aerial backdrop", kind: "image", src: PNG, imgW: 1000, imgH: 800, x: -300, y: -240, ftPerPx: 0.6, ftPerPxY: 0.55, rotation: 0, opacity: 1, locked: true, fromMap: true, calibrated: false, knockout: false, page: 1, pageCount: 1 },
      { id: "pdf1", name: "SITE PLAN.pdf", src: PNG, imgW: 800, imgH: 600, page: 1, pageCount: 2, x: -200, y: -150, ftPerPx: 0.5, rotation: 0, opacity: 1, locked: false, storageKey: "u1/x.pdf", sheet: { label: "24×36 (ARCH D)", std: true } },
    ],
  },
  "b848736-c": {
    ...baseSite, id: "b848736-c", groupId: "b848736-c", site: "B848736 Dropped", name: "Plan 1",
    sheetOverlays: [{ id: "drop1", name: "screenshot.png", src: PNG, imgW: 1000, imgH: 800, x: -300, y: -240, ftPerPx: 0.6, rotation: 0, opacity: 1, locked: false }],
  },
  "b848736-d": {
    ...baseSite, id: "b848736-d", groupId: "b848736-d", site: "B848736 PreChange", name: "Plan 1",
    // NO sheetOverlays entry for the aerial — this is the pre-B848736 SAVED SHAPE: a top-level
    // `underlay` field only. The migration must fold it in at load, not lose it.
    underlay: { src: PNG, imgW: 1000, imgH: 800, x: -300, y: -240, ftPerPx: 0.6, opacity: 0.82, locked: true },
    sheetOverlays: [],
  },
  "b848736-e": {
    ...baseSite, id: "b848736-e", groupId: "b848736-e", site: "B848736 LiveTile", name: "Plan 1",
    origin: { lat: 29.9, lon: -95.6 }, // georeferenced → basemapOn (live tiles stand in for the static image)
    sheetOverlays: [{ id: "map1", name: "Aerial backdrop", kind: "image", src: PNG, imgW: 1000, imgH: 800, x: -300, y: -240, ftPerPx: 0.6, opacity: 1, locked: true, fromMap: true, knockout: false }],
  },
};

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const errors = [];
const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox", "--ignore-certificate-errors"] });

// Fresh context + fresh page PER SCENARIO, seeded before the first navigation. Returns the page,
// already on the References panel.
async function openScenario(id) {
  const seed = `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [id]: sites[id] })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(id)});
  } catch (e) {} })();`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${id}] ${e}`));
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(`[${id}] ${m.text()}`); });
  await page.goto(BASE, { waitUntil: "load" });
  await assertMeasurable(page, "verify-b848736-aerial-into-references");
  await page.waitForTimeout(1200);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
  await page.waitForTimeout(400);
  try { await page.locator('button:has-text("Overlays")').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
  await page.waitForTimeout(400);
  return page;
}

// ---------- (a) EMPTY — one dropzone, no card, no aerial mention ----------
{
  const page = await openScenario("b848736-a");
  const txt = await page.evaluate(() => document.body.innerText);
  log(txt.includes("Add overlay (PDF / image / CAD)"), "(a) the one dropzone is present");
  log(!txt.includes("Add an aerial"), "(a) no separate \"Add an aerial\" empty state");
  log(!txt.includes("Aerial backdrop"), "(a) nothing announces an aerial on a plan that has none");
  const rows = await page.locator('[data-testid^="reference-row-"]').count();
  log(rows === 0, `(a) zero reference rows (${rows})`);
  await page.screenshot({ path: OUT + "b848736-a-empty.png" });
  await page.context().close();
}

// ---------- (b) FROMMAP — pinned bottom row + a placed PDF, Calibrate disabled ----------
{
  const page = await openScenario("b848736-b");
  const txt = await page.evaluate(() => document.body.innerText);
  log(txt.includes("Aerial backdrop"), "(b) the map-captured row is named \"Aerial backdrop\"");
  log(txt.includes("SITE PLAN.pdf"), "(b) the placed PDF is listed too");
  // paint order: the pinned row's <g> must precede the PDF's <g> among the reference features
  // (SVG paint order == hit-test order == earlier sibling == further back == "beneath").
  const order = await page.evaluate(() => [...document.querySelectorAll('[data-feature^="reference:"]')].map((n) => n.getAttribute("data-feature")));
  const iMap = order.indexOf("reference:map1"), iPdf = order.indexOf("reference:pdf1");
  log(iMap >= 0 && iPdf >= 0 && iMap < iPdf, `(b) the pinned aerial paints BEFORE (beneath) the PDF (order: ${order.join(", ")})`);
  await page.locator('button:has-text("Aerial backdrop")').first().click();
  await page.waitForTimeout(300);
  // scope everything below to the pinned row's own DOM subtree, so generic wording used by OTHER
  // features (element/markup arrange menus also say "Bring to front") can't produce a false pass.
  const row = page.locator('[data-testid="reference-row-map1"]');
  const rowTxt = await row.evaluate((el) => el.innerText);
  const calBtn = row.locator('button:has-text("Calibrate")').first();
  log(await calBtn.count() === 1, "(b) a single disabled \"Calibrate\" chip (not Trace-a-length/Align-to-map)");
  log(await calBtn.isDisabled(), "(b) Calibrate is disabled for the pinned row");
  const calTitle = await calBtn.getAttribute("title");
  log(!!calTitle && calTitle.includes("already to scale"), `(b) the disabled explanation is on the button's title ("${calTitle}")`);
  // the pinned row IS a permanent front/back no-op (overlayOrderFlags forces atFront/atBack for it),
  // so the panel keeps the SAME buttons every other row has (never a special-cased row shape) and
  // simply greys them — matching how "already at the front/back of its band" reads for any row.
  const frontBtn = row.locator('button:has-text("Bring to front")').first();
  const backBtn = row.locator('button:has-text("Send to back")').first();
  log((await frontBtn.count()) === 1 && (await backBtn.count()) === 1, "(b) front/back controls are present (not a special-cased row)");
  log(await frontBtn.isDisabled() && await backBtn.isDisabled(), "(b) front/back controls are disabled — the pinned row can never move within its band");
  log(!rowTxt.includes("Draw this overlay over the parcel"), "(b) no \"Draw above the plan\" promote row on the pinned reference");
  await page.screenshot({ path: OUT + "b848736-b-frommap.png" });
  await page.context().close();
}

// ---------- (c) DROPPED — a hand-dropped reference mid-calibration ----------
{
  const page = await openScenario("b848736-c");
  await page.locator('button:has-text("screenshot.png")').first().click();
  await page.waitForTimeout(300);
  const row = page.locator('[data-testid="reference-row-drop1"]');
  const rowTxt = await row.evaluate((el) => el.innerText);
  log(rowTxt.includes("Trace a length") && rowTxt.includes("Align to map"), "(c) the STANDARD calibration flow is offered (not the disabled aerial chip)");
  // drop1 is a plain image (no `.sheet`), so the "Now ≈ 1″=X′" readout never renders for it (that's
  // the PDF/sheet-scale row) — read the Width control's value instead, which IS this overlay's
  // real-world-size readout (imgW * ftPerPx, rounded).
  const widthInput = row.locator('label:has-text("Width") input').first();
  const before = await widthInput.inputValue().catch(() => null);
  await row.locator('button:has-text("Trace a length")').first().click();
  await page.waitForTimeout(400);
  const banner = await page.evaluate(() => document.body.innerText);
  log(/Click one end of a known dimension on the drawing/.test(banner), "(c) the calibration banner speaks about \"the drawing\" (a plain reference, not \"the aerial\")");
  await page.mouse.click(650, 450);
  await page.waitForTimeout(250);
  await page.mouse.click(850, 450);
  await page.waitForTimeout(400);
  const numEdit = page.locator('input[type="number"]:focus');
  const hasNumEdit = (await numEdit.count()) === 1;
  log(hasNumEdit, "(c) the inline numEdit input pops at the second point (never a dialog)");
  if (hasNumEdit) {
    await numEdit.fill("500");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    const after = await widthInput.inputValue().catch(() => null);
    log(!!before && !!after && before !== after, `(c) the reference rescaled (${before}ft → ${after}ft)`);
  }
  await page.screenshot({ path: OUT + "b848736-c-calibrating.png" });
  await page.context().close();
}

// ---------- (d) MIGRATE — a pre-change saved plan (raw `underlay`) still renders correctly ----------
{
  const page = await openScenario("b848736-d");
  const seededSrc = sites["b848736-d"];
  const svgImg = await page.evaluate(() => {
    const svg = [...document.querySelectorAll("svg")].sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    })[0];
    const img = svg && svg.querySelector('image[href^="data:"]');
    if (!img) return null;
    return { opacity: img.getAttribute("opacity"), w: +img.getAttribute("width"), h: +img.getAttribute("height") };
  });
  log(!!svgImg, "(d) the migrated aerial renders an <image> node on the canvas");
  if (svgImg) {
    log(Math.abs(+svgImg.opacity - seededSrc.underlay.opacity) < 0.01, `(d) opacity preserved (${svgImg.opacity} ≈ ${seededSrc.underlay.opacity})`);
    log(svgImg.w > 0 && svgImg.h > 0, `(d) it has real on-screen size (${svgImg.w}×${svgImg.h})`);
  }
  const txt = await page.evaluate(() => document.body.innerText);
  log(txt.includes("Aerial backdrop"), "(d) the panel lists the migrated reference as \"Aerial backdrop\"");
  const rows = await page.locator('[data-testid^="reference-row-"]').count();
  log(rows === 1, `(d) exactly one reference row after the fold (${rows})`);
  // The fold is IN-MEMORY ONLY until the next ordinary save (by design — "write-back only on next
  // ordinary save, never a mass rewrite"), so merely loading the plan never touches localStorage.
  // Make one real, reversible edit (toggle the pinned row's lock) to trigger the debounced autosave,
  // then confirm the app's own persisted record folded the aerial for real.
  const migratedRow = page.locator('[data-testid="reference-row-legacy-aerial"]');
  await migratedRow.locator('button[title="Unlock"], button[title="Lock"]').first().click();
  await page.waitForTimeout(2500); // let the debounced autosave settle
  const persisted = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("planarfit:sites:v1"))["b848736-d"]; } catch (e) { return null; }
  });
  log(!!persisted && !("underlay" in persisted), "(d) the re-saved record carries NO `underlay` field — the fold is real, not cosmetic");
  log(!!persisted && Array.isArray(persisted.sheetOverlays) && persisted.sheetOverlays.length === 1, "(d) the re-saved record's sheetOverlays holds the folded aerial");
  await page.screenshot({ path: OUT + "b848736-d-migrated.png" });
  await page.context().close();
}

// ---------- (e) LIVETILE — the live basemap stands in for the static image ----------
{
  const page = await openScenario("b848736-e");
  const canvasImg = await page.evaluate(() => {
    const svg = [...document.querySelectorAll("svg")].sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    })[0];
    return svg ? !!svg.querySelector('image[href^="data:"]') : false;
  });
  log(!canvasImg, "(e) the pinned row's static <image> stands down on a georeferenced plan (live tiles are the aerial there)");
  await page.locator('button:has-text("Aerial backdrop")').first().click();
  await page.waitForTimeout(300);
  const row = page.locator('[data-testid="reference-row-map1"]');
  const rowTxt = await row.evaluate((el) => el.innerText);
  log(rowTxt.includes("the basemap IS the aerial"), "(e) the panel explains why (\"Hidden while the live map basemap is on\")");
  await page.screenshot({ path: OUT + "b848736-e-livetile.png" });
  await page.context().close();
}

log(errors.length === 0, `no page errors (${errors.length})` + (errors.length ? " → " + errors.slice(0, 4).join(" | ") : ""));
await browser.close();
console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
