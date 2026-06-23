/* Verify B331 — two-finger touchscreen pinch-zoom on the Markup canvas AND the Site map.
 * Drives REAL (trusted) multitouch via CDP `Input.dispatchTouchEvent` on a touch-enabled
 * context, so Chrome turns it into pointerType:'touch' pointer events that hit the React
 * handlers exactly like a phone/tablet would. Two fingers spreading apart must zoom IN.
 * Run against the built app on :4173 (override with BASE_URL).
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const PDF_PATH = "/tmp/pinch-test.pdf";

function buildPdf() {
  const s = "BT /F1 20 Tf 60 700 Td (PINCH TEST SHEET) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${s.length} >>\nstream\n${s}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n"; const off = [];
  objs.forEach((b, i) => { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const x = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  off.forEach((o) => { pdf += String(o).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const results = [];
const ok = (n, p, d) => { results.push({ p }); console.log(`${p ? "PASS ✅" : "FAIL ❌"}  ${n}  —  ${d}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
writeFileSync(PDF_PATH, buildPdf());
const pageErrors = [];

// Real two-finger pinch about (cx,cy): finger gap goes gap0 → gap1 over `steps` moves.
async function pinch(client, page, cx, cy, gap0, gap1, steps = 8) {
  const pt = (id, x) => ({ x, y: cy, id, radiusX: 6, radiusY: 6, force: 1 });
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt(1, cx - gap0 / 2), pt(2, cx + gap0 / 2)] });
  for (let i = 1; i <= steps; i++) {
    const g = gap0 + (gap1 - gap0) * (i / steps);
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [pt(1, cx - g / 2), pt(2, cx + g / 2)] });
    await page.waitForTimeout(16);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const demoSite = { id: "pinch-demo", groupId: "pinch-demo", site: "Pinch Demo", name: "Plan 1", origin: null, county: null, parcels: [parcel], els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };

try {
  // ---------- Site map pinch (own touch context, seeded site) ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    const page = await ctx.newPage(); const client = await ctx.newCDPSession(page);
    page.on("pageerror", (e) => pageErrors.push("site:" + e));
    await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ "pinch-demo": s })); localStorage.setItem("planarfit:currentSite:v1", "pinch-demo"); } catch (e) {} }, demoSite);
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForTimeout(2500);
    const ppf = () => page.evaluate(() => { const m = document.body.innerText.match(/([\d.]+)\s*px\/ft/); return m ? parseFloat(m[1]) : null; });
    const p0 = await ppf();
    await pinch(client, page, 700, 460, 90, 340);
    await page.waitForTimeout(250);
    const p1 = await ppf();
    ok("1 Site map: two-finger spread zooms IN", p0 != null && p1 != null && p1 > p0 * 1.5, `px/ft ${p0} → ${p1}`);
    await pinch(client, page, 700, 460, 340, 110);
    await page.waitForTimeout(250);
    const p2 = await ppf();
    ok("2 Site map: pinch-together zooms OUT", p1 != null && p2 != null && p2 < p1 * 0.7, `px/ft ${p1} → ${p2}`);
    await ctx.close();
  }

  // ---------- Markup canvas pinch (own touch context) ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    const page = await ctx.newPage(); const client = await ctx.newCDPSession(page);
    page.on("pageerror", (e) => pageErrors.push("markup:" + e));
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.locator('button:has-text("Library")').first().click({ timeout: 8000 });
    await page.waitForTimeout(700);
    await page.setInputFiles('input[type="file"]', PDF_PATH, { timeout: 8000 });
    await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0 && c.getBoundingClientRect().width > 0; }, { timeout: 12000 });
    await page.getByRole("button", { name: "Page", exact: true }).click();
    await page.waitForTimeout(400);
    const cw = () => page.evaluate(() => document.querySelector("canvas").getBoundingClientRect().width);
    const vp = await page.evaluate(() => { const v = document.querySelector("canvas").parentElement.parentElement.getBoundingClientRect(); return { cx: v.left + v.width / 2, cy: v.top + v.height / 2 }; });
    const w0 = await cw();
    await pinch(client, page, vp.cx, vp.cy, 90, 300);
    await page.waitForTimeout(250);
    const w1 = await cw();
    ok("3 Markup: two-finger spread zooms IN (canvas grows)", w1 > w0 * 1.4, `canvas ${Math.round(w0)} → ${Math.round(w1)}px`);
    await pinch(client, page, vp.cx, vp.cy, 300, 100);
    await page.waitForTimeout(250);
    const w2 = await cw();
    ok("4 Markup: pinch-together zooms OUT", w2 < w1 * 0.85, `canvas ${Math.round(w1)} → ${Math.round(w2)}px`);
    await ctx.close();
  }

  ok("5 no uncaught page errors", pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 2).join(" | ") : "clean");
} catch (e) {
  ok("harness completed", false, String(e));
} finally {
  const passed = results.filter((r) => r.p).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
