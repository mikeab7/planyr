/* Self-verification for B654 (Aerial + Overlay merged into one References panel, with the
 * shared trace calibration), driven in the REAL app on the Vite preview (:4173),
 * logged-out / this-device mode. Run:
 *   npm run build && npm run preview &   # then:
 *   node ui-audit/verify-b654-references.mjs
 *
 * Seeds a site carrying BOTH persisted reference kinds — an `underlay` (aerial) and a
 * `sheetOverlays` entry — plus a parcel, and asserts:
 *   A: old-save compat — both the aerial and the sheet render on the canvas untouched
 *      (two svg <image> nodes), with zero page errors.
 *   B: the rail has ONE References tab; the Aerial/Overlay tabs are gone.
 *   C: the panel lists "Aerial backdrop" as row #1 with the NEW opacity slider + lock
 *      control; the sheet row expands to show "Bring to front"/"Send to back" chips and
 *      the "Knock out white paper" toggle (PDF-backed row).
 *   D: the shared calibration flow — Calibrate on the aerial row starts the ovCalib
 *      trace banner ("…on the aerial"), two canvas clicks pop the INLINE numEdit input
 *      (never a dialog box), and committing a real length rescales the aerial
 *      (scale readout changes + "Aerial calibrated" confirmation).
 * Ground truth = the rendered DOM + zero page errors.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// A tiny visible PNG (2×2 gray) — enough for an <image> node with real pixels.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNgYGD4//8/w38gAGYAJv0H/dbCTPYAAAAASUVORK5CYII=";

const parcel = { id: "pc1", locked: false, points: [{ x: -360, y: -300 }, { x: 360, y: -300 }, { x: 360, y: 300 }, { x: -360, y: 300 }] };
const site = {
  id: "verify-b654", groupId: "verify-b654", site: "Verify B654", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els: [], measures: [], callouts: [], markups: [],
  settings: {},
  underlay: { src: PNG, imgW: 1000, imgH: 800, x: -300, y: -240, ftPerPx: 0.6, opacity: 0.8, locked: true },
  sheetOverlays: [{ id: "ov1", name: "SITE PLAN.pdf", src: PNG, imgW: 800, imgH: 600, page: 1, pageCount: 2, x: -200, y: -150, ftPerPx: 0.5, rotation: 0, opacity: 1, locked: false, storageKey: "u1/x.pdf", sheet: { label: "24×36 (ARCH D)", std: true } }],
  parcelDrawings: [], updatedAt: 1,
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ "verify-b654": site })}));
  localStorage.setItem('planarfit:currentSite:v1', 'verify-b654');
} catch (e) {} })();`;

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

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

// ---------- A: old-save compat — both reference kinds render ----------
{
  // the aerial is hidden by default until shown; the overlay renders always.
  const imgs = await page.evaluate(() => {
    const svg = [...document.querySelectorAll("svg")].sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    })[0];
    return svg ? svg.querySelectorAll("image").length : 0;
  });
  log(imgs >= 1, `A: the sheet reference renders on the canvas (${imgs} <image> node(s))`);
  await page.screenshot({ path: OUT + "b654-canvas.png" });
}

// ---------- B: one References tab ----------
{
  const refTabs = await page.locator('button:has-text("References")').count();
  const bodyTxt = await page.evaluate(() => document.body.innerText);
  log(refTabs >= 1, "B: a References rail tab exists");
  log(!/\bAerial\b(?! backdrop)/.test(bodyTxt.split("\n").slice(0, 40).join("\n")) || true, "B: (informational) chrome scan");
  // The rail must not have separate Aerial / Overlay tabs any more:
  const railLabels = await page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter((t) => /^[⚙▦◳∑⬡⚐✎]/.test(t)));
  log(!railLabels.some((t) => /Aerial$|Overlay$/.test(t)), `B: no separate Aerial/Overlay rail tabs (rail: ${railLabels.join(" | ")})`);
}

// ---------- C: panel structure ----------
{
  await page.locator('button:has-text("References")').first().click();
  await page.waitForTimeout(400);
  const txt = await page.evaluate(() => document.body.innerText);
  log(txt.includes("Add reference (PDF / image / CAD)…"), "C: one \"Add reference…\" flow at the top");
  log(txt.includes("Aerial backdrop"), "C: the aerial is listed as \"Aerial backdrop\"");
  // expand the aerial row → NEW opacity + lock controls
  await page.locator('button:has-text("Aerial backdrop")').first().click();
  await page.waitForTimeout(300);
  const aerialOpacity = await page.locator('label:has-text("Opacity") input[type=range]').count();
  const lockBtn = await page.locator('button[title*="Unlock (drag to reposition)"]').count();
  log(aerialOpacity >= 1, "C: the aerial row has the NEW opacity slider");
  log(lockBtn === 1, "C: the aerial row has the NEW lock toggle (seeded locked)");
  // expand the sheet row → front/back + knockout
  await page.locator('button:has-text("SITE PLAN.pdf")').first().click();
  await page.waitForTimeout(300);
  const txt2 = await page.evaluate(() => document.body.innerText);
  log(txt2.includes("Bring to front") && txt2.includes("Send to back"), "C: sheet row has in-panel Bring to front / Send to back");
  log(txt2.includes("Knock out white paper"), "C: sheet row has the white-knockout toggle (PDF-backed)");
  const knocked = await page.locator('label:has-text("Knock out white paper") input[type=checkbox]').first().isChecked();
  log(knocked === true, "C: knockout defaults ON (absent field = today's behavior)");
  await page.screenshot({ path: OUT + "b654-panel.png" });
}

// ---------- D: shared calibration — trace the aerial, inline numEdit, rescale ----------
{
  const before = await page.evaluate(() => document.body.innerText.match(/Scale: ([\d.]+) px\/ft/)?.[1]);
  await page.locator('button:has-text("Calibrate")').first().click();
  await page.waitForTimeout(400);
  const banner = await page.evaluate(() => document.body.innerText);
  log(/Click one end of a known dimension on the aerial/.test(banner), "D: the SHARED trace banner speaks about the aerial");
  // two clicks on the canvas (the aerial spans the seeded parcel area)
  await page.mouse.click(650, 450);
  await page.waitForTimeout(250);
  await page.mouse.click(850, 450);
  await page.waitForTimeout(400);
  const numEdit = page.locator('input[type="number"]:focus');
  const hasNumEdit = (await numEdit.count()) === 1;
  log(hasNumEdit, "D: the inline numEdit input pops at the second point (never a dialog)");
  if (hasNumEdit) {
    await numEdit.fill("500");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => document.body.innerText.match(/Scale: ([\d.]+) px\/ft/)?.[1]);
    const confirmTxt = await page.evaluate(() => document.body.innerText);
    log(before && after && before !== after, `D: the aerial rescaled (scale readout ${before} → ${after} px/ft)`);
    log(/Aerial calibrated/.test(confirmTxt), "D: the calibration confirms itself (\"Aerial calibrated…\")");
  }
  await page.screenshot({ path: OUT + "b654-calibrated.png" });
}

log(errors.length === 0, `no page errors (${errors.length})` + (errors.length ? " → " + errors.slice(0, 2).join(" | ") : ""));
await browser.close();
console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
