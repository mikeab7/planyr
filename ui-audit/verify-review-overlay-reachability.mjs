/* verify-review-overlay-reachability.mjs — B2426787. Every control on a Review overlay must be REACHABLE BY A REAL MOUSE: the point at the
 * centre of the control must resolve (document.elementFromPoint) to the control itself or something inside it, and a real
 * mouse click there must do the control's job. Covers Compare (Close ✕, both ‹ › page steppers, every change-list row), Version
 * history (its Close ✕ and row actions) and the Stitcher (its exit and tool-row buttons), at 1024 / 1280 / 1440 / 1920 / phone, in both themes.
 *   node ui-audit/verify-review-overlay-reachability.mjs [http://localhost:4182/ | https://planyr.io]
 * On https://planyr.io with E2E_LOGIN_KEY set it signs in as the test account (ui-audit/lib/signedInSession.mjs) and the header's right
 * side is the account pill instead of Sign-in; otherwise it runs signed out. Prints /version.json in the SAME call as the verdicts.
 * KNOWN-GOOD ARM (expected independently of the code under test): a toolbar button on the open sheet (`tool-select`) must resolve to itself —
 * if it does not the run is VOID, not scored (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6). A control that is not on screen at all is reported
 * NOT-OBSERVED and fails the run when it is a control that must exist (Close); it is never counted as a pass. */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.argv[2] || process.env.BASE_URL || "http://localhost:4182/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || ["/opt/pw-browsers/chromium-1248/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find(existsSync);
const LIVE = /^https:\/\/planyr\.io/.test(BASE) && !!process.env.E2E_LOGIN_KEY;

async function threePagePdf() { // ink on every page so Compare has something to register
  const d = await PDFDocument.create();
  for (let i = 0; i < 3; i++) { const pg = d.addPage([612, 792]); pg.drawRectangle({ x: 60, y: 120, width: 480, height: 520, borderWidth: 3 }); for (let k = 0; k < 6; k++) pg.drawLine({ start: { x: 80, y: 160 + k * 80 }, end: { x: 520, y: 200 + k * 70 }, thickness: 2 }); pg.drawCircle({ x: 300, y: 380, size: 70, borderWidth: 3 }); }
  return Buffer.from(await d.save());
}
const MULTI = await threePagePdf();
async function revisedPdf() { // the "newer" revision: an extra box and circle on every page, so Compare has changes to list
  const d = await PDFDocument.load(MULTI);
  for (const pg of d.getPages()) { pg.drawRectangle({ x: 100, y: 560, width: 160, height: 90, borderWidth: 4 }); pg.drawCircle({ x: 450, y: 250, size: 50, borderWidth: 4 }); }
  return Buffer.from(await d.save());
}
const REVISED = await revisedPdf();
const SIZES = [[1024, 800], [1280, 800], [1440, 900], [1920, 1080], [390, 844]];
const THEMES = ["light", "dark"];

let browser; if (!LIVE) browser = await chromium.launch({ executablePath: EXEC });
const results = []; let build = null; let void_ = false;
const record = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`); };

// What the point at the centre of `sel` resolves to: "ok" · "covered by <tag.class/aria>" · "offscreen" · "missing".
const reach = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return "missing";
  const r = el.getBoundingClientRect(); if (!r.width || !r.height) return "missing";
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return "offscreen";
  const h = document.elementFromPoint(x, y);
  if (h && el.contains(h)) return "ok";
  const d = h ? `${h.tagName.toLowerCase()}${h.getAttribute("aria-label") ? `[${h.getAttribute("aria-label")}]` : ""}${(h.textContent || "").trim().slice(0, 18) ? ` "${(h.textContent || "").trim().slice(0, 18)}"` : ""}` : "nothing";
  return `covered by ${d}`;
}, sel);
const reachAll = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((el, i) => { const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const h = document.elementFromPoint(x, y); return h && el.contains(h) ? "ok" : `#${i} covered`; }), sel);

async function open(w, h, theme) {
  if (LIVE) {
    const { openSignedIn } = await import("./lib/signedInSession.mjs");
    const s = await openSignedIn({ base: BASE.replace(/\/$/, "") });
    await s.page.setViewportSize({ width: w, height: h }); build = build || s.build;
    await s.page.evaluate(() => { location.hash = "#/markup"; });
    return { page: s.page, close: s.close };
  }
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(BASE + "#/markup", { waitUntil: "load" });
  return { page, close: () => ctx.close() };
}

for (const [w, h] of SIZES) for (const theme of THEMES) {
  const tag = `${w}×${h} ${theme}${LIVE ? " signed-in" : " signed-out"}`;
  const { page, close } = await open(w, h, theme);
  try {
    await page.waitForSelector('[data-testid="doc-review-root"]', { timeout: 30000 });
    await page.evaluate((t) => { document.documentElement.setAttribute("data-theme", t); }, theme);
    await page.waitForTimeout(700);
    await assertMeasurable(page, "verify-review-overlay-reachability");
    if (!build) { try { build = await page.evaluate(() => fetch("/version.json").then((r) => r.json()).catch(() => null)); } catch { /* none locally */ } }
    await page.locator('input[type="file"][accept^="application/pdf"]:not([multiple])').first().setInputFiles({ name: "multi.pdf", mimeType: "application/pdf", buffer: MULTI });
    await page.waitForSelector('[data-testid="review-sheet"]', { timeout: 30000 });
    await page.waitForTimeout(1500);

    // known-good arm — a control that has nothing over it must read "ok", or the probe itself is broken
    if (w > 600) { const arm = await reach(page, '[data-testid="tool-select"]'); if (arm !== "ok") { console.error(`VOID: known-good arm (tool-select) reads "${arm}" at ${tag}`); void_ = true; await close(); continue; } }

    // ---- Compare ----
    await page.locator('[data-testid="compare-input"]').setInputFiles([{ name: "a.pdf", mimeType: "application/pdf", buffer: MULTI }, { name: "b.pdf", mimeType: "application/pdf", buffer: REVISED }]);
    await page.waitForSelector('[data-cmp="compare-view"]', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('[data-cmp="compare-view"]')?.getAttribute("data-status") !== "loading", null, { timeout: 30000 });
    await page.waitForTimeout(400);
    for (const c of ["close", "page-a-prev", "page-a-next", "page-b-prev", "page-b-next"]) {
      const r = await reach(page, `[data-cmp="${c}"]`);
      record(`Compare · ${c} reachable · ${tag}`, r === "ok", r);
    }
    const rows = await reachAll(page, '[data-cmp="change-item"]');
    record(`Compare · every change-list row reachable (${rows.length}) · ${tag}`, rows.length > 0 && rows.every((x) => x === "ok"), rows.filter((x) => x !== "ok").join(", "));
    // the overlay must not paint under the app header at all
    const under = await page.evaluate(() => { const o = document.querySelector('[data-cmp="compare-view"]'), hd = document.querySelector("header[data-menu-scope]"); if (!o || !hd) return "n/a"; return o.getBoundingClientRect().top >= hd.getBoundingClientRect().bottom - 0.5 ? "ok" : `overlay top ${Math.round(o.getBoundingClientRect().top)} < header bottom ${Math.round(hd.getBoundingClientRect().bottom)}`; });
    record(`Compare · overlay starts below the app header · ${tag}`, under === "ok", under);
    // a REAL mouse click on Close closes it
    const cb = await page.locator('[data-cmp="close"]').boundingBox();
    if (cb) { await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2); await page.waitForTimeout(300); }
    record(`Compare · a real mouse click on Close closes it · ${tag}`, (await page.locator('[data-cmp="compare-view"]').count()) === 0);
    if (await page.locator('[data-cmp="compare-view"]').count()) await page.evaluate(() => document.querySelector('[data-cmp="close"]')?.click());

    // ---- Version history ----
    let vb = page.locator('[data-testid^="version-his"]').first();
    if (!(await vb.isVisible().catch(() => false))) { // folded into the toolbar's More menu on a narrow window
      const more = page.getByRole("button", { name: /More review actions/ }).first();
      if (await more.count()) { await more.click(); await page.waitForTimeout(150); vb = page.getByRole("menuitem", { name: /Version history/ }).first(); }
    }
    if (await vb.count()) {
      await vb.click(); await page.waitForSelector('[data-testid="version-history"]', { timeout: 8000 }).catch(() => {});
      const vc = await reach(page, '[data-testid="vh-close"]');
      record(`Version history · Close reachable · ${tag}`, vc === "ok", vc);
      const vrows = await reachAll(page, '[data-testid="version-history"] button');
      record(`Version history · every button reachable (${vrows.length}) · ${tag}`, vrows.length > 0 && vrows.every((x) => x === "ok"), vrows.filter((x) => x !== "ok").join(", "));
      const vbx = await page.locator('[data-testid="vh-close"]').boundingBox();
      if (vbx) { await page.mouse.click(vbx.x + vbx.width / 2, vbx.y + vbx.height / 2); await page.waitForTimeout(250); }
      record(`Version history · a real mouse click on Close closes it · ${tag}`, (await page.locator('[data-testid="version-history"]').count()) === 0);
      if (await page.locator('[data-testid="version-history"]').count()) await page.evaluate(() => document.querySelector('[data-testid="vh-close"]')?.click());
    } else console.log(`NOT-OBSERVED  Version history · ${tag} — no Version history entry on the toolbar`);

    // ---- Stitcher ----
    let sb = page.getByRole("button", { name: /Stitch/ }).first();
    if (!(await sb.isVisible().catch(() => false))) {
      const more = page.getByRole("button", { name: /More review actions/ }).first();
      if (await more.count()) { await more.click(); await page.waitForTimeout(150); sb = page.getByRole("menuitem", { name: /Stitch/ }).first(); }
    }
    if (await sb.count()) {
      await sb.click(); await page.waitForSelector('[data-testid="exit-stitch"]', { timeout: 15000 }).catch(() => {});
      let ex = await reach(page, '[data-testid="exit-stitch"]');
      if (ex === "offscreen") { await page.evaluate(() => document.querySelector('[data-testid="exit-stitch"]')?.scrollIntoView({ inline: "center", block: "nearest" })); await page.waitForTimeout(150); ex = await reach(page, '[data-testid="exit-stitch"]'); } // the phone toolbar is a deliberate scroll strip
      record(`Stitcher · Exit Stitch reachable · ${tag}`, ex === "ok", ex);
      const sbtn = await page.evaluate(() => { const root = document.querySelector('[data-review-mode="stitch"]'); const hd = document.querySelector("header[data-menu-scope]"); const bad = []; let n = 0; for (const b of root ? root.querySelectorAll("button") : []) { if (hd && hd.contains(b)) continue; const r = b.getBoundingClientRect(); if (!r.width || !r.height) continue; n++; const x = r.left + r.width / 2, y = r.top + r.height / 2; if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue; const el = document.elementFromPoint(x, y); if (!(el && b.contains(el))) bad.push((b.textContent || b.title || "").trim().slice(0, 16)); } return { n, bad }; });
      record(`Stitcher · every on-screen button reachable (${sbtn.n}) · ${tag}`, sbtn.bad.length === 0, sbtn.bad.join(", "));
    } else console.log(`NOT-OBSERVED  Stitcher · ${tag} — no Stitch entry`);
  } catch (e) { record(`run threw · ${tag}`, false, String(e.message || e).split("\n")[0]); }
  await close();
}
if (browser) await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\nbuild: ${build ? JSON.stringify(build) : "(local)"}`);
console.log(`${results.length - failed.length}/${results.length} passed${void_ ? " — SOME CELLS VOID (known-good arm failed)" : ""}`);
process.exit(failed.length || void_ ? 1 : 0);
