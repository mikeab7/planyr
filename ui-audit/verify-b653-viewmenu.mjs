/* Self-verification for B653 (Setup split → on-canvas View menu + Standards panel), driven
 * in the REAL app on the Vite preview (:4173), logged-out / this-device mode. Run:
 *   npm run build && npm run preview &   # then:
 *   node ui-audit/verify-b653-viewmenu.mjs
 *
 * Seeds a building + parking layout, zooms to fit, and asserts:
 *   A: the eye "View" card renders on the canvas; the TOP BAR no longer has a Snap button
 *      (the duplication is dead — the View menu is snap's single interactive home).
 *   B: the View menu holds all four show/hide toggles + Grid (ft) + Snap; unchecking
 *      "Show dimensions" live-hides the red callouts (the moved control still works).
 *   C: snap stays ONE state — checking it in the View menu, pressing S flips it back off
 *      (checkbox follows); with snap on and the card collapsed, the header chip shows "Snap 10′".
 *   D: the rail tab reads "Standards" (no "Setup" anywhere in the rail); the panel leads with
 *      the "Starting values for new elements" explainer and the 7 per-element-type sections.
 *   E: cross-links — selecting the building and clicking a column-grid "default ↗" jumps to
 *      Standards with the Buildings section OPEN; "Set as standard" fires the
 *      "Saved to Standards" confirmation.
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
  { id: "b1", type: "building", cx: -60, cy: -120, w: 420, h: 170, rot: 0 },
  { id: "pk1", type: "parking", cx: -60, cy: 60, w: 420, h: 120, rot: 0 },
];
const site = {
  id: "verify-b653", groupId: "verify-b653", site: "Verify B653", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [],
  callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: 1,
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ "verify-b653": site })}));
  localStorage.setItem('planarfit:currentSite:v1', 'verify-b653');
} catch (e) {} })();`;

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

// Count the red on-canvas dimension callouts (the thing "Show dimensions" hides).
const redDims = (page) => page.evaluate(() => {
  const svg = [...document.querySelectorAll("svg")].sort((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return (rb.width * rb.height) - (ra.width * ra.height);
  })[0];
  if (!svg) return 0;
  return [...svg.querySelectorAll("text")].filter((t) =>
    (t.getAttribute("fill") || "").toLowerCase() === "#dc2626" && t.getBoundingClientRect().width > 0).length;
});
// Screen center of the first on-canvas label matching a regex source (to click an element).
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
await page.waitForTimeout(500);

// ---------- A: View card on canvas; top-bar Snap button GONE ----------
{
  const viewBtn = page.getByTestId("view-menu-btn");
  log(await viewBtn.count() === 1, "A: exactly one on-canvas View (eye) card renders");
  const topbarSnap = await page.locator('button', { hasText: /^Snap (off|\d+′ on)$/ }).count();
  log(topbarSnap === 0, `A: the top-bar Snap button is gone (${topbarSnap} found)`);
  await page.screenshot({ path: OUT + "b653-canvas.png" });
}

// ---------- B: menu contents + "Show dimensions" works from its new home ----------
{
  await page.getByTestId("view-menu-btn").click();
  await page.waitForTimeout(300);
  const txt = await page.evaluate(() => document.body.innerText);
  const wants = ["Show dock doors", "Show column grid", "Show dimensions", "Show areas", "Grid (ft)", "Snap to grid"];
  const missing = wants.filter((w) => !txt.includes(w));
  log(missing.length === 0, `B: View menu holds all six controls${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
  const before = await redDims(page);
  await page.locator('label:has-text("Show dimensions") input[type=checkbox]').first().uncheck({ timeout: 2500 });
  await page.waitForTimeout(400);
  const after = await redDims(page);
  log(before > 0 && after === 0, `B: unchecking "Show dimensions" in the View menu live-hides the red callouts (${before} → ${after})`);
  await page.locator('label:has-text("Show dimensions") input[type=checkbox]').first().check({ timeout: 2500 });
}

// ---------- C: snap — one state (S key syncs), collapsed chip glanceable ----------
{
  const snapBox = page.locator('label:has-text("Snap to grid") input[type=checkbox]').first();
  await snapBox.check({ timeout: 2500 });
  log(await snapBox.isChecked(), "C: snap checked via the View menu");
  // Blur the checkbox — the app (correctly) ignores shortcuts while a field has focus,
  // and the SVG canvas preventDefaults pointerdown so a canvas click doesn't steal focus.
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(200);
  await page.keyboard.press("s");
  await page.waitForTimeout(300);
  log(!(await snapBox.isChecked()), "C: pressing S flips the View-menu checkbox off (one shared state)");
  await snapBox.check({ timeout: 2500 });
  await page.getByTestId("view-menu-btn").click(); // collapse
  await page.waitForTimeout(300);
  const chip = page.getByTestId("view-snap-chip");
  const chipText = (await chip.count()) ? await chip.innerText() : "";
  log(/Snap\s*10/.test(chipText), `C: collapsed header shows the live snap chip ("${chipText.trim()}")`);
  await page.screenshot({ path: OUT + "b653-snapchip.png" });
}

// ---------- D: Standards rail tab + reorganized panel ----------
{
  const railText = await page.evaluate(() => document.body.innerText);
  log(!/\bSetup\b/.test(railText), "D: no \"Setup\" label anywhere in the chrome");
  await page.locator('button:has-text("Standards")').first().click({ timeout: 5000 });
  await page.waitForTimeout(400);
  const txt = await page.evaluate(() => document.body.innerText);
  log(txt.includes("Starting values for new elements"), "D: the Standards panel leads with the explainer");
  // Section headers render text-transform:uppercase — read the .sec-title nodes directly.
  const secTitles = await page.evaluate(() => [...document.querySelectorAll(".sec-title")].map((e) => e.textContent.trim()));
  const sections = ["Parcels", "Buildings — structural grid", "Parking", "Trailers", "Dock zones", "Roads", "Colors"];
  const missing = sections.filter((s) => !secTitles.includes(s));
  log(missing.length === 0, `D: all 7 per-element-type sections present${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
  const gone = ["Show dock doors", "Show dimensions", "Snap to grid"].filter((s) => txt.includes(s));
  log(gone.length === 0, `D: the view/drawing toggles are OUT of the panel${gone.length ? ` (still there: ${gone.join(", ")})` : ""}`);
  await page.screenshot({ path: OUT + "b653-standards.png" });
  await page.locator('button:has-text("Standards")').first().click(); // close the panel again
  await page.waitForTimeout(300);
}

// ---------- E: cross-links — "default ↗" jump + "Set as standard" write-back ----------
{
  await page.keyboard.press("Escape"); // clear any selection left by earlier steps
  await page.waitForTimeout(300);
  const c = await labelCenter(page, "Building");
  log(!!c, "E: found the building's on-canvas label to click");
  if (c) {
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(500);
    let hasLink = (await page.locator('button:has-text("default ↗")').count()) > 0;
    if (!hasLink) { // one retry — the first click can land during a panel-shift reflow
      const c1 = await labelCenter(page, "Building");
      if (c1) { await page.mouse.click(c1.x, c1.y); await page.waitForTimeout(500); }
      hasLink = (await page.locator('button:has-text("default ↗")').count()) > 0;
    }
    const defLink = page.locator('button:has-text("default ↗")').first();
    log(hasLink, "E: the building inspector shows a \"default ↗\" link on un-overridden grid values");
    if (hasLink) {
      await defLink.click();
      await page.waitForTimeout(600);
      const txt = await page.evaluate(() => document.body.innerText);
      log(txt.includes("Starting values for new elements") && txt.includes("Speed bay (ft)"),
        "E: the jump opened Standards with the Buildings section EXPANDED (Speed bay field visible)");
      await page.screenshot({ path: OUT + "b653-crosslink.png" });
    }
    // Re-select the building (deselect first so the auto-open effect refires) → write-back toast.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const c2 = await labelCenter(page, "Building");
    if (c2) {
      await page.mouse.click(c2.x, c2.y);
      await page.waitForTimeout(500);
      const setStd = page.locator('button:has-text("Set as standard")').first();
      const hasStd = (await setStd.count()) > 0;
      log(hasStd, "E: the building inspector offers \"Set as standard\"");
      if (hasStd) {
        await setStd.click();
        await page.waitForTimeout(400);
        const txt2 = await page.evaluate(() => document.body.innerText);
        log(txt2.includes("Saved to Standards"), "E: the write-back confirms itself (\"Saved to Standards…\")");
      }
    }
  }
}

log(errors.length === 0, `no page errors (${errors.length})` + (errors.length ? " → " + errors.slice(0, 2).join(" | ") : ""));
await browser.close();
console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
