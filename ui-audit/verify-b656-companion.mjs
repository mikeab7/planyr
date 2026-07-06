/* Self-verification for B656 (Properties inspector follows selection as a COMPANION
 * surface instead of occupying a rail tab), driven in the REAL app on the Vite preview
 * (:4173), logged-out / this-device mode. Run:
 *   npm run build && npm run preview &   # then:
 *   node ui-audit/verify-b656-companion.mjs
 *
 * Seeds a pond + building layout and asserts:
 *   A: the rail has NO "Element" tab (final rail: Yield · Parcel · Analysis ·
 *      References · Standards).
 *   B: THE OWNER'S REPRO — select the pond → its properties appear (companion);
 *      click Yield → the pond's properties AND the Yield metrics are visible
 *      TOGETHER (the old behavior hid the properties).
 *   C: deselect (Esc) → the companion disappears, Yield stays.
 *   D: with no panel open, selecting an element shows the companion alone in the
 *      column; the collapsible "ELEMENT — …" header folds it.
 *   E: 400px phone viewport (B556-compatible) — tapping an element does NOT open any
 *      overlay; a "✎ Properties" pill appears bottom-left; tapping the pill opens the
 *      companion overlay; the ✕ closes it.
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
const els = [
  { id: "b1", type: "building", cx: -80, cy: -140, w: 380, h: 160, rot: 0 },
  { id: "pond1", type: "pond", cx: 100, cy: 140, w: 260, h: 200, rot: 0 },
];
const site = {
  id: "verify-b656", groupId: "verify-b656", site: "Verify B656", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [], markups: [],
  settings: {}, underlay: null, parcelDrawings: [], updatedAt: 1,
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ "verify-b656": site })}));
  localStorage.setItem('planarfit:currentSite:v1', 'verify-b656');
} catch (e) {} })();`;

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const labelCenter = (page, reSource) => page.evaluate((src) => {
  const re = new RegExp(src, "i");
  const svg = [...document.querySelectorAll("svg")].sort((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return (rb.width * rb.height) - (ra.width * ra.height);
  })[0];
  if (!svg) return null;
  const t = [...svg.querySelectorAll("text")].find((x) => re.test(x.textContent || "") && x.getBoundingClientRect().width > 0);
  if (!t) return null;
  const b = t.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}, reSource);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const errors = [];
const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;

// ================= desktop =================
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
  await page.waitForTimeout(500);

  // ---------- A: no Element rail tab ----------
  const railLabels = await page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter((t) => /^[⚙▦◳∑⬡⚐✎]/.test(t)));
  log(!railLabels.some((t) => /Element$/.test(t)), `A: no "Element" rail tab (rail: ${railLabels.join(" | ")})`);

  // ---------- D: companion alone on selection ----------
  const pc = await labelCenter(page, "Pond|Detention");
  log(!!pc, "D: found the pond's on-canvas label");
  if (pc) {
    await page.mouse.click(pc.x, pc.y);
    await page.waitForTimeout(500);
    const companion = page.getByTestId("property-panel");
    log((await companion.count()) === 1, "D: selecting the pond surfaces the Properties companion (no tab click)");
    const hdr = await companion.locator("span", { hasText: /Element — / }).first().innerText().catch(() => "");
    log(/pond/i.test(hdr), `D: the companion header names the selection ("${hdr.trim()}")`);
    // fold + unfold
    await companion.locator('[role="button"][aria-expanded]').first().click();
    await page.waitForTimeout(200);
    const foldedDepth = await companion.locator('text=Depth').count().catch(() => 0);
    log(foldedDepth === 0, "D: the header folds the companion body");
    await companion.locator('[role="button"][aria-expanded]').first().click();
    await page.waitForTimeout(200);
  }

  // ---------- B: THE REPRO — pond selected + Yield open, both visible ----------
  {
    await page.locator('button:has-text("Yield")').first().click();
    await page.waitForTimeout(500);
    const companionVisible = await page.getByTestId("property-panel").isVisible().catch(() => false);
    const txt = await page.evaluate(() => document.body.innerText);
    const yieldVisible = /BUILDINGS|COVERAGE|STORMWATER|Site area/i.test(txt);
    log(companionVisible, "B: the pond's properties are STILL visible with Yield open (the owner's repro, fixed)");
    log(yieldVisible, "B: the Yield panel content renders beneath the companion");
    await page.screenshot({ path: OUT + "b656-repro.png" });
  }

  // ---------- C: deselect → companion gone, Yield stays ----------
  {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const companionCount = await page.getByTestId("property-panel").count();
    const txt = await page.evaluate(() => document.body.innerText);
    log(companionCount === 0, "C: Esc/deselect removes the companion");
    log(/BUILDINGS|COVERAGE|STORMWATER|Site area/i.test(txt), "C: the Yield panel stays open");
  }
  await page.close();
  await ctx.close();
}

// ================= phone (B556-compatible) =================
{
  // Phone-only seed: ONE big pond, so its label stays INSIDE the shape at fit zoom on a
  // 400px screen (the mixed layout de-collides labels off their shapes there, and this
  // spec clicks the label to select).
  // …and OFF the parcel centroid — the floating parcel-acreage badge sits at (0,0) and
  // would eat a click aimed there.
  const phoneSite = { ...site, els: [{ id: "pond1", type: "pond", cx: -120, cy: 120, w: 400, h: 320, rot: 0 }] };
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, hasTouch: true });
  await ctx.addInitScript(`(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ "verify-b656": phoneSite })}));
    localStorage.setItem('planarfit:currentSite:v1', 'verify-b656');
  } catch (e) {} })();`);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
  await page.waitForTimeout(500);
  // At phone zoom the label de-collides OFF the pond, so clicking it selects the parcel
  // instead — compute the pond's true screen position from the parcel's bbox (the parcel
  // is the biggest polygon; world (-360..360, -300..300); pond center (-120, 120)).
  const pc = await page.evaluate(() => {
    const svg = [...document.querySelectorAll("svg")].sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    })[0];
    if (!svg) return null;
    const polys = [...svg.querySelectorAll("polygon, path")].map((n) => n.getBoundingClientRect());
    const pb = polys.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    if (!pb || pb.width < 50) return null;
    return { x: pb.x + ((-120 + 360) / 720) * pb.width, y: pb.y + ((120 + 300) / 600) * pb.height };
  });
  log(!!pc, "E: (phone) computed the pond's on-screen position");
  if (pc) {
    await page.mouse.click(pc.x, pc.y);
    await page.waitForTimeout(500);
    const overlayOpen = await page.getByTestId("property-panel").count();
    log(overlayOpen === 0, "E: (phone) tapping the pond does NOT open any overlay (B556: tap = select only)");
    const pill = page.locator('button:has-text("✎ Properties")');
    log((await pill.count()) === 1, "E: (phone) the ✎ Properties pill appears bottom-left");
    if (await pill.count()) {
      await pill.click();
      await page.waitForTimeout(400);
      log((await page.getByTestId("property-panel").count()) === 1, "E: (phone) tapping the pill opens the companion overlay");
      await page.screenshot({ path: OUT + "b656-phone.png" });
      const close = page.locator('button[title="Close"]');
      if (await close.count()) {
        await close.click();
        await page.waitForTimeout(300);
        log((await page.getByTestId("property-panel").count()) === 0, "E: (phone) ✕ closes the companion overlay");
      } else log(false, "E: (phone) close button missing");
    }
  }
  await page.close();
  await ctx.close();
}

log(errors.length === 0, `no page errors (${errors.length})` + (errors.length ? " → " + errors.slice(0, 2).join(" | ") : ""));
await browser.close();
console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
